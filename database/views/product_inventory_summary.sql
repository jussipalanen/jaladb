-- product_inventory_summary
--
-- One row per product with its stock summed over all warehouses:
--
--   SELECT * FROM product_inventory_summary WHERE sku = 'ELEC-1001';
--
-- Columns:
--   product_id, sku, name, price, is_active   product data
--   category                                  category name
--   warehouse_count                           warehouses that carry the product
--   quantity_on_hand, quantity_reserved,
--   quantity_available                        sums over all warehouses
--
-- Every product appears: the LEFT JOIN keeps products that are not stocked
-- anywhere (warehouse_count 0 and zero quantities), and inactive products are
-- included with is_active = false.
--
-- A plain view, not a materialized one: stock changes with every reservation,
-- so the summary is always computed from current data.
--
-- Filters on the view are applied before the aggregation. Measured on the
-- large dataset (docs/query-optimization.md, section 4): a lookup by
-- product_id or sku reads one product and its inventory rows through indexes
-- (~0.05 ms); PostgreSQL can push a sku filter below the GROUP BY because sku
-- is functionally dependent on the grouped primary key.

CREATE OR REPLACE VIEW product_inventory_summary AS
SELECT
    p.product_id,
    p.sku,
    p.name,
    c.name                                  AS category,
    p.price,
    p.is_active,
    count(i.warehouse_id)                   AS warehouse_count,
    COALESCE(sum(i.quantity_on_hand), 0)    AS quantity_on_hand,
    COALESCE(sum(i.quantity_reserved), 0)   AS quantity_reserved,
    COALESCE(sum(i.quantity_available), 0)  AS quantity_available
FROM products p
JOIN categories c ON c.category_id = p.category_id
LEFT JOIN inventory i ON i.product_id = p.product_id
GROUP BY p.product_id, c.category_id;

COMMENT ON VIEW product_inventory_summary IS
    'Stock per product summed over all warehouses; products without inventory show zeros.';
