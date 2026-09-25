-- get_product_availability(product_id, warehouse_id)
--
-- Stock of one product in one warehouse.
--
--   SELECT * FROM get_product_availability(100, 1);
--
-- Returns exactly one row:
--   quantity_on_hand    physical units in the warehouse
--   quantity_reserved   units promised to open orders
--   quantity_available  on hand minus reserved
--
-- A product that is not stocked in the warehouse (no inventory row) returns
-- zeros: "none available here" is a valid answer, not an error.
--
-- Errors:
--   P0002 (no_data_found)            the product or the warehouse does not exist
--   22023 (invalid_parameter_value)  product id or warehouse id is NULL
--
-- The result is a snapshot for display and checks. It does not lock anything;
-- claiming stock safely is reserve_stock()'s job.
--
-- OUT parameters instead of RETURNS TABLE: the function returns a single row
-- by definition, never zero or several.

CREATE OR REPLACE FUNCTION get_product_availability(
    p_product_id            BIGINT,
    p_warehouse_id          BIGINT,
    OUT quantity_on_hand    INTEGER,
    OUT quantity_reserved   INTEGER,
    OUT quantity_available  INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'product id and warehouse id must not be NULL'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.product_id = p_product_id) THEN
        RAISE EXCEPTION 'product % does not exist', p_product_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.warehouse_id = p_warehouse_id) THEN
        RAISE EXCEPTION 'warehouse % does not exist', p_warehouse_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Columns are table-qualified because the OUT parameter names are also
    -- PL/pgSQL variables inside the body.
    SELECT i.quantity_on_hand, i.quantity_reserved, i.quantity_available
    INTO quantity_on_hand, quantity_reserved, quantity_available
    FROM inventory i
    WHERE i.product_id = p_product_id
      AND i.warehouse_id = p_warehouse_id;

    IF NOT FOUND THEN
        quantity_on_hand   := 0;
        quantity_reserved  := 0;
        quantity_available := 0;
    END IF;
END;
$$;

COMMENT ON FUNCTION get_product_availability(BIGINT, BIGINT) IS
    'Stock on hand, reserved and available for one product in one warehouse. Zeros when not stocked.';
