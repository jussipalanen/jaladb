-- 0001_sample_data.sql
--
-- Small, deterministic sample dataset for local development and demos.
--
-- Re-runnable: all existing data is removed first and identity counters are
-- reset. Rows reference each other through natural keys (category name, SKU,
-- email, warehouse code) instead of hard-coded generated ids.
--
-- Stock model used by the data:
--   * quantity_on_hand is the current physical stock (shipped/delivered orders
--     have already left the warehouse).
--   * quantity_reserved equals the units of open ('pending' or 'paid') orders.

TRUNCATE order_items, orders, inventory, products, categories, warehouses, customers
    RESTART IDENTITY;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
INSERT INTO categories (name, description) VALUES
    ('Electronics',     'Audio, displays, peripherals and chargers'),
    ('Home & Kitchen',  'Cookware and small kitchen appliances'),
    ('Outdoor',         'Camping and hiking equipment'),
    ('Books',           'Technical books and guides'),
    ('Office',          'Office furniture and supplies'),
    ('Sports',          'Training and fitness equipment');

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
INSERT INTO products (category_id, sku, name, description, price, is_active)
SELECT c.category_id, p.sku, p.name, p.description, p.price, p.is_active
FROM (VALUES
    ('Electronics',    'ELEC-1001', 'Noise-Cancelling Headphones',  'Over-ear Bluetooth headphones with ANC', 199.00, true),
    ('Electronics',    'ELEC-1002', 'Wireless Earbuds',             'In-ear earbuds with charging case',       89.90, true),
    ('Electronics',    'ELEC-1003', 'USB-C Charger 65 W',           'GaN charger with two USB-C ports',        39.90, true),
    ('Electronics',    'ELEC-1004', '27" 4K Monitor',               'IPS panel, USB-C with power delivery',   349.00, true),
    ('Electronics',    'ELEC-1005', 'Mechanical Keyboard',          'Tenkeyless, hot-swappable switches',     129.00, true),
    ('Home & Kitchen', 'HOME-2001', 'Cast Iron Skillet 26 cm',      'Pre-seasoned cast iron pan',              49.90, true),
    ('Home & Kitchen', 'HOME-2002', 'Electric Kettle 1.7 L',        'Stainless steel, temperature control',    44.90, true),
    ('Home & Kitchen', 'HOME-2003', 'Chef''s Knife 20 cm',          'Forged stainless steel blade',            79.00, true),
    ('Home & Kitchen', 'HOME-2004', 'Burr Coffee Grinder',          'Conical burr grinder, 40 settings',       59.90, true),
    ('Outdoor',        'OUTD-3001', 'Down Sleeping Bag -10 °C',     'Three-season mummy sleeping bag',        229.00, true),
    ('Outdoor',        'OUTD-3002', 'Trekking Poles (pair)',        'Carbon, adjustable length',               69.90, true),
    ('Outdoor',        'OUTD-3003', 'Insulated Water Bottle 1 L',   'Double-wall vacuum insulated',            29.90, true),
    ('Outdoor',        'OUTD-3004', 'Two-Person Tent',              'Freestanding dome tent, 2.1 kg',         289.00, true),
    ('Books',          'BOOK-4001', 'SQL Performance Field Guide',  'Indexing and query tuning in practice',   54.00, true),
    ('Books',          'BOOK-4002', 'Nordic Home Cooking',          'Seasonal recipes from the north',         32.00, true),
    ('Books',          'BOOK-4003', 'Trail Running Basics',         'Training plans for new trail runners',    24.50, true),
    ('Office',         'OFFC-5001', 'Ergonomic Office Chair',       'Mesh back, adjustable lumbar support',   399.00, true),
    ('Office',         'OFFC-5002', 'Standing Desk Frame',          'Dual-motor electric frame',              459.00, true),
    ('Office',         'OFFC-5003', 'A5 Dotted Notebook (3-pack)',  '120 g/m² paper, lay-flat binding',        14.90, true),
    ('Office',         'OFFC-5004', 'LED Desk Lamp',                'Dimmable, adjustable colour temperature', 49.00, true),
    ('Sports',         'SPRT-6001', 'Running Shoes',                'Neutral road running shoes',             139.90, true),
    ('Sports',         'SPRT-6002', 'Yoga Mat 6 mm',                'Non-slip natural rubber',                 34.90, true),
    ('Sports',         'SPRT-6003', 'Adjustable Dumbbells 24 kg',   'Pair, quick weight selection',           249.00, true),
    ('Sports',         'SPRT-6004', 'Cross-Country Ski Wax Kit',    'Discontinued: kept for order history',    39.00, false)
) AS p (category, sku, name, description, price, is_active)
JOIN categories c ON c.name = p.category;

