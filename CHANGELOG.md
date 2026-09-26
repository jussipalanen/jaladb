# Changelog

All notable changes to JalaDB are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0.0, minor versions may include breaking changes.

## [Unreleased]

### Added

- This changelog. Package versions now match the released version (`0.1.0`).
- `update_order_status(order_id, new_status)`: order lifecycle with allowed
  transitions only. Cancelling releases reserved stock, shipping deducts it
  from stock on hand. Invalid transitions raise the new SQLSTATE `JD003`.
  Order and inventory row locking keep concurrent changes consistent and
  deadlock-free ([#28])
- Demo console in `frontend/` (React 19, Vite, Tailwind CSS 4, dark-blue
  theme): run the five database operations through the API and see status,
  timing, row count and results as tables or values. Errors show the API code,
  SQLSTATE and message. It never sends SQL. `./dev ui` and `./dev test-ui`, a
  CI job, and a Dependabot entry for `frontend/` ([#30])
- The API and demo console run in Docker Compose (profile `app`): a one-shot
  `migrate` container, the `api`, and the `console` served by nginx with an
  `/api` proxy. Start them with `./dev up-all`. Includes health checks, a CI job
  that builds and smoke-tests the stack, and Dependabot for the Dockerfile base
  images. The API has a new `API_HOST` setting ([#32])
- Repository governance for public visibility: `CODEOWNERS`, `SECURITY.md` and
  `CONTRIBUTING.md` ([#40])
- MIT license ([#39])

### Changed

- README sections are collapsible accordions; Status and Getting started are
  open by default ([#34])
- `pg` is a runtime dependency of the database tooling (it was listed as a dev
  dependency), so the migrate image installs runtime packages only ([#32])

## [0.1.0] - 2026-09-25

The first complete version: PostgreSQL schema, business functions, trigger,
measured indexes, integration tests and a thin Node.js API.

### Added

#### Database

- Core schema: `customers`, `categories`, `products`, `warehouses`, `inventory`,
  `orders`, `order_items`, with named `CHECK`, `UNIQUE`, `NOT NULL` and foreign
  key constraints, `NUMERIC` money, BIGINT identity keys, and generated columns
  `inventory.quantity_available` (`VIRTUAL`) and `order_items.line_total`
  (`STORED`) ([#2])
- `get_customer_orders(customer_id)`: a customer's orders, newest first
  ([#6])
- `get_product_availability(product_id, warehouse_id)`: stock on hand,
  reserved and available ([#10])
- `reserve_stock(product_id, warehouse_id, quantity)`: stock reservation under
  a `SELECT ... FOR UPDATE` row lock, with project-specific SQLSTATEs `JD001`
  (insufficient stock) and `JD002` (inactive product or warehouse) ([#12])
- `create_order(customer_id, warehouse_id, items)`: atomic order creation that
  reserves stock in `product_id` order to prevent deadlocks ([#14])
- `order_status_history` table with a statement-level insert trigger
  (transition table) and a row-level status-change trigger that fires only on
  real changes ([#16])
- `get_best_selling_products(start_date, end_date, limit)`: top products by
  units sold in an inclusive date range ([#18])
- `product_inventory_summary` view: stock per product summed over all
  warehouses ([#20])

#### Performance

- B-tree index on `orders (customer_id)` for customer order lookups, chosen
  over a composite index after measuring both ([#8])
- Index on `order_status_history (order_id, changed_at, history_id)` ([#16])
- BRIN index on `orders (created_at)` with `pages_per_range = 32` for
  date-range reports; 24 kB against 2,208 kB for a B-tree ([#18])
- `docs/query-optimization.md` with `EXPLAIN ANALYZE` before/after comparisons
  and reproducible scripts for every index decision ([#8], [#10], [#18], [#20])

#### Tooling

- Docker Compose setup with PostgreSQL 18 and Adminer ([#2])
- Migration runner: versioned migrations with checksums and an advisory lock;
  repeatable files for functions, views and triggers ([#2], [#6])
- Deterministic sample seed data ([#2]) and an optional generator for
  100,000 orders and 250,000 order lines ([#8])
- `dev` helper script for Docker, database, test and API tasks ([#2], [#24])
- Integration tests against real PostgreSQL, including concurrency tests
  with parallel connections: 167 database tests and 45 API tests
- GitHub Actions CI for database tests, API tests and tooling checks ([#4],
  [#24])
- Dependabot for npm, GitHub Actions and Docker images; alerts and security
  updates enabled ([#23], [#24])

#### API

- Fastify API in `backend/` with `GET /api/health`,
  `GET /api/customers/:id/orders`, `GET /api/products/:id/availability`,
  `POST /api/inventory/reserve`, `POST /api/orders` and
  `GET /api/reports/best-selling`. It uses parameterised SQL only, JSON-schema
  validation, and maps SQLSTATEs to HTTP statuses ([#24])

[Unreleased]: https://github.com/jussipalanen/jaladb/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jussipalanen/jaladb/releases/tag/v0.1.0

[#28]: https://github.com/jussipalanen/jaladb/pull/28
[#30]: https://github.com/jussipalanen/jaladb/pull/30
[#32]: https://github.com/jussipalanen/jaladb/pull/32
[#34]: https://github.com/jussipalanen/jaladb/pull/34
[#39]: https://github.com/jussipalanen/jaladb/issues/39
[#40]: https://github.com/jussipalanen/jaladb/pull/40
[#2]: https://github.com/jussipalanen/jaladb/pull/2
[#4]: https://github.com/jussipalanen/jaladb/pull/4
[#6]: https://github.com/jussipalanen/jaladb/pull/6
[#8]: https://github.com/jussipalanen/jaladb/pull/8
[#10]: https://github.com/jussipalanen/jaladb/pull/10
[#12]: https://github.com/jussipalanen/jaladb/pull/12
[#14]: https://github.com/jussipalanen/jaladb/pull/14
[#16]: https://github.com/jussipalanen/jaladb/pull/16
[#18]: https://github.com/jussipalanen/jaladb/pull/18
[#20]: https://github.com/jussipalanen/jaladb/pull/20
[#23]: https://github.com/jussipalanen/jaladb/pull/23
[#24]: https://github.com/jussipalanen/jaladb/pull/24
