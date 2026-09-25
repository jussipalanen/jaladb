-- 0001_core_schema.sql
--
-- Core commerce and inventory schema.
--
-- Conventions:
--   * Surrogate keys are BIGINT identity columns (GENERATED ALWAYS, so ids cannot
--     be supplied by accident). Natural keys (sku, email, warehouse code) are
--     protected with UNIQUE constraints.
--   * Money is NUMERIC(12, 2) in a single currency (EUR); never floating point.
--   * Timestamps are TIMESTAMPTZ.
--   * Constraints are named explicitly so violations are easy to recognise in
--     error messages and tests.
--   * Foreign keys default to ON DELETE RESTRICT: commercial history (orders,
--     stock) must not disappear as a side effect of deleting master data.
--     The only cascade is orders -> order_items, because order lines have no
--     meaning without their order.
--
-- Query-pattern indexes (e.g. orders by customer, orders by date) are
-- intentionally not created here. They are added in their own migrations
-- together with the queries and EXPLAIN ANALYZE evidence that justify them.
-- The indexes below exist only to enforce uniqueness.

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    category_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         TEXT        NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT categories_name_not_blank CHECK (btrim(name) <> '')
);

-- Case-insensitive uniqueness: "Books" and "books" are the same category.
CREATE UNIQUE INDEX categories_name_key ON categories (lower(name));

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    customer_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email        TEXT        NOT NULL,
    first_name   TEXT        NOT NULL,
    last_name    TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A deliberately simple sanity check, not full RFC 5322 validation.
    CONSTRAINT customers_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT customers_first_name_not_blank CHECK (btrim(first_name) <> ''),
    CONSTRAINT customers_last_name_not_blank CHECK (btrim(last_name) <> '')
);

-- Email addresses are compared case-insensitively; the original casing is kept.
CREATE UNIQUE INDEX customers_email_key ON customers (lower(email));

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    product_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id  BIGINT         NOT NULL REFERENCES categories (category_id) ON DELETE RESTRICT,
    sku          TEXT           NOT NULL,
    name         TEXT           NOT NULL,
    description  TEXT,
    price        NUMERIC(12, 2) NOT NULL,
    is_active    BOOLEAN        NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT products_sku_key UNIQUE (sku),
    CONSTRAINT products_sku_format CHECK (sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
    CONSTRAINT products_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT products_price_non_negative CHECK (price >= 0)
);

COMMENT ON COLUMN products.price IS
    'Current list price in EUR. Orders copy it to order_items.unit_price at purchase time.';
COMMENT ON COLUMN products.is_active IS
    'Inactive products are kept for order history but should not be sold.';

-- ---------------------------------------------------------------------------
-- warehouses
-- ---------------------------------------------------------------------------
CREATE TABLE warehouses (
    warehouse_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code          TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    city          TEXT        NOT NULL,
    country_code  TEXT        NOT NULL,
    is_active     BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT warehouses_code_key UNIQUE (code),
    CONSTRAINT warehouses_code_format CHECK (code ~ '^[A-Z0-9]{2,10}$'),
    CONSTRAINT warehouses_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT warehouses_country_code_format CHECK (country_code ~ '^[A-Z]{2}$')
);

COMMENT ON COLUMN warehouses.country_code IS 'ISO 3166-1 alpha-2 country code.';

-- ---------------------------------------------------------------------------
-- inventory: stock of one product in one warehouse
-- ---------------------------------------------------------------------------
CREATE TABLE inventory (
    product_id          BIGINT  NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
    warehouse_id        BIGINT  NOT NULL REFERENCES warehouses (warehouse_id) ON DELETE RESTRICT,
    quantity_on_hand    INTEGER NOT NULL DEFAULT 0,
    quantity_reserved   INTEGER NOT NULL DEFAULT 0,
    -- VIRTUAL (PostgreSQL 18+): computed on read, so it can never drift from
    -- the two columns it is derived from and costs no storage.
    quantity_available  INTEGER GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) VIRTUAL,

    -- (product_id, warehouse_id) is the natural key; its index also serves
    -- "stock of product X" lookups via the leading column.
    PRIMARY KEY (product_id, warehouse_id),

    CONSTRAINT inventory_on_hand_non_negative CHECK (quantity_on_hand >= 0),
    CONSTRAINT inventory_reserved_non_negative CHECK (quantity_reserved >= 0),
    -- The core stock invariant: available stock can never become negative.
    CONSTRAINT inventory_reserved_within_on_hand CHECK (quantity_reserved <= quantity_on_hand)
);

COMMENT ON COLUMN inventory.quantity_on_hand IS
    'Physical units in the warehouse.';
COMMENT ON COLUMN inventory.quantity_reserved IS
    'Units promised to open orders but not yet shipped.';

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    order_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id   BIGINT         NOT NULL REFERENCES customers (customer_id) ON DELETE RESTRICT,
    warehouse_id  BIGINT         NOT NULL REFERENCES warehouses (warehouse_id) ON DELETE RESTRICT,
    status        TEXT           NOT NULL DEFAULT 'pending',
    total_amount  NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),

    -- TEXT + CHECK instead of an ENUM type: the list is short and changing it
    -- later is a simple constraint swap rather than an ALTER TYPE.
    CONSTRAINT orders_status_valid
        CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
    CONSTRAINT orders_total_amount_non_negative CHECK (total_amount >= 0)
);

COMMENT ON COLUMN orders.warehouse_id IS
    'Warehouse the whole order is fulfilled from.';
COMMENT ON COLUMN orders.total_amount IS
    'Sum of order_items.line_total, stored so order listings need no aggregation.';

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
    order_item_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id       BIGINT         NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
    product_id     BIGINT         NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
    quantity       INTEGER        NOT NULL,
    unit_price     NUMERIC(12, 2) NOT NULL,
    -- STORED: order lines are written once and read often by sales reports.
    line_total     NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,

    -- One line per product per order. The unique index also covers lookups
    -- of all items of an order (leading column order_id).
    CONSTRAINT order_items_order_product_key UNIQUE (order_id, product_id),
    CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT order_items_unit_price_non_negative CHECK (unit_price >= 0)
);

COMMENT ON COLUMN order_items.unit_price IS
    'Price per unit at the time of purchase (snapshot of products.price).';
