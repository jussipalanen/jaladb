-- EXPLAIN ANALYZE for the query behind get_best_selling_products(), with
-- no index, a B-tree and the BRIN index on orders.created_at.
--
--   ./dev seed-large
--   ./dev psql < docs/sql/explain_best_selling_products.sql
--
-- Each variant runs in a transaction that is rolled back, so the database
-- keeps its real index (orders_created_at_brin_idx) afterwards.

\pset pager off

-- The body of get_best_selling_products().
PREPARE best_selling(DATE, DATE, INTEGER) AS
WITH sales AS (
    SELECT oi.product_id AS sold_product_id,
           sum(oi.quantity)::BIGINT AS total_units,
           sum(oi.line_total) AS total_revenue
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status IN ('paid', 'shipped', 'delivered')
      AND o.created_at >= $1
      AND o.created_at < $2 + 1
    GROUP BY oi.product_id
    ORDER BY total_units DESC, total_revenue DESC, oi.product_id
    LIMIT $3
)
SELECT p.product_id, p.sku, p.name, s.total_units, s.total_revenue
FROM sales s
JOIN products p ON p.product_id = s.sold_product_id
ORDER BY s.total_units DESC, s.total_revenue DESC, p.product_id;

\echo
\echo '=== One day, no index on created_at ==='
BEGIN;
DROP INDEX orders_created_at_brin_idx;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE best_selling('2026-06-15', '2026-06-15', 10);
ROLLBACK;

\echo
\echo '=== One day, B-tree on created_at ==='
BEGIN;
DROP INDEX orders_created_at_brin_idx;
CREATE INDEX orders_created_at_btree ON orders (created_at);
ANALYZE orders;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE best_selling('2026-06-15', '2026-06-15', 10);
ROLLBACK;

\echo
\echo '=== One day, BRIN (the real index) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE best_selling('2026-06-15', '2026-06-15', 10);

\echo
\echo '=== One month, no index on created_at ==='
BEGIN;
DROP INDEX orders_created_at_brin_idx;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE best_selling('2026-06-01', '2026-06-30', 10);
ROLLBACK;

\echo
\echo '=== One month, BRIN (the real index) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE best_selling('2026-06-01', '2026-06-30', 10);

\echo
\echo '=== Index sizes ==='
BEGIN;
CREATE INDEX orders_created_at_btree ON orders (created_at);
SELECT relname AS index, pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class
WHERE relname IN ('orders_created_at_brin_idx', 'orders_created_at_btree');
ROLLBACK;

DEALLOCATE best_selling;
