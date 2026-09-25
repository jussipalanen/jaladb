# JalaDB

[![CI](https://github.com/jussipalanen/jaladb/actions/workflows/ci.yml/badge.svg)](https://github.com/jussipalanen/jaladb/actions/workflows/ci.yml)

A PostgreSQL-focused portfolio project demonstrating practical database engineering
through a small commerce and inventory domain: relational design, integrity
constraints, PL/pgSQL, transactions, triggers, indexing, and testing against a
real database.

It is a database demonstration, not a webshop.

## Status

Done:

- Docker Compose setup with PostgreSQL 18 and Adminer
- Versioned SQL migrations plus repeatable function/view/trigger files
- Core schema with database-level integrity constraints
- Deterministic seed data, plus an optional large generated dataset
- Integration tests against real PostgreSQL, run in CI
- `get_customer_orders()`, `get_product_availability()`, `reserve_stock()`,
  `create_order()`, `get_best_selling_products()`
- Index optimisations (B-tree, BRIN) with `EXPLAIN ANALYZE` evidence
  ([docs/query-optimization.md](docs/query-optimization.md))
- Order status history, recorded by triggers
- `product_inventory_summary` view
- Node.js API (`backend/`) exposing the database functions over HTTP

Planned next: an optional React demo console (`frontend/`).

## Technology

- PostgreSQL 18
- Node.js 22+ and TypeScript (migration/seed tooling, API, tests)
- Fastify 5 for the API
- `pg` driver: plain SQL, no ORM
- Vitest
- Docker Compose, Adminer (web GUI)

## Getting started

Prerequisites: Docker with Compose, Node.js 22 or newer.

```bash
./dev setup      # create .env, npm install, start containers, migrate, seed
./dev test       # run the database integration tests
./dev api        # start the API on http://localhost:3000
./dev test-api   # run the API integration tests
```

### The `dev` helper

[`dev`](dev) wraps the common Docker and database tasks. Run `./dev help` for
the full list.

| Command                  | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `./dev up`               | Start PostgreSQL (`localhost:5432`) and Adminer (`localhost:8080`) |
| `./dev down`             | Stop the containers (data is kept)                              |
| `./dev restart`          | Restart the containers                                          |
| `./dev ps`               | Show container status                                           |
| `./dev logs [service]`   | Follow logs of all services, or of `postgres` / `adminer`       |
| `./dev psql [args]`      | Open `psql` in the database container                           |
| `./dev shell`            | Open a shell in the database container                          |
| `./dev migrate`          | Apply pending migrations                                        |
| `./dev status`           | List applied and pending migrations                             |
| `./dev seed`             | Replace all data with the sample dataset                        |
| `./dev seed-large`       | Replace all data with the sample + large generated dataset      |
| `./dev reset [-y]`       | Delete all data, then start, migrate and seed from scratch      |
| `./dev test`             | Run the database integration tests                              |
| `./dev adminer`          | Print the Adminer login URL and password                        |
| `./dev api`              | Start the API in watch mode on `http://localhost:3000`          |
| `./dev test-api`         | Run the API integration tests                                   |

SQL can be passed to `psql` directly or piped in:

```bash
./dev psql -c 'SELECT sku, name, price FROM products LIMIT 5'
./dev psql < my_query.sql
```

### Without the helper

The helper only calls standard commands:

```bash
cp .env.example .env
docker compose up -d --wait
npm install
npm run db:migrate          # apply pending migrations
npm run db:status           # list applied and pending migrations
npm run db:seed             # replace all data with the sample dataset
npm run db:seed:large       # sample data + ~100,000 generated orders
npm test                    # run the integration tests
npm run typecheck           # type-check the TypeScript tooling and tests
docker compose down         # stop (add -v to delete all data)
```

### Browsing the database

Adminer, a lightweight web GUI, runs at
<http://localhost:8080/?pgsql=postgres&username=jaladb&db=jaladb>. The link
preselects PostgreSQL and fills in the server, user and database, so only the
password from `.env` (`jaladb_local` by default) is needed. `./dev adminer`
prints both.

## Schema

```text
categories 1 ──< products  1 ──< inventory   >── 1 warehouses
customers  1 ──< orders    1 ──< order_items >── 1 products
orders       >── 1 warehouses   (fulfilling warehouse)
orders     1 ──< order_status_history   (written by triggers)
```

| Table         | Purpose                                                           |
| ------------- | ----------------------------------------------------------------- |
| `categories`  | Product categories (name unique, case-insensitive)                |
| `products`    | Catalogue with unique SKU, current price, active flag             |
| `warehouses`  | Stock locations with a unique code and ISO country code           |
| `inventory`   | Stock on hand and reserved stock per product and warehouse        |
| `customers`   | Customers with a unique, case-insensitive email                   |
| `orders`      | Order header: customer, fulfilling warehouse, status, stored total |
| `order_items` | Order lines with the unit price at purchase time                  |
| `order_status_history` | Every status change of an order, written by triggers     |

Design decisions:

- **Integrity lives in the database.** Named `CHECK`, `UNIQUE`, `NOT NULL` and
  foreign key constraints reject invalid data regardless of which client writes it.
  The central stock invariant is
  `CHECK (quantity_reserved <= quantity_on_hand)` on `inventory`.
- **Identifiers** are `BIGINT GENERATED ALWAYS AS IDENTITY`; natural keys (SKU,
  email, warehouse code) are enforced with unique constraints.
- **Money** is `NUMERIC(12, 2)` in a single currency (EUR).
- **Generated columns:** `inventory.quantity_available` is a `VIRTUAL` column
  (computed on read, cannot drift); `order_items.line_total` is `STORED`
  (written once, read by reports).
- **Delete behaviour:** foreign keys use `ON DELETE RESTRICT` so order and stock
  history cannot disappear as a side effect. Only `orders → order_items`
  cascades, because order lines have no meaning without their order.
- **Order status** is `TEXT` with a `CHECK` constraint rather than an enum type,
  so the allowed values are easy to change later.
- **Indexes only for measured query patterns.** Apart from the indexes behind
  primary keys and unique constraints, each index comes with the query it
  serves and `EXPLAIN ANALYZE` evidence in
  [docs/query-optimization.md](docs/query-optimization.md). So far:
  `orders (customer_id)` for `get_customer_orders()`,
  `order_status_history (order_id, changed_at, history_id)` for an order's history,
  and a BRIN index on `orders (created_at)` for date-range reports.

## Database functions

Each function lives in its own file in [database/functions/](database/functions/).

### `get_customer_orders(customer_id BIGINT)`

A customer's orders, newest first.

```sql
SELECT * FROM get_customer_orders(1);
```

```text
 order_id |  status   | total_amount | item_count |       created_at
----------+-----------+--------------+------------+------------------------
       14 | cancelled |        79.00 |          1 | 2026-08-02 19:17:00+00
        6 | delivered |       174.80 |          2 | 2026-03-11 06:20:00+00
        1 | delivered |       278.80 |          3 | 2026-01-08 08:15:00+00
```

- `item_count` is the number of units across all order lines.
- A customer without orders gets an empty result.
- An unknown customer raises SQLSTATE `P0002` (`no_data_found`), so callers can
  tell "no such customer" apart from "no orders yet". A `NULL` id raises `22023`
  (`invalid_parameter_value`).

Source: [get_customer_orders.sql](database/functions/get_customer_orders.sql)

### `get_product_availability(product_id BIGINT, warehouse_id BIGINT)`

Stock of one product in one warehouse. It always returns exactly one row.

```sql
-- Product 5 = noise-cancelling headphones, warehouse 1 = Helsinki (seed data)
SELECT * FROM get_product_availability(5, 1);
```

```text
 quantity_on_hand | quantity_reserved | quantity_available
------------------+-------------------+--------------------
               40 |                 1 |                 39
```

- A product that isn't stocked in the warehouse returns zeros.
- An unknown product or warehouse raises `P0002` (`no_data_found`) with a
  message naming which one. A `NULL` id raises `22023`.
- It's a read-only snapshot and locks nothing; claiming stock will be
  `reserve_stock()`'s job.
- No extra index: the lookup uses the `inventory` primary key
  ([measured](docs/query-optimization.md#2-stock-of-one-product-in-one-warehouse-get_product_availability)).

Source: [get_product_availability.sql](database/functions/get_product_availability.sql)

### `reserve_stock(product_id BIGINT, warehouse_id BIGINT, quantity INTEGER)`

Reserves stock for an order and returns the quantity still available.

```sql
SELECT reserve_stock(5, 1, 2);   -- 39 available before, returns 37
```

- It increases `quantity_reserved`; stock on hand stays unchanged until the
  goods ship.
- It runs in the caller's transaction, so a rollback undoes the reservation.
- **Concurrency:** the inventory row is locked with `SELECT ... FOR UPDATE`
  before availability is checked. A competing reservation for the same product
  and warehouse waits until the first transaction commits or rolls back, and
  then checks against the committed stock. The same units can never be
  reserved twice.
- **Safety net:** `CHECK (quantity_reserved <= quantity_on_hand)`. With
  `FOR UPDATE` removed, the concurrency tests show the constraint still stops
  over-reservation, but only with a generic `23514` constraint error instead of
  a clear `JD001`.

Try the lock in two terminals:

```sql
-- Terminal 1: ./dev psql
BEGIN;
SELECT reserve_stock(5, 1, 30);   -- returns 9; the row stays locked

-- Terminal 2: ./dev psql
SELECT reserve_stock(5, 1, 20);   -- waits...

-- Terminal 1
COMMIT;                           -- terminal 2 fails: requested 20, available 9
                                  -- (with ROLLBACK instead, terminal 2 succeeds)
```

`./dev seed` resets the data afterwards.

Source: [reserve_stock.sql](database/functions/reserve_stock.sql)

### `create_order(customer_id BIGINT, warehouse_id BIGINT, items JSONB)`

Creates an order with its lines, reserves the stock, and returns the new order
id. Either everything happens or nothing does.

```sql
SELECT create_order(1, 1, '[{"product_id": 5, "quantity": 2},
                            {"product_id": 7, "quantity": 1}]');   -- returns 19
```

1. **Validate first.** `items` must be a non-empty array of objects with an
   integer `product_id` and a positive integer `quantity`, with no product
   listed twice, and the customer must exist. All of this is checked before any
   stock is touched.
2. **Reserve stock in `product_id` order** with `reserve_stock()`, whatever
   order the lines are given in. Two orders with the same products then lock
   inventory rows in the same order and can't deadlock each other.
3. **Insert once.** Prices are read once, and the order (status `pending`, total
   = Σ quantity × price) and its lines (`unit_price` = price at purchase) are
   built from those same values. The total always matches the lines, and the
   order row is never updated afterwards.

**Atomicity:** the call runs as one statement. If any line fails (out of stock,
inactive, unknown product), PostgreSQL undoes everything the call did: no
order, no lines, and no reservations for the lines before it.

**Deadlocks:** with the sort removed, the concurrency tests produce real
`40P01 deadlock detected` errors when orders list the same products in opposite
order. With it, 20 such concurrent orders all complete.

JSONB is only the input format, matching a future API request body. The lines
are stored relationally in `order_items`.

Source: [create_order.sql](database/functions/create_order.sql)

### `get_best_selling_products(start_date DATE, end_date DATE, limit INTEGER)`

Top products by units sold in a date range.

```sql
SELECT * FROM get_best_selling_products('2026-01-01', '2026-06-30', 3);
```

```text
 product_id |    sku    |            name             | units_sold | revenue
------------+-----------+-----------------------------+------------+---------
         11 | OUTD-3003 | Insulated Water Bottle 1 L  |          3 |   89.70
         18 | OFFC-5003 | A5 Dotted Notebook (3-pack) |          3 |   44.70
          3 | ELEC-1003 | USB-C Charger 65 W          |          2 |   79.80
```

- **Sold** means status `paid`, `shipped` or `delivered`. Pending (unpaid) and
  cancelled orders don't count.
- **Revenue** uses the prices at the time of purchase (`order_items.line_total`).
- **Dates** are inclusive and interpreted in the session time zone (UTC by
  default). The filter is `created_at >= start AND created_at < end + 1`: the
  whole last day counts, and the condition can use an index.
- **Order:** units sold, then revenue, then product id, so results are
  deterministic.
- **Errors:** `22023` for `NULL`s, a start date after the end date, or a limit
  below 1.
- **Index:** a 24 kB **BRIN** index on `orders (created_at)` makes one-day
  reports about 7× faster. For a month or more, aggregating order lines
  dominates and no index on `orders` helps
  ([measured](docs/query-optimization.md#3-best-selling-products-in-a-date-range-get_best_selling_products)).

Source: [get_best_selling_products.sql](database/functions/get_best_selling_products.sql)

### Error codes

The functions raise specific SQLSTATEs, so the API can map errors without
parsing messages:

| SQLSTATE | Meaning | Raised by | Planned HTTP status |
| --- | --- | --- | --- |
| `P0002` `no_data_found` | Customer, product or warehouse does not exist | all functions | 404 |
| `22023` `invalid_parameter_value` | `NULL` argument, non-positive quantity, malformed order items | all functions | 400 |
| `JD001` | Insufficient stock (message has requested and available quantities) | `reserve_stock`, `create_order` | 409 |
| `JD002` | Product or warehouse is inactive | `reserve_stock`, `create_order` | 409 |

`JD` is a project-specific SQLSTATE class, chosen so it can't collide with
PostgreSQL's own codes.

## Views

### `product_inventory_summary`

One row per product with its stock summed over all warehouses.

```sql
SELECT sku, name, category, warehouse_count, quantity_on_hand, quantity_reserved, quantity_available
FROM product_inventory_summary
WHERE sku IN ('ELEC-1001', 'OUTD-3001', 'SPRT-6004')
ORDER BY sku;
```

```text
    sku    |            name             |  category   | warehouse_count | quantity_on_hand | quantity_reserved | quantity_available
-----------+-----------------------------+-------------+-----------------+------------------+-------------------+--------------------
 ELEC-1001 | Noise-Cancelling Headphones | Electronics |               1 |               40 |                 1 |                 39
 OUTD-3001 | Down Sleeping Bag -10 °C    | Outdoor     |               3 |               33 |                 0 |                 33
 SPRT-6004 | Cross-Country Ski Wax Kit   | Sports      |               1 |                4 |                 0 |                  4
```

- Every product appears. Products not stocked anywhere show zeros (`LEFT JOIN`),
  and inactive products are included with `is_active = false`.
- It's a plain view, so it always reflects the current stock, including
  reservations made a moment ago.
- **Filters are applied before the aggregation:** a lookup by SKU reads one
  product and its inventory rows through indexes, in about 0.05 ms on the large
  dataset, against 26.5 ms when the filter can't be pushed down
  ([measured](docs/query-optimization.md#4-a-view-with-aggregation-product_inventory_summary)).

Source: [product_inventory_summary.sql](database/views/product_inventory_summary.sql)

## Triggers

### Order status history

[database/triggers/order_status_history.sql](database/triggers/order_status_history.sql)
records every order status change in `order_status_history`:

```sql
UPDATE orders SET status = 'paid'    WHERE order_id = 18;
UPDATE orders SET status = 'paid'    WHERE order_id = 18;   -- same status: nothing recorded
UPDATE orders SET status = 'shipped' WHERE order_id = 18;

SELECT old_status, new_status, changed_at
FROM order_status_history WHERE order_id = 18 ORDER BY changed_at, history_id;
```

```text
 old_status | new_status |       changed_at
------------+------------+------------------------
            | pending    | 2026-09-22 09:14:00+00      ← created
 pending    | paid       | 2026-09-25 14:57:12+00
 paid       | shipped    | 2026-09-25 14:57:12+00
```

- **On insert:** a *statement-level* `AFTER INSERT` trigger with a transition
  table records each new order's initial status (`NULL → status`) at its
  `created_at`. Bulk inserts write their history in one `INSERT ... SELECT`.
  For the large dataset's 100,000 orders this adds about 1 second.
- **On status change:** a *row-level* `AFTER UPDATE OF status` trigger with
  `WHEN (OLD.status IS DISTINCT FROM NEW.status)`. PostgreSQL checks the
  condition before calling the trigger function, so same-status updates and
  updates of other columns record nothing and cost nothing.
- **Safety net:** `CHECK (old_status IS DISTINCT FROM new_status)`. With the
  `WHEN` condition removed, the tests show that same-status updates would fail
  on this constraint.
- History is written in the same transaction as the change, so a rollback
  removes both. Deleting an order deletes its history (`ON DELETE CASCADE`).
- `changed_at` is the transaction time: several changes in one transaction
  share a timestamp, and `history_id` keeps their order.

Stock effects of status changes (releasing reservations on cancellation,
deducting stock on shipping) are deliberately not in a trigger. They belong in
an explicit `update_order_status()` function, planned as a separate issue.

## API

A thin [Fastify](https://fastify.dev) API in [backend/](backend/). Each
endpoint validates the request shape, calls **one** PostgreSQL function with
parameterised SQL, and maps the result to JSON. Business rules (stock checks,
locking, totals, validation of order lines) stay in the database and are not
repeated in TypeScript.

```bash
./dev api    # http://localhost:3000, uses DATABASE_URL and API_PORT from .env
```

| Method & path | Database function | Success |
| --- | --- | --- |
| `GET /api/health` | `SELECT 1` | 200 (503 if the database is unreachable) |
| `GET /api/customers/:id/orders` | `get_customer_orders` | 200 |
| `GET /api/products/:id/availability?warehouseId=` | `get_product_availability` | 200 |
| `POST /api/inventory/reserve` | `reserve_stock` | 200 |
| `POST /api/orders` | `create_order` | 201 |
| `GET /api/reports/best-selling?start=&end=&limit=` | `get_best_selling_products` | 200 |

Examples with the seed data:

```bash
curl -s localhost:3000/api/customers/1/orders
# {"customerId":1,"orders":[{"orderId":14,"status":"cancelled","totalAmount":"79.00","itemCount":1,"createdAt":"2026-08-02T19:17:00.000Z"}, ...]}

curl -s 'localhost:3000/api/products/5/availability?warehouseId=1'
# {"productId":5,"warehouseId":1,"quantityOnHand":40,"quantityReserved":1,"quantityAvailable":39}

curl -s -X POST localhost:3000/api/orders -H 'content-type: application/json' \
  -d '{"customerId":1,"warehouseId":1,"items":[{"productId":5,"quantity":2},{"productId":7,"quantity":1}]}'
# {"orderId":19}                                                    (201 Created)

curl -s -X POST localhost:3000/api/inventory/reserve -H 'content-type: application/json' \
  -d '{"productId":5,"warehouseId":1,"quantity":999}'
# {"error":{"code":"INSUFFICIENT_STOCK","message":"insufficient stock for product 5 in warehouse 1:
#   requested 999, available 37","sqlstate":"JD001"}}                (409 Conflict)

curl -s 'localhost:3000/api/reports/best-selling?start=2026-01-01&end=2026-06-30&limit=3'
```

**Conventions:**

- JSON uses camelCase.
- Money is returned as a decimal **string** (`"477.00"`), because PostgreSQL
  `NUMERIC` values can't be represented exactly as JavaScript numbers.
- IDs and counts are numbers. `BIGINT` values are converted with a check that
  fails loudly rather than losing precision.
- Request bodies and query strings are validated with JSON schemas. Unknown
  fields are rejected, not silently dropped.

**Errors** always have the shape `{ "error": { "code", "message", "sqlstate"? } }`:

| Cause | HTTP | `code` |
| --- | --- | --- |
| Request fails schema validation | 400 | `VALIDATION_ERROR` |
| Malformed JSON body | 400 | `BAD_REQUEST` |
| `22023` and PostgreSQL input errors (`22P02`, `22003`, `22007`, `22008`) | 400 | `INVALID_ARGUMENT` |
| `P0002` | 404 | `NOT_FOUND` |
| `JD001` | 409 | `INSUFFICIENT_STOCK` |
| `JD002` | 409 | `NOT_ACTIVE` |
| Unknown route | 404 | `ROUTE_NOT_FOUND` |
| Anything else | 500 | `INTERNAL_ERROR`, with no internal details (logged on the server) |

Messages from the database functions are passed through, since they were
written for the caller (e.g. "requested 999, available 37").

**Tests** ([backend/tests/](backend/tests/)) run the real app with
`app.inject()` against a separate, freshly migrated `jaladb_api_test` database.
The sample seed data is reloaded before every test. No database mocks. They
cover every endpoint's success path, validation errors, each error mapping, a
failed order leaving no order and no reservations, and that unexpected errors
don't leak details.

## Migrations

`npm run db:migrate` ([database/scripts/migrations.ts](database/scripts/migrations.ts))
applies two kinds of SQL files.

**Versioned migrations** in [database/migrations/](database/migrations/), named
`NNNN_description.sql`: tables, columns, constraints, indexes, and dropping
objects. Each is applied once, in order.

- Applied migrations are recorded in `schema_migrations` with a SHA-256 checksum.
  Editing an applied migration is detected and rejected; add a new one instead.

**Repeatable files** in `database/functions/`, `database/views/` and
`database/triggers/`, one file per object. They are applied after the versioned
migrations, in that directory order, whenever a file is new or its content has
changed.

- They must be idempotent (`CREATE OR REPLACE FUNCTION/VIEW/TRIGGER`), so a
  function is changed by editing its file and reviewed as a normal diff.
- Checksums are recorded in `schema_repeatables`.
- Changes that `CREATE OR REPLACE` cannot make (renaming, changing a function's
  signature or return columns, removing an object) need a versioned migration
  that drops the old object first.

For both kinds:

- Every file runs in its own transaction together with its tracking row, so a
  failing file leaves no partial changes (PostgreSQL supports transactional DDL).
- Files must not contain their own `BEGIN`/`COMMIT`.
- A PostgreSQL advisory lock prevents concurrent migration runs.
- `npm run db:status` lists applied and pending files.

## Seed data

[database/seeds/0001_sample_data.sql](database/seeds/0001_sample_data.sql) loads a
small deterministic dataset: 6 categories, 24 products, 3 warehouses, 12 customers,
42 inventory rows, and 18 orders with 32 order lines between January and
September 2026. All customers are fictional ("Esimerkki" is Finnish for "example").

The dataset covers every order status. Stock is reserved for open (`pending` and
`paid`) orders, and one customer has no orders.

`npm run db:seed` truncates all tables first, so it can be re-run at any time.

### Large dataset (optional)

`./dev seed-large` (`npm run db:seed:large`) loads the sample data and then
[generate_large_dataset.sql](database/seeds/large/generate_large_dataset.sql)
in the same transaction. It takes about 10 seconds:

| Table         | Rows    |
| ------------- | ------: |
| `products`    | 10,024  |
| `customers`   | 10,012  |
| `orders`      | 100,018 |
| `order_items` | 249,952 |

- **Plain SQL.** It uses `generate_series`, and `setseed()` makes it reproducible:
  every run produces the same data.
- **Realistic shape.** Orders run from 2024 to September 2026, some customers
  order far more often than others, and recent orders are still open.
- **Consistent.** The same invariants as the small seed hold: totals match
  lines, and reservations match open orders.
- **Scalable.** The size is set by `jaladb.seed_scale` (default 1). The tests
  use `SET LOCAL jaladb.seed_scale = '0.02'`.

Normal development and the default tests only use the small dataset.

## Tests

`npm test` runs integration tests against real PostgreSQL. No database mocks.

- A global setup creates a fresh `jaladb_test` database, applies all migrations
  (which also checks that migrations work on an empty database), and drops it
  after the run.
- Each test runs inside a transaction that is rolled back, so tests are isolated.
  The exception is the concurrency tests: other connections can only see
  committed rows, so they commit their own fixtures and delete them afterwards.
- Constraint tests check the exact SQLSTATE code and constraint name PostgreSQL
  reports.

| File | Covers |
| --- | --- |
| [migrations.test.ts](database/tests/migrations.test.ts) | Checksums recorded, re-running is a no-op, edited migrations rejected, repeatable files re-applied only when changed and applied in order, failing files fully rolled back |
| [constraints.test.ts](database/tests/constraints.test.ts) | Uniqueness, formats, non-negative stock and prices, reservation limits, foreign keys and delete behaviour, generated columns |
| [seed.test.ts](database/tests/seed.test.ts) | Row counts, re-runnability, order totals match lines, reservations match open orders |
| [large-dataset.test.ts](database/tests/large-dataset.test.ts) | Scaled-down generated dataset: row counts, 1–4 lines per order, totals and reservations consistent; the planner uses `orders_customer_id_idx` instead of a sequential scan, `inventory_pkey` for availability lookups, the history index, the BRIN index definition and usability, and filter pushdown into `product_inventory_summary` |
| [functions/get_customer_orders.test.ts](database/tests/functions/get_customer_orders.test.ts) | Only the requested customer's orders, returned fields and values, newest-first ordering, empty result, errors for unknown and `NULL` customers |
| [functions/get_product_availability.test.ts](database/tests/functions/get_product_availability.test.ts) | Quantities, only the requested warehouse, zeros when not stocked, fully reserved stock, errors for unknown product/warehouse and `NULL`s |
| [functions/reserve_stock.test.ts](database/tests/functions/reserve_stock.test.ts) | Reservation and return value, accumulation, reserving all stock, `JD001` with unchanged inventory, not stocked, inactive product/warehouse, invalid arguments |
| [functions/create_order.test.ts](database/tests/functions/create_order.test.ts) | Order, lines, price snapshot, total = sum of lines, reservations, listed by `get_customer_orders`; failure on the last line or an inactive product leaves nothing behind; unknown references; 14 kinds of invalid input |
| [functions/create_order.concurrency.test.ts](database/tests/functions/create_order.concurrency.test.ts) | Lines are locked in `product_id` order regardless of input order (checked with a third connection and `lock_timeout`); 20 concurrent orders with reversed product order complete without deadlocks; 8 orders competing for 3 units: exactly 3 complete, the rest leave no partial reservations |
| [functions/get_best_selling_products.test.ts](database/tests/functions/get_best_selling_products.test.ts) | Totals across orders, purchase-time prices, status filter, date boundaries (first/last day in, day before/after out), single-day range, ordering and tie-breaks, limit, empty result, invalid arguments |
| [views/product_inventory_summary.test.ts](database/tests/views/product_inventory_summary.test.ts) | Sums over warehouses, product data and category name, zeros for unstocked products, inactive products included, one row per product, reservations visible immediately |
| [triggers/order_status_history.test.ts](database/tests/triggers/order_status_history.test.ts) | Creation row (single insert, multi-row insert, `create_order`); old/new status recorded; sequence in order; multi-row update records only real changes; rollback; no row for same-status or other-column updates; cascade delete; table constraints |
| [functions/reserve_stock.concurrency.test.ts](database/tests/functions/reserve_stock.concurrency.test.ts) | Real parallel connections: a competing reservation waits for the row lock, then fails after `COMMIT` or succeeds after `ROLLBACK`; 12 clients racing for 5 units → exactly 5 succeed; rollback of the surrounding transaction undoes the reservation |

The tests need the PostgreSQL container to be running (`docker compose up -d`).

### Continuous integration

[GitHub Actions](.github/workflows/ci.yml) runs on every pull request and on
pushes to `main`:

- **Database tests** against a PostgreSQL 18 service container: type check,
  migrations on an empty database (and a second run to confirm it is a no-op),
  seed data, and the integration tests
- **API tests**: type check and the API integration tests against their own
  PostgreSQL 18 service container
- **Tooling checks**: shellcheck for the `dev` script and validation of
  `docker-compose.yml`

[Dependabot](.github/dependabot.yml) checks npm packages (root and `backend/`),
GitHub Actions and Docker images weekly, and opens PRs that go through the same CI and review.
Minor and patch updates are grouped; major updates arrive separately.
PostgreSQL major versions are excluded, because they need a planned data
upgrade. Dependabot alerts and security updates are enabled in the repository
settings.

## Project structure

```text
jaladb/
├── database/
│   ├── migrations/   # versioned schema changes (SQL)
│   ├── functions/    # PL/pgSQL functions, one per file (repeatable)
│   ├── views/        # views, one per file (repeatable)
│   ├── triggers/     # triggers and their functions (repeatable)
│   ├── seeds/        # sample data (SQL); large/ holds the generator
│   ├── scripts/      # migration and seed runner (TypeScript)
│   └── tests/        # PostgreSQL integration tests (Vitest)
├── backend/
│   ├── src/          # Fastify app, routes, error mapping
│   └── tests/        # API integration tests (Vitest)
├── docs/               # query optimisation write-ups and EXPLAIN scripts
├── .github/workflows/  # CI
├── dev                 # development helper script
├── docker-compose.yml
├── .env.example
└── package.json
```
