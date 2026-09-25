-- generate_large_dataset.sql
--
-- Optional large dataset for performance work (indexing, EXPLAIN ANALYZE).
-- `npm run db:seed:large` runs the normal seed first and then this file, in one
-- transaction, so the small hand-written dataset is kept and generated rows are
-- added on top of it.
--
-- Size is controlled by the custom setting jaladb.seed_scale (default 1):
--
--   scale 1  ->  10,000 products, 10,000 customers, 100,000 orders,
--                ~250,000 order lines
--
-- Tests use a small scale, e.g.  SET LOCAL jaladb.seed_scale = '0.02';
--
-- The data is reproducible: setseed() fixes the sequence of random() values.
-- Generated rows keep the same invariants as the small seed: order totals
-- match their lines, and reserved stock equals the units of open orders and
-- never exceeds stock on hand.

SELECT setseed(0.42);

CREATE TEMPORARY TABLE gen_params AS
SELECT greatest(10, round(10000 * scale))::int  AS product_count,
       greatest(10, round(10000 * scale))::int  AS customer_count,
       greatest(10, round(100000 * scale))::int AS order_count
FROM (
    SELECT coalesce(nullif(current_setting('jaladb.seed_scale', true), ''), '1')::numeric AS scale
) AS setting;

-- ---------------------------------------------------------------------------
-- Products (spread over the existing categories) and their stock
-- ---------------------------------------------------------------------------
INSERT INTO products (category_id, sku, name, price)
SELECT
    category.ids[1 + i % cardinality(category.ids)],
    'GEN-' || lpad(i::text, 6, '0'),
    (ARRAY['Compact', 'Premium', 'Classic', 'Lightweight', 'Pro', 'Eco', 'Nordic', 'Urban'])
        [1 + floor(random() * 8)::int]
    || ' '
    || (ARRAY['Headphones', 'Kettle', 'Backpack', 'Notebook', 'Lamp', 'Jacket', 'Bottle', 'Chair', 'Tent', 'Mat'])
        [1 + floor(random() * 10)::int]
    || ' ' || i,
    -- Skewed towards cheaper products.
    round((4.90 + power(random(), 2) * 495)::numeric, 2)
FROM gen_params,
     generate_series(1, product_count) AS i,
     (SELECT array_agg(category_id ORDER BY category_id) AS ids FROM categories) AS category;

INSERT INTO inventory (product_id, warehouse_id, quantity_on_hand)
SELECT p.product_id, w.warehouse_id, floor(random() * 500)::int
FROM products p
CROSS JOIN warehouses w
WHERE p.sku LIKE 'GEN-%';

-- Generated products numbered 0..n-1, so order lines can pick products by
-- position with a plain join (large arrays would be decompressed on every
-- element access, which is very slow for hundreds of thousands of rows).
CREATE TEMPORARY TABLE gen_products AS
SELECT (row_number() OVER (ORDER BY product_id) - 1)::int AS pos, product_id, price
FROM products
WHERE sku LIKE 'GEN-%';
ANALYZE gen_products;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
INSERT INTO customers (email, first_name, last_name, created_at)
SELECT
    'customer' || lpad(i::text, 6, '0') || '@example.com',
    (ARRAY['Aino', 'Eino', 'Helmi', 'Onni', 'Aada', 'Leo', 'Venla', 'Elias', 'Ella', 'Oliver',
           'Sofia', 'Väinö', 'Lilja', 'Toivo', 'Emma', 'Juho', 'Iida', 'Niilo', 'Olivia', 'Eetu'])
        [1 + floor(random() * 20)::int],
    'Esimerkki',
    timestamptz '2023-01-01 00:00:00+00' + random() * interval '730 days'
FROM gen_params, generate_series(1, customer_count) AS i;

-- ---------------------------------------------------------------------------
-- Orders and order lines are generated into temporary tables first, so every
-- order can be inserted once with its final total. Inserting orders and then
-- UPDATE-ing their totals would leave a dead version of every order row
-- behind, doubling the table and inflating EXPLAIN measurements.
-- ---------------------------------------------------------------------------

