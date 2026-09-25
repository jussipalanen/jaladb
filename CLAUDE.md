# JalaDB

JalaDB is a PostgreSQL-focused portfolio project designed to demonstrate practical database engineering skills through a small e-commerce and inventory domain.

The project should remain database-first. The main goal is to demonstrate PostgreSQL design, PL/pgSQL functions, transactions, triggers, indexing, query optimization, testing, and backend integration.

This is not intended to become a complete e-commerce platform.

## Main Goals

The project should demonstrate:

* relational database design
* PostgreSQL and PL/pgSQL
* primary keys and foreign keys
* constraints and data integrity
* reusable database functions
* transactions
* triggers
* views
* indexes
* query optimization
* `EXPLAIN ANALYZE`
* realistic test and seed data
* backend integration
* automated database and API tests
* Docker-based local development

PostgreSQL must remain the main technical focus of the repository.

## Technology Stack

Use:

* PostgreSQL
* Node.js
* TypeScript
* Express or Fastify
* `pg` PostgreSQL driver
* Docker Compose
* Vitest for testing
* React with TypeScript for the optional lightweight demo UI

Avoid unnecessary frameworks and abstractions.

Do not use an ORM for the main PostgreSQL operations.

SQL and PL/pgSQL should remain visible and understandable in the repository.

## Architecture

The preferred architecture is:

```text
React Demo Console
        |
        v
Node.js / TypeScript API
        |
        v
PostgreSQL
        |
        +-- Tables
        +-- PL/pgSQL Functions
        +-- Views
        +-- Triggers
        +-- Indexes
```

Keep the backend thin.

Business operations that are intentionally implemented as PostgreSQL functions should not be duplicated in the Node.js service layer.

## Domain

Use a simplified commerce and inventory domain.

Initial entities:

* customers
* products
* categories
* warehouses
* inventory
* orders
* order_items

Optional entities:

* stock_movements
* order_status_history
* integration_events

Do not add additional entities unless they support a clear database demonstration.

## Database Design

Use appropriate PostgreSQL data types.

Prefer:

* `BIGINT` or identity columns for identifiers
* `NUMERIC` for monetary values
* `TIMESTAMPTZ` for timestamps when appropriate
* `BOOLEAN` for flags
* PostgreSQL enums only when they provide a clear benefit
* `JSONB` only when semistructured data is genuinely useful

Use database-level integrity constraints.

Examples:

* `NOT NULL`
* `UNIQUE`
* `CHECK`
* foreign keys
* appropriate delete/update behavior

Do not rely only on application-level validation when PostgreSQL can guarantee data integrity.

## Initial Database Functions

Implement the first version around a small set of meaningful PostgreSQL functions.

### 1. get_customer_orders

Purpose:

Return orders belonging to a customer.

Example:

```sql
SELECT * FROM get_customer_orders(42);
```

The function should return useful order information such as:

* order ID
* status
* total
* creation date

### 2. get_product_availability

Purpose:

Return inventory information for a product in a warehouse.

Example:

```sql
SELECT * FROM get_product_availability(100, 1);
```

Return values may include:

* current quantity
* reserved quantity
* available quantity

### 3. reserve_stock

Purpose:

Reserve product inventory safely.

Example:

```sql
SELECT reserve_stock(100, 1, 2);
```

Requirements:

* validate available inventory
* prevent negative stock
* fail clearly when inventory is insufficient
* operate safely inside a transaction

### 4. create_order

Purpose:

Create an order and its order lines.

The operation should demonstrate transaction handling.

The operation must not leave partial order data if any step fails.

Possible responsibilities:

* create order
* create order items
* validate stock
* reserve or reduce inventory
* calculate totals
* record inventory movement

Keep the implementation understandable.

### 5. get_best_selling_products

Purpose:

Provide a simple reporting function.

Parameters:

* start date
* end date
* result limit

The function should return:

* product
* units sold
* revenue

Use this function to demonstrate aggregation and query optimization.

## Triggers

Include at least one meaningful trigger.

Preferred example:

Record order status changes in `order_status_history`.

The trigger should execute only when the relevant status value actually changes.

Avoid creating triggers purely for demonstration if application logic would be clearer.

## Views

Create at least one useful view.

Possible examples:

* product inventory summary
* order summary
* customer order summary

Views should reduce repeated query complexity.

## Indexes and Query Optimization

Indexing is an important part of this project.

Create indexes only when there is a clear query pattern that benefits from them.

Examples:

* customer orders
* product inventory lookups
* order date reporting
* order item product lookups

Document at least one optimization example using:

```sql
EXPLAIN ANALYZE
```

Show the query before and after an appropriate index where practical.

Do not add indexes blindly.

## Seed Data

Provide realistic seed data.

The project should work with a small local dataset by default.

Optionally provide a separate larger dataset generator for performance testing.

Possible larger dataset:

* 10,000–100,000 products
* thousands of customers
* tens of thousands of orders
* hundreds of thousands of order items

