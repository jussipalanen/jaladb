-- create_order(customer_id, warehouse_id, items)
--
-- Creates an order and its lines, reserves the stock, and returns the new
-- order id. Either everything happens or nothing does.
--
--   SELECT create_order(1, 1, '[{"product_id": 5, "quantity": 2},
--                               {"product_id": 7, "quantity": 1}]');
--
-- items is a JSON array of {"product_id": integer, "quantity": integer}. JSONB
-- is only the input format (it maps directly to an API request body); the
-- lines are stored in order_items.
--
-- Steps:
--   1. Validate the arguments and every line before touching any stock.
--   2. Reserve stock for each line with reserve_stock(), in product_id order.
--      Two orders containing the same products therefore lock inventory rows
--      in the same order and cannot deadlock each other, whatever order the
--      lines were given in.
--   3. Read the current prices once and insert the order (status pending,
--      total = sum of quantity x price) and its lines from those same values.
--      The total always matches the lines, and the order row is written once
--      instead of being inserted and then updated.
--
-- Atomicity: a function call runs as a single statement. If any step raises
-- an error, PostgreSQL undoes every change the call made: no order, no lines,
-- no reservations. Inside a larger transaction the caller can still decide to
-- COMMIT or ROLLBACK the rest.
--
-- Errors:
--   JD001  insufficient stock for a line        (from reserve_stock)
--   JD002  product or warehouse is inactive     (from reserve_stock)
--   P0002  unknown customer, product or warehouse
--   22023  NULL argument, malformed or empty items, non-positive or
--          non-integer quantity, product listed twice

CREATE OR REPLACE FUNCTION create_order(
    p_customer_id   BIGINT,
    p_warehouse_id  BIGINT,
    p_items         JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_ids  BIGINT[];
    v_quantities   INTEGER[];
    v_prices       NUMERIC(12, 2)[];
    v_bad_line     RECORD;
    v_order_id     BIGINT;
BEGIN
    -- 1. Validation -----------------------------------------------------------

    IF p_customer_id IS NULL OR p_warehouse_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'customer id, warehouse id and items must not be NULL'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'items must be a non-empty JSON array'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Parse the lines, sorted by product_id for deadlock-free locking.
    -- Non-object elements, non-integer values and out-of-range numbers are
    -- reported as one invalid_parameter_value error.
    BEGIN
        SELECT array_agg(item.product_id ORDER BY item.product_id),
               array_agg(item.quantity   ORDER BY item.product_id)
        INTO v_product_ids, v_quantities
        FROM jsonb_to_recordset(p_items) AS item(product_id BIGINT, quantity INTEGER);
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
            RAISE EXCEPTION 'items must be objects with integer "product_id" and "quantity": %', SQLERRM
                USING ERRCODE = 'invalid_parameter_value';
    END;

    SELECT item.line_no, item.product_id, item.quantity
    INTO v_bad_line
    FROM ROWS FROM (jsonb_to_recordset(p_items) AS (product_id BIGINT, quantity INTEGER))
         WITH ORDINALITY AS item(product_id, quantity, line_no)
    WHERE item.product_id IS NULL OR item.quantity IS NULL OR item.quantity <= 0
    ORDER BY item.line_no
    LIMIT 1;

    IF FOUND THEN
        IF v_bad_line.product_id IS NULL OR v_bad_line.quantity IS NULL THEN
            RAISE EXCEPTION 'item % must have "product_id" and "quantity"', v_bad_line.line_no
                USING ERRCODE = 'invalid_parameter_value';
        END IF;
        RAISE EXCEPTION 'item %: quantity must be positive, got %', v_bad_line.line_no, v_bad_line.quantity
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT duplicate.product_id INTO v_bad_line
    FROM unnest(v_product_ids) AS duplicate(product_id)
    GROUP BY duplicate.product_id
    HAVING count(*) > 1
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'product % appears more than once in items', v_bad_line.product_id
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = p_customer_id) THEN
        RAISE EXCEPTION 'customer % does not exist', p_customer_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- 2. Reserve stock, in product_id order -----------------------------------
    -- reserve_stock() also checks that the product and warehouse exist and are
    -- active, and raises JD001 when stock is insufficient.

    FOR i IN 1 .. array_length(v_product_ids, 1) LOOP
        PERFORM reserve_stock(v_product_ids[i], p_warehouse_id, v_quantities[i]);
    END LOOP;

    -- 3. Insert the order and its lines ---------------------------------------
    -- Prices are read once; the total and the lines are both built from them.

    SELECT array_agg(p.price ORDER BY line.ord)
    INTO v_prices
    FROM unnest(v_product_ids) WITH ORDINALITY AS line(product_id, ord)
    JOIN products p ON p.product_id = line.product_id;

    INSERT INTO orders (customer_id, warehouse_id, status, total_amount)
    SELECT p_customer_id, p_warehouse_id, 'pending', sum(line.quantity * line.price)
    FROM unnest(v_quantities, v_prices) AS line(quantity, price)
    RETURNING order_id INTO v_order_id;

    INSERT INTO order_items (order_id, product_id, quantity, unit_price)
    SELECT v_order_id, line.product_id, line.quantity, line.price
    FROM unnest(v_product_ids, v_quantities, v_prices) AS line(product_id, quantity, price);

    RETURN v_order_id;
END;
$$;

COMMENT ON FUNCTION create_order(BIGINT, BIGINT, JSONB) IS
    'Atomically creates a pending order with its lines and reserves the stock (locking in product_id order). Returns the order id.';
