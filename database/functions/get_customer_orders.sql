-- get_customer_orders(customer_id)
--
-- Returns a customer's orders, newest first.
--
--   SELECT * FROM get_customer_orders(42);
--
-- Columns:
--   order_id      order identifier
--   status        pending | paid | shipped | delivered | cancelled
--   total_amount  stored order total (EUR)
--   item_count    number of units across all order lines
--   created_at    when the order was placed
--
-- Errors:
--   P0002 (no_data_found)            the customer does not exist
--   22023 (invalid_parameter_value)  customer id is NULL
--
-- A customer who exists but has no orders gets an empty result. Raising an
-- error for unknown customers lets callers tell "no such customer" (e.g. HTTP
-- 404) apart from "no orders yet" (an empty list) without a second query.

CREATE OR REPLACE FUNCTION get_customer_orders(p_customer_id BIGINT)
RETURNS TABLE (
    order_id      BIGINT,
    status        TEXT,
    total_amount  NUMERIC(12, 2),
    item_count    INTEGER,
    created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'customer id must not be NULL'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM customers c WHERE c.customer_id = p_customer_id) THEN
        RAISE EXCEPTION 'customer % does not exist', p_customer_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Columns are table-qualified because the RETURNS TABLE column names
    -- (order_id, status, ...) are also PL/pgSQL variables inside the body.
    RETURN QUERY
    SELECT
        o.order_id,
        o.status,
        o.total_amount,
        COALESCE(items.unit_count, 0)::INTEGER,
        o.created_at
    FROM orders o
    LEFT JOIN LATERAL (
        SELECT sum(oi.quantity) AS unit_count
        FROM order_items oi
        WHERE oi.order_id = o.order_id
    ) AS items ON true
    WHERE o.customer_id = p_customer_id
    ORDER BY o.created_at DESC, o.order_id DESC;
END;
$$;

COMMENT ON FUNCTION get_customer_orders(BIGINT) IS
    'Orders of one customer, newest first. Raises P0002 for an unknown customer.';