Do not make large seed generation mandatory for normal development.

## Backend API

The Node.js backend should mainly expose PostgreSQL operations.

Suggested endpoints:

```text
GET /api/customers/:id/orders
GET /api/products/:id/availability
POST /api/orders
POST /api/inventory/reserve
GET /api/reports/best-selling
```

Use parameterized SQL queries.

Never build SQL statements by concatenating untrusted input.

Example:

```ts
const result = await pool.query(
  'SELECT * FROM get_customer_orders($1)',
  [customerId]
);
```

Keep controllers and services small.

Do not reimplement PostgreSQL function logic in TypeScript.

## Frontend

The frontend is optional and should remain lightweight.

It is a database demonstration console, not a consumer-facing webshop.

The UI should allow a user to:

1. Select a predefined database operation.
2. Enter required parameters.
3. Execute the operation.
4. View the result.

Suggested operations:

* Get customer orders
* Product availability
* Reserve stock
* Best-selling products
* Sales summary

Display useful metadata where practical:

* operation name
* parameters
* execution time
* number of rows returned
* result data

Render tabular result sets as tables.

Do not implement:

* checkout
* authentication
* customer accounts
* payment systems
* shopping carts
* complex product browsing
* admin dashboards

unless explicitly requested later.

## Testing

Testing is required.

Tests should prioritize actual PostgreSQL behavior.

Include tests for:

* constraints
* database functions
* transactions
* trigger behavior
* failure conditions
* API integration

Examples:

### reserve_stock

Test that:

* stock is reduced or reserved correctly
* insufficient inventory fails
* stock never becomes negative
* failed operations are rolled back

### create_order

Test that:

* an order is created
* order items are created
* totals are correct
* inventory changes are correct
* the whole operation rolls back on failure

### get_customer_orders

Test that:

* only the requested customer's orders are returned
* results contain expected fields

Prefer integration tests against a real PostgreSQL instance.

Docker or Testcontainers may be used for test databases.

Do not replace meaningful PostgreSQL integration tests with mocks.

## Docker

The project should be easy to start locally.

Preferred command:

```bash
docker compose up -d
```

The developer experience should be simple.

Provide clear commands for:

* starting PostgreSQL
* applying migrations
* loading seed data
* running the backend
* running tests

## Repository Structure

Preferred structure:

```text
jaladb/
├── database/
│   ├── migrations/
│   ├── functions/
│   ├── triggers/
│   ├── views/
│   ├── indexes/
│   └── seeds/
│
├── backend/
│   ├── src/
│   └── tests/
│
├── frontend/
│   └── src/
│
├── docker-compose.yml
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

The exact structure may evolve if there is a clear technical reason.

## Development Principles

Work incrementally.

Do not implement the entire planned project in one change.

For each feature:

1. Understand the database requirement.
2. Design the schema or function.
3. Implement the database change.
4. Add tests.
5. Add backend integration if necessary.
6. Add frontend support only when useful.
7. Run tests.
8. Update documentation.

Prefer small, understandable changes.

## Scope Control

This is important.

Do not turn JalaDB into a full webshop.

Do not add technologies simply to make the stack larger.

Do not add:

* microservices
* message brokers
* Kubernetes
* GraphQL
* authentication systems
* payment gateways
* large frontend frameworks beyond what is already selected
* unnecessary cloud infrastructure

unless explicitly requested.

The quality of the PostgreSQL implementation is more important than the number of technologies used.

## Optional AI Feature

AI is optional and must not block completion of the core database project.

Only implement AI after the main PostgreSQL functionality and tests are working.

Preferred optional feature:

### Semantic Product Search

Use:

* PostgreSQL
* `pgvector`
* product embeddings
* Node.js backend integration

Possible flow:

```text
Search query
    |
    v
Embedding model
    |
    v
PostgreSQL + pgvector
    |
    v
Semantic product results
```

Keep the AI integration small.

Do not build:

* a chatbot
* an autonomous agent
* unrestricted text-to-SQL
* a large RAG system

The AI feature should demonstrate an additional PostgreSQL capability rather than becoming the main project.

## Security

Always use parameterized SQL.

Validate external input.

Do not expose database credentials.

Use `.env` for local configuration.

Provide `.env.example`.

Never commit secrets.

Do not allow arbitrary SQL execution through the frontend or API.

## README

The README should explain:

* project purpose
* architecture
* technology stack
* PostgreSQL concepts demonstrated
* how to start the project
* how to run migrations
* how to load seed data
* how to run tests
* available database functions
* API endpoints
* optional AI functionality

Keep documentation practical and concise.

## Completion Criteria

The first meaningful version is complete when:

* Docker starts PostgreSQL successfully
* the core schema exists
* seed data can be loaded
* core PostgreSQL functions work
* at least one trigger exists
* indexes are demonstrated
* database integration tests pass
* the Node.js API can call the PostgreSQL functions
* README contains reproducible setup instructions

The frontend and AI features are optional enhancements after this point.
