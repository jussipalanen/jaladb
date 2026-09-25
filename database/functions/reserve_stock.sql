-- reserve_stock(product_id, warehouse_id, quantity)
--
-- Reserves units of a product in a warehouse for an order and returns the
-- quantity still available afterwards.
--
--   SELECT reserve_stock(5, 1, 2);
--
-- The reservation increases inventory.quantity_reserved; quantity_on_hand is
-- unchanged until the goods actually leave the warehouse. The function runs in
-- the caller's transaction, so a rollback also undoes the reservation.
--
-- Concurrency: the inventory row is locked with SELECT ... FOR UPDATE before
-- availability is checked. A concurrent reservation of the same product in the
-- same warehouse waits for that lock until the first transaction commits or
-- rolls back, and then checks against the committed values. Two transactions
-- can therefore never both take the same last units. The table constraint
-- CHECK (quantity_reserved <= quantity_on_hand) remains as a safety net.
--
-- Errors:
--   JD001 insufficient stock       fewer units available than requested
--                                  (also when the product is not stocked there)
--   JD002 not active               product or warehouse is inactive
--   P0002 (no_data_found)          product or warehouse does not exist
--   22023 (invalid_parameter_value) NULL argument or quantity <= 0
--
-- JD001/JD002 are project-specific SQLSTATEs (class "JD"), so callers can
-- react to them without parsing messages.

CREATE OR REPLACE FUNCTION reserve_stock(
    p_product_id    BIGINT,
    p_warehouse_id  BIGINT,
    p_quantity      INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_active    BOOLEAN;
    v_warehouse_active  BOOLEAN;
    v_on_hand           INTEGER;
    v_reserved          INTEGER;
    v_available         INTEGER;
BEGIN
    IF p_product_id IS NULL OR p_warehouse_id IS NULL OR p_quantity IS NULL THEN
        RAISE EXCEPTION 'product id, warehouse id and quantity must not be NULL'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'quantity must be positive, got %', p_quantity
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT p.is_active INTO v_product_active
    FROM products p
    WHERE p.product_id = p_product_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % does not exist', p_product_id
            USING ERRCODE = 'no_data_found';
    END IF;

    SELECT w.is_active INTO v_warehouse_active
    FROM warehouses w
    WHERE w.warehouse_id = p_warehouse_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % does not exist', p_warehouse_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT v_product_active THEN
        RAISE EXCEPTION 'product % is not active', p_product_id
            USING ERRCODE = 'JD002';
    END IF;

    IF NOT v_warehouse_active THEN
        RAISE EXCEPTION 'warehouse % is not active', p_warehouse_id
            USING ERRCODE = 'JD002';
    END IF;

    -- Lock the stock row. Competing reservations for the same product and
    -- warehouse queue here; each one sees the previous one's committed result.
    SELECT i.quantity_on_hand, i.quantity_reserved
    INTO v_on_hand, v_reserved
    FROM inventory i
    WHERE i.product_id = p_product_id
      AND i.warehouse_id = p_warehouse_id
    FOR UPDATE;

    v_available := COALESCE(v_on_hand - v_reserved, 0);

    IF v_available < p_quantity THEN
        RAISE EXCEPTION 'insufficient stock for product % in warehouse %: requested %, available %',
                p_product_id, p_warehouse_id, p_quantity, v_available
            USING ERRCODE = 'JD001';
    END IF;

    UPDATE inventory i
    SET quantity_reserved = i.quantity_reserved + p_quantity
    WHERE i.product_id = p_product_id
      AND i.warehouse_id = p_warehouse_id;

    RETURN v_available - p_quantity;
END;
$$;

COMMENT ON FUNCTION reserve_stock(BIGINT, BIGINT, INTEGER) IS
    'Reserves stock under a row lock and returns the remaining available quantity. Raises JD001 when stock is insufficient.';
