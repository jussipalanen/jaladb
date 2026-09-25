-- 0003_order_status_history.sql
--
-- Audit log of order status changes. Rows are written only by the triggers in
-- database/triggers/order_status_history.sql:
--
--   * when an order is created:        old_status NULL -> its initial status
--   * when an order's status changes:  old_status -> new_status
--
-- History belongs to its order, so it is deleted together with the order
-- (orders themselves are protected by ON DELETE RESTRICT from customers).
--
-- Allowed status values are not repeated here: every row comes from an orders
-- row, which is already validated by orders_status_valid.

CREATE TABLE order_status_history (
    history_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    BIGINT      NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
    old_status  TEXT,
    new_status  TEXT        NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Every history row is a real change.
    CONSTRAINT order_status_history_status_changed
        CHECK (old_status IS DISTINCT FROM new_status)
);

COMMENT ON TABLE order_status_history IS
    'Status changes of orders, written by triggers on orders. old_status is NULL for the creation row.';
COMMENT ON COLUMN order_status_history.changed_at IS
    'Order creation time for the first row; transaction time for later changes. history_id orders changes made in the same transaction.';

-- "History of one order, in order" (and the ON DELETE CASCADE lookup, since
-- PostgreSQL does not index referencing columns automatically).
CREATE INDEX order_status_history_order_id_idx
    ON order_status_history (order_id, changed_at, history_id);
