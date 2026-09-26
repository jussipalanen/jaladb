-- update_order_status(order_id, new_status)
--
-- Moves an order to a new status and applies the stock effect of the change.
-- Returns the previous status.
--
--   SELECT update_order_status(18, 'cancelled');
--
-- Allowed transitions and their stock effects:
--
--   pending -> paid        none (stock was reserved by create_order)
--   pending -> cancelled   release the reservation
--   paid    -> shipped     ship: reduce quantity_on_hand and quantity_reserved
--   paid    -> cancelled   release the reservation
--   shipped -> delivered   none
--
-- delivered and cancelled are final. Setting the status the order already has
-- is a no-op (no stock change, no history row), so retries are safe. The status
-- history trigger records every real change.
--
-- Concurrency: the order row is locked first, so concurrent changes to the
-- same order run one after the other and the second one sees the first one's
-- result (e.g. a cancel racing a ship: one wins, the other gets JD003).
-- Inventory rows are then locked in product_id order, the same order that
-- create_order() uses, so status changes and new orders cannot deadlock.
--
-- Errors:
--   JD003 invalid status transition     e.g. delivered -> pending
--   P0002 (no_data_found)               the order does not exist
--   22023 (invalid_parameter_value)     NULL argument or unknown status value
--
-- The CHECK constraints on inventory remain a safety net: stock can never go
-- negative, even if inventory was changed by hand.

CREATE OR REPLACE FUNCTION update_order_status(
    p_order_id    BIGINT,
    p_new_status  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_status    TEXT;
    v_warehouse_id  BIGINT;
    v_line_count    INTEGER;
    v_updated_rows  INTEGER;
BEGIN
    IF p_order_id IS NULL OR p_new_status IS NULL THEN
        RAISE EXCEPTION 'order id and status must not be NULL'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_new_status NOT IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled') THEN
        RAISE EXCEPTION 'unknown order status "%"', p_new_status
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Lock the order: concurrent status changes of this order queue here.
    SELECT o.status, o.warehouse_id
    INTO v_old_status, v_warehouse_id
    FROM orders o
    WHERE o.order_id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order % does not exist', p_order_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF v_old_status = p_new_status THEN
        RETURN v_old_status;
    END IF;

    IF (v_old_status, p_new_status) NOT IN (
        ('pending', 'paid'),
        ('pending', 'cancelled'),
        ('paid',    'shipped'),
        ('paid',    'cancelled'),
        ('shipped', 'delivered')
    ) THEN
        RAISE EXCEPTION 'order % cannot change from % to %', p_order_id, v_old_status, p_new_status
            USING ERRCODE = 'JD003';
    END IF;

    IF p_new_status IN ('cancelled', 'shipped') THEN
        -- Lock the order's inventory rows in product_id order (see above).
        -- Rows are locked as they come out of the sort, so the lock order is
        -- the sort order.
        PERFORM 1
        FROM inventory i
        JOIN order_items oi ON oi.product_id = i.product_id
        WHERE oi.order_id = p_order_id
          AND i.warehouse_id = v_warehouse_id
        ORDER BY i.product_id
        FOR UPDATE OF i;

        -- Cancelling releases the reservation; shipping also removes the
        -- goods from stock on hand.
        UPDATE inventory i
        SET quantity_reserved = i.quantity_reserved - oi.quantity,
            quantity_on_hand  = i.quantity_on_hand
                                - CASE WHEN p_new_status = 'shipped' THEN oi.quantity ELSE 0 END
        FROM order_items oi
        WHERE oi.order_id = p_order_id
          AND i.product_id = oi.product_id
          AND i.warehouse_id = v_warehouse_id;

        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
        SELECT count(*) INTO v_line_count FROM order_items oi WHERE oi.order_id = p_order_id;

        -- create_order() only accepts lines with an inventory row, so a missing
        -- row means the data was changed outside the functions.
        IF v_updated_rows <> v_line_count THEN
            RAISE EXCEPTION 'order %: % of % lines have no inventory row in warehouse %',
                    p_order_id, v_line_count - v_updated_rows, v_line_count, v_warehouse_id
                USING ERRCODE = 'data_exception';
        END IF;
    END IF;

    UPDATE orders o
    SET status = p_new_status
    WHERE o.order_id = p_order_id;

    RETURN v_old_status;
END;
$$;

COMMENT ON FUNCTION update_order_status(BIGINT, TEXT) IS
    'Changes an order status along allowed transitions, releasing (cancel) or deducting (ship) stock. Returns the previous status. Raises JD003 for invalid transitions.';