-- ---------------------------------------------------------------------------
-- Warehouses
-- ---------------------------------------------------------------------------
INSERT INTO warehouses (code, name, city, country_code) VALUES
    ('HEL1', 'Helsinki Distribution Centre', 'Vantaa',  'FI'),
    ('TRE1', 'Tampere Warehouse',            'Tampere', 'FI'),
    ('OUL1', 'Oulu Warehouse',               'Oulu',    'FI');

-- ---------------------------------------------------------------------------
-- Customers: fictional people ("Esimerkki" is Finnish for "example";
-- example.com is reserved for documentation, RFC 2606)
-- ---------------------------------------------------------------------------
INSERT INTO customers (email, first_name, last_name, created_at) VALUES
    ('aino.esimerkki@example.com',    'Aino',   'Esimerkki', '2025-11-02 09:12:00+02'),
    ('mikko.esimerkki@example.com',   'Mikko',  'Esimerkki', '2025-11-15 18:40:00+02'),
    ('emma.esimerkki@example.com',    'Emma',   'Esimerkki', '2025-12-01 12:05:00+02'),
    ('juho.esimerkki@example.com',    'Juho',   'Esimerkki', '2025-12-19 20:31:00+02'),
    ('sofia.esimerkki@example.com',   'Sofia',  'Esimerkki', '2026-01-07 08:55:00+02'),
    ('oskari.esimerkki@example.com',  'Oskari', 'Esimerkki', '2026-01-22 16:20:00+02'),
    ('linnea.esimerkki@example.com',  'Linnea', 'Esimerkki', '2026-02-10 10:02:00+02'),
    ('elias.esimerkki@example.com',   'Elias',  'Esimerkki', '2026-03-04 14:47:00+02'),
    ('helmi.esimerkki@example.com',   'Helmi',  'Esimerkki', '2026-03-28 19:15:00+02'),
    ('leo.esimerkki@example.com',     'Leo',    'Esimerkki', '2026-05-11 07:38:00+03'),
    ('maria.esimerkki@example.com',   'María',  'Esimerkki', '2026-06-20 13:26:00+03'),
    -- Customer without orders, useful for "no results" cases.
    ('daniel.esimerkki@example.com',  'Daniel', 'Esimerkki', '2026-08-30 11:09:00+03');

