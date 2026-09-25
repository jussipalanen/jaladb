-- EXPLAIN ANALYZE for the lookup behind get_product_availability().
--
--   ./dev seed-large
--   ./dev psql < docs/sql/explain_product_availability.sql
--
-- Product GEN-005000 in warehouse HEL1. No index was added for this function:
-- the plan shows that the primary key of inventory already serves the lookup.

\pset pager off

SELECT p.product_id AS product_id, w.warehouse_id AS warehouse_id
FROM products p, warehouses w
WHERE p.sku = 'GEN-005000' AND w.code = 'HEL1'
\gset

\echo
\echo '=== The inventory lookup (primary key: product_id, warehouse_id) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT i.quantity_on_hand, i.quantity_reserved, i.quantity_available
FROM inventory i
WHERE i.product_id = :product_id
  AND i.warehouse_id = :warehouse_id;

\echo
\echo '=== The existence checks (primary keys of products and warehouses) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT EXISTS (SELECT 1 FROM products p WHERE p.product_id = :product_id);

\echo
\echo '=== The whole function call ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM get_product_availability(:product_id, :warehouse_id);
