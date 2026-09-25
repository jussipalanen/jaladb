-- Before/after EXPLAIN ANALYZE for the query behind get_customer_orders().
--
--   ./dev seed-large
--   ./dev psql < docs/sql/explain_customer_orders.sql
--
-- Customer 5012 (customer005000@example.com) has 11 orders, a typical number
-- in the generated dataset. The generator is deterministic, so the plans
-- should match docs/query-optimization.md (timings vary by machine).

\set customer_id 5012
\pset pager off

-- The body of get_customer_orders(). EXPLAIN on the function call itself would
-- only show an opaque "Function Scan", because PL/pgSQL runs its queries
-- internally.
PREPARE customer_orders(BIGINT) AS
SELECT
    o.order_id,
    o.status,
    o.total_amount,
    COALESCE(items.unit_count, 0)::INTEGER AS item_count,
    o.created_at
FROM orders o
LEFT JOIN LATERAL (
    SELECT sum(oi.quantity) AS unit_count
    FROM order_items oi
    WHERE oi.order_id = o.order_id
) AS items ON true
WHERE o.customer_id = $1
ORDER BY o.created_at DESC, o.order_id DESC;

\echo
\echo '=== Before: without orders_customer_id_idx ==='
-- DDL is transactional in PostgreSQL: the index is dropped only inside this
-- transaction and is back after ROLLBACK.
BEGIN;
DROP INDEX orders_customer_id_idx;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE customer_orders(:customer_id);
ROLLBACK;

\echo
\echo '=== After: with orders_customer_id_idx ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE customer_orders(:customer_id);

DEALLOCATE customer_orders;