-- ---------------------------------------------------------------------------
-- Inventory (current physical stock per warehouse)
-- ---------------------------------------------------------------------------
INSERT INTO inventory (product_id, warehouse_id, quantity_on_hand)
SELECT p.product_id, w.warehouse_id, i.quantity_on_hand
FROM (VALUES
    -- Helsinki stocks the full range.
    ('ELEC-1001', 'HEL1',  40), ('ELEC-1002', 'HEL1', 120), ('ELEC-1003', 'HEL1', 200),
    ('ELEC-1004', 'HEL1',  25), ('ELEC-1005', 'HEL1',  60),
    ('HOME-2001', 'HEL1',  35), ('HOME-2002', 'HEL1',  50), ('HOME-2003', 'HEL1',  30),
    ('HOME-2004', 'HEL1',  20),
    ('OUTD-3001', 'HEL1',  15), ('OUTD-3002', 'HEL1',  45), ('OUTD-3003', 'HEL1', 150),
    ('OUTD-3004', 'HEL1',  10),
    ('BOOK-4001', 'HEL1',  30), ('BOOK-4002', 'HEL1',  25), ('BOOK-4003', 'HEL1',  18),
    ('OFFC-5001', 'HEL1',  12), ('OFFC-5002', 'HEL1',   8), ('OFFC-5003', 'HEL1', 300),
    ('OFFC-5004', 'HEL1',  40),
    ('SPRT-6001', 'HEL1',  55), ('SPRT-6002', 'HEL1',  70), ('SPRT-6003', 'HEL1',  10),
    ('SPRT-6004', 'HEL1',   4),
    -- Tampere carries a subset.
    ('ELEC-1002', 'TRE1',  40), ('ELEC-1003', 'TRE1',  60),
    ('HOME-2001', 'TRE1',  12), ('HOME-2002', 'TRE1',  20),
    ('OUTD-3001', 'TRE1',  10), ('OUTD-3003', 'TRE1',  60),
    ('BOOK-4002', 'TRE1',  15), ('BOOK-4003', 'TRE1',  10),
    ('OFFC-5003', 'TRE1', 100),
    ('SPRT-6001', 'TRE1',  25), ('SPRT-6002', 'TRE1',  30), ('SPRT-6003', 'TRE1',   3),
    -- Oulu focuses on outdoor gear; the tent is currently out of stock.
    ('OUTD-3001', 'OUL1',   8), ('OUTD-3002', 'OUL1',  20), ('OUTD-3003', 'OUL1',  40),
    ('OUTD-3004', 'OUL1',   0), ('SPRT-6002', 'OUL1',  15), ('ELEC-1003', 'OUL1',  25)
) AS i (sku, warehouse_code, quantity_on_hand)
JOIN products p   ON p.sku = i.sku
JOIN warehouses w ON w.code = i.warehouse_code;

-- ---------------------------------------------------------------------------
-- Orders and order items
-- ---------------------------------------------------------------------------
-- Staging tables for the order data; dropped again at the end of this file.
CREATE TEMPORARY TABLE seed_orders (
    ref             INTEGER PRIMARY KEY,
    customer_email  TEXT        NOT NULL,
    warehouse_code  TEXT        NOT NULL,
    status          TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL
);

CREATE TEMPORARY TABLE seed_order_items (
    order_ref  INTEGER NOT NULL REFERENCES seed_orders (ref),
    sku        TEXT    NOT NULL,
    quantity   INTEGER NOT NULL
);

INSERT INTO seed_orders VALUES
    ( 1, 'aino.esimerkki@example.com',    'HEL1', 'delivered', '2026-01-08 10:15:00+02'),
    ( 2, 'mikko.esimerkki@example.com',   'HEL1', 'delivered', '2026-01-19 17:42:00+02'),
    ( 3, 'emma.esimerkki@example.com',    'TRE1', 'delivered', '2026-02-03 09:30:00+02'),
    ( 4, 'juho.esimerkki@example.com',    'HEL1', 'cancelled', '2026-02-14 21:05:00+02'),
    ( 5, 'sofia.esimerkki@example.com',   'HEL1', 'delivered', '2026-02-27 12:48:00+02'),
    ( 6, 'aino.esimerkki@example.com',    'TRE1', 'delivered', '2026-03-11 08:20:00+02'),
    ( 7, 'oskari.esimerkki@example.com',  'OUL1', 'delivered', '2026-03-30 15:10:00+03'),
    ( 8, 'linnea.esimerkki@example.com',  'HEL1', 'delivered', '2026-04-16 11:37:00+03'),
    ( 9, 'elias.esimerkki@example.com',   'HEL1', 'delivered', '2026-05-05 19:58:00+03'),
    (10, 'helmi.esimerkki@example.com',   'TRE1', 'delivered', '2026-05-22 13:03:00+03'),
    (11, 'mikko.esimerkki@example.com',   'HEL1', 'delivered', '2026-06-09 10:44:00+03'),
    (12, 'leo.esimerkki@example.com',     'OUL1', 'shipped',   '2026-07-01 16:25:00+03'),
    (13, 'maria.esimerkki@example.com',   'HEL1', 'shipped',   '2026-07-18 09:12:00+03'),
    (14, 'aino.esimerkki@example.com',    'HEL1', 'cancelled', '2026-08-02 22:17:00+03'),
    (15, 'emma.esimerkki@example.com',    'TRE1', 'paid',      '2026-08-25 18:30:00+03'),
    (16, 'juho.esimerkki@example.com',    'HEL1', 'paid',      '2026-09-10 07:55:00+03'),
    (17, 'sofia.esimerkki@example.com',   'TRE1', 'pending',   '2026-09-18 20:40:00+03'),
    (18, 'linnea.esimerkki@example.com',  'HEL1', 'pending',   '2026-09-22 12:14:00+03');

