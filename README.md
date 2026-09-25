# JalaDB

A PostgreSQL-focused portfolio project demonstrating practical database engineering
through a small commerce and inventory domain: relational design, integrity
constraints, PL/pgSQL, transactions, triggers, indexing, and testing against a
real database.

It is a database demonstration, not a webshop.

## Status

**Phase 1 – PostgreSQL foundation** (current):

- Docker Compose setup with PostgreSQL 18 and pgAdmin
- Versioned SQL migrations with a small migration runner
- Core schema with database-level integrity constraints
- Deterministic seed data
- Integration tests against real PostgreSQL

Planned next: PL/pgSQL business functions (`get_customer_orders`,
`get_product_availability`, `reserve_stock`, `create_order`,
`get_best_selling_products`), an order status history trigger, views,
indexes with `EXPLAIN ANALYZE` examples, and a thin Node.js API.

## Technology

- PostgreSQL 18
- Node.js 22+ and TypeScript (migration/seed tooling and tests)
- `pg` driver: plain SQL, no ORM
- Vitest
- Docker Compose, pgAdmin 4

## Getting started

Prerequisites: Docker with Compose, Node.js 22 or newer.

```bash
cp .env.example .env        # local configuration
docker compose up -d        # start PostgreSQL and pgAdmin
npm install
npm run db:migrate          # create the schema
npm run db:seed             # load sample data
npm test                    # run the integration tests
```

### Commands

| Command              | Description                                                            |
| -------------------- | ---------------------------------------------------------------------- |
| `docker compose up -d` | Start PostgreSQL (`localhost:5432`) and pgAdmin (`localhost:5050`)   |
| `docker compose down`  | Stop the containers (add `-v` to delete all data)                    |
| `npm run db:migrate` | Apply pending migrations                                               |
| `npm run db:status`  | List applied and pending migrations                                    |
| `npm run db:seed`    | Replace all data with the sample dataset                               |
| `npm test`           | Run the database integration tests                                     |
| `npm run typecheck`  | Type-check the TypeScript tooling and tests                            |

### Browsing the database

pgAdmin runs at <http://localhost:5050> without a login, with the **JalaDB**
server already registered. For the command line:

```bash
docker compose exec postgres psql -U jaladb -d jaladb
```

## Schema

```text
categories 1 ──< products  1 ──< inventory   >── 1 warehouses
customers  1 ──< orders    1 ──< order_items >── 1 products
orders       >── 1 warehouses   (fulfilling warehouse)
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
- **No performance indexes yet.** Only the indexes behind primary keys and unique
  constraints exist. Indexes for query patterns will be added with the queries
  that need them, together with `EXPLAIN ANALYZE` before/after comparisons.

## Migrations

Migrations are plain SQL files in [database/migrations/](database/migrations/),
named `NNNN_description.sql` and applied in order by
[database/scripts/migrations.ts](database/scripts/migrations.ts):

- each migration runs in its own transaction, so a failing migration leaves no
  partial schema changes (PostgreSQL supports transactional DDL)
- applied migrations are recorded in `schema_migrations` with a SHA-256 checksum;
  editing an already-applied migration is detected and rejected
- a PostgreSQL advisory lock prevents concurrent migration runs

To change the schema, add a new migration file. Do not edit applied ones.
Migration files must not contain their own `BEGIN`/`COMMIT`.

## Seed data

[database/seeds/0001_sample_data.sql](database/seeds/0001_sample_data.sql) loads a
small deterministic dataset: 6 categories, 24 products, 3 warehouses, 12 customers,
42 inventory rows, and 18 orders with 32 order lines between January and
September 2026. All customers are fictional ("Esimerkki" is Finnish for "example").

The dataset covers every order status. Stock is reserved for open (`pending` and
`paid`) orders, and one customer has no orders.

`npm run db:seed` truncates all tables first, so it can be re-run at any time.

## Tests

`npm test` runs integration tests against real PostgreSQL. No database mocks.

- A global setup creates a fresh `jaladb_test` database, applies all migrations
  (which also checks that migrations work on an empty database), and drops it
  after the run.
- Each test runs inside a transaction that is rolled back, so tests are isolated.
- Constraint tests check the exact SQLSTATE code and constraint name PostgreSQL
  reports.

| File | Covers |
| --- | --- |
| [migrations.test.ts](database/tests/migrations.test.ts) | Checksums recorded, re-running is a no-op, edited migrations rejected, failing migrations fully rolled back |
| [constraints.test.ts](database/tests/constraints.test.ts) | Uniqueness, formats, non-negative stock and prices, reservation limits, foreign keys and delete behaviour, generated columns |
| [seed.test.ts](database/tests/seed.test.ts) | Row counts, re-runnability, order totals match lines, reservations match open orders |

The tests need the PostgreSQL container to be running (`docker compose up -d`).

## Project structure

```text
jaladb/
├── database/
│   ├── migrations/   # versioned schema changes (SQL)
│   ├── seeds/        # sample data (SQL)
│   ├── scripts/      # migration and seed runner (TypeScript)
│   └── tests/        # PostgreSQL integration tests (Vitest)
├── docker-compose.yml
├── .env.example
└── package.json
```
