-- get_best_selling_products(start_date, end_date, limit)
--
-- Top products by units sold in a date range.
--
--   SELECT * FROM get_best_selling_products('2026-01-01', '2026-06-30', 5);
--
-- Columns:
--   product_id, sku, name
--   units_sold  units in sold orders
--   revenue     sum of order_items.line_total (prices at purchase time)
--
-- Rules:
--   * Sold means order status paid, shipped or delivered. Pending orders are
--     not paid yet and cancelled orders never happened.
--   * Both dates are inclusive and interpreted in the session time zone (UTC
--     by default). The filter is created_at >= start AND created_at < end + 1
--     day: the whole last day counts, and the condition can use an index on
--     created_at because the column is not wrapped in a function.
--   * Ordered by units sold, then revenue, then product_id, so results are
--     deterministic.
--
-- Errors:
--   22023 (invalid_parameter_value)  NULL argument, start after end, limit < 1

CREATE OR REPLACE FUNCTION get_best_selling_products(
    p_start_date  DATE,
    p_end_date    DATE,
    p_limit       INTEGER
)
RETURNS TABLE (
    product_id  BIGINT,
    sku         TEXT,
    name        TEXT,
    units_sold  BIGINT,
    revenue     NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_limit IS NULL THEN
        RAISE EXCEPTION 'start date, end date and limit must not be NULL'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_start_date > p_end_date THEN
        RAISE EXCEPTION 'start date % is after end date %', p_start_date, p_end_date
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_limit < 1 THEN
        RAISE EXCEPTION 'limit must be at least 1, got %', p_limit
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Aggregate order lines first, then join products for the top rows only.
    -- The output column names (units_sold, revenue, ...) are also PL/pgSQL
    -- variables here, so the query uses its own names (total_units,
    -- total_revenue) and table-qualified columns.
    RETURN QUERY
    WITH sales AS (
        SELECT oi.product_id AS sold_product_id,
               sum(oi.quantity)::BIGINT AS total_units,
               sum(oi.line_total) AS total_revenue
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.order_id
        WHERE o.status IN ('paid', 'shipped', 'delivered')
          AND o.created_at >= p_start_date
          AND o.created_at < p_end_date + 1
        GROUP BY oi.product_id
        ORDER BY total_units DESC, total_revenue DESC, oi.product_id
        LIMIT p_limit
    )
    SELECT p.product_id, p.sku, p.name, s.total_units, s.total_revenue
    FROM sales s
    JOIN products p ON p.product_id = s.sold_product_id
    ORDER BY s.total_units DESC, s.total_revenue DESC, p.product_id;
END;
$$;

COMMENT ON FUNCTION get_best_selling_products(DATE, DATE, INTEGER) IS
    'Top products by units sold (paid, shipped, delivered orders) between two inclusive dates.';