INSERT INTO seed_order_items VALUES
    ( 1, 'ELEC-1001', 1), ( 1, 'ELEC-1003', 2),
    ( 2, 'HOME-2001', 1), ( 2, 'HOME-2003', 1),
    ( 3, 'OUTD-3001', 1), ( 3, 'OUTD-3003', 2),
    ( 4, 'OFFC-5001', 1),
    ( 5, 'BOOK-4001', 1), ( 5, 'OFFC-5003', 3),
    ( 6, 'SPRT-6001', 1), ( 6, 'SPRT-6002', 1),
    ( 7, 'OUTD-3002', 1), ( 7, 'OUTD-3003', 1),
    ( 8, 'ELEC-1004', 1), ( 8, 'ELEC-1005', 1),
    ( 9, 'HOME-2002', 1), ( 9, 'HOME-2004', 1),
    (10, 'BOOK-4002', 2), (10, 'BOOK-4003', 1),
    (11, 'OFFC-5002', 1), (11, 'OFFC-5004', 1),
    (12, 'OUTD-3001', 1),
    (13, 'ELEC-1002', 2),
    (14, 'HOME-2003', 1),
    (15, 'SPRT-6003', 1), (15, 'SPRT-6002', 2),
    (16, 'ELEC-1001', 1), (16, 'ELEC-1002', 1),
    (17, 'HOME-2001', 1), (17, 'HOME-2002', 1),
    (18, 'OFFC-5003', 5), (18, 'BOOK-4001', 1);

-- Orders are inserted one at a time so each generated order_id can be linked
-- to its items. Unit prices are copied from the current product price, and the
-- stored order total is calculated from the inserted lines.
DO $$
DECLARE
    seed_order  RECORD;
    new_id      BIGINT;
    item_count  INTEGER;
BEGIN
    FOR seed_order IN SELECT * FROM seed_orders ORDER BY ref LOOP
        INSERT INTO orders (customer_id, warehouse_id, status, created_at)
        SELECT c.customer_id, w.warehouse_id, seed_order.status, seed_order.created_at
        FROM customers c, warehouses w
        WHERE lower(c.email) = lower(seed_order.customer_email)
          AND w.code = seed_order.warehouse_code
        RETURNING order_id INTO new_id;

        IF new_id IS NULL THEN
            RAISE EXCEPTION 'Seed order % references an unknown customer or warehouse', seed_order.ref;
        END IF;

        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
        SELECT new_id, p.product_id, i.quantity, p.price
        FROM seed_order_items i
        JOIN products p ON p.sku = i.sku
        WHERE i.order_ref = seed_order.ref;

        GET DIAGNOSTICS item_count = ROW_COUNT;
        IF item_count <> (SELECT count(*) FROM seed_order_items WHERE order_ref = seed_order.ref) THEN
            RAISE EXCEPTION 'Seed order % references an unknown SKU', seed_order.ref;
        END IF;

        UPDATE orders
        SET total_amount = (SELECT sum(line_total) FROM order_items WHERE order_id = new_id)
        WHERE order_id = new_id;
    END LOOP;
END
$$;

-- Reserve stock for open orders. The inventory CHECK constraints reject the
-- whole seed if a reservation would exceed the stock on hand.
UPDATE inventory inv
SET quantity_reserved = open_items.quantity
FROM (
    SELECT o.warehouse_id, oi.product_id, sum(oi.quantity) AS quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status IN ('pending', 'paid')
    GROUP BY o.warehouse_id, oi.product_id
) AS open_items
WHERE inv.warehouse_id = open_items.warehouse_id
  AND inv.product_id = open_items.product_id;

DROP TABLE seed_order_items, seed_orders;