-- Orders: January 2024 - September 2026. Some customers order much more often
-- than others. Recent orders are still open; older ones are delivered or
-- occasionally cancelled.
CREATE TEMPORARY TABLE gen_orders AS
SELECT
    generated.pos,
    generated.customer_id,
    generated.warehouse_id,
    CASE
        WHEN generated.created_at >= timestamptz '2026-09-10 00:00:00+00'
            THEN (ARRAY['pending', 'paid', 'shipped'])[1 + floor(generated.status_roll * 3)::int]
        WHEN generated.status_roll < 0.05 THEN 'cancelled'
        ELSE 'delivered'
    END AS status,
    generated.created_at
FROM (
    SELECT
        pos,
        customer.ids[1 + floor(power(random(), 1.5) * cardinality(customer.ids))::int] AS customer_id,
        warehouse.ids[1 + floor(random() * cardinality(warehouse.ids))::int] AS warehouse_id,
        timestamptz '2024-01-01 00:00:00+00'
            + random() * (timestamptz '2026-09-24 00:00:00+00' - timestamptz '2024-01-01 00:00:00+00')
            AS created_at,
        random() AS status_roll
    FROM gen_params,
         generate_series(1, order_count) AS pos,
         (SELECT array_agg(customer_id ORDER BY customer_id) AS ids
          FROM customers WHERE email LIKE 'customer%@example.com') AS customer,
         (SELECT array_agg(warehouse_id ORDER BY warehouse_id) AS ids FROM warehouses) AS warehouse
) AS generated;

-- Order lines: 1-4 distinct generated products per order, mostly quantity 1.
-- Stepping through the products by a prime keeps the products of one order
-- distinct; DISTINCT ON only guards against degenerate tiny scales.
CREATE TEMPORARY TABLE gen_order_lines AS
SELECT DISTINCT ON (pick.pos, gp.product_id)
    pick.pos,
    gp.product_id,
    1 + floor(power(random(), 3) * 4)::int AS quantity,
    gp.price AS unit_price
FROM (
    SELECT o.pos,
           floor(random() * gen_params.product_count)::int AS start,
           1 + floor(random() * 4)::int AS line_count
    FROM gen_orders o, gen_params
) AS pick
CROSS JOIN LATERAL generate_series(1, pick.line_count) AS line
JOIN gen_products gp
  ON gp.pos = (pick.start + line * 7919) % (SELECT product_count FROM gen_params);

-- MERGE ... RETURNING (PostgreSQL 17+) can return columns of the source row
-- next to the generated order_id, which links each generated position to its
-- new order. Orders are inserted in date order, like real orders arrive.
CREATE TEMPORARY TABLE gen_order_ids (pos INTEGER PRIMARY KEY, order_id BIGINT NOT NULL);

WITH inserted AS (
    MERGE INTO orders o
    USING (
        SELECT g.*, totals.total_amount
        FROM gen_orders g
        JOIN (
            SELECT pos, sum(quantity * unit_price) AS total_amount
            FROM gen_order_lines
            GROUP BY pos
        ) AS totals USING (pos)
        ORDER BY g.created_at
    ) AS src
    ON false
    WHEN NOT MATCHED THEN
        INSERT (customer_id, warehouse_id, status, total_amount, created_at)
        VALUES (src.customer_id, src.warehouse_id, src.status, src.total_amount, src.created_at)
    RETURNING src.pos, o.order_id
)
INSERT INTO gen_order_ids (pos, order_id)
SELECT pos, order_id FROM inserted;

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT ids.order_id, l.product_id, l.quantity, l.unit_price
FROM gen_order_lines l
JOIN gen_order_ids ids USING (pos)
ORDER BY ids.order_id, l.product_id;

-- ---------------------------------------------------------------------------
-- Reservations for all open orders (seeded and generated). Where random stock
-- is lower than the open demand, stock on hand is raised to cover it.
-- ---------------------------------------------------------------------------
UPDATE inventory inv
SET quantity_on_hand  = greatest(inv.quantity_on_hand, demand.quantity),
    quantity_reserved = demand.quantity
FROM (
    SELECT o.warehouse_id, oi.product_id, sum(oi.quantity)::int AS quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status IN ('pending', 'paid')
    GROUP BY o.warehouse_id, oi.product_id
) AS demand
WHERE inv.warehouse_id = demand.warehouse_id
  AND inv.product_id = demand.product_id;

DROP TABLE gen_params, gen_products, gen_orders, gen_order_lines, gen_order_ids;

-- Fresh planner statistics, so EXPLAIN reflects the new data volume.
ANALYZE;
