# Query optimization

Measured examples of indexing decisions, with `EXPLAIN ANALYZE` output
before and after.

All measurements use the generated large dataset (`./dev seed-large`) on
PostgreSQL 18 in the local Docker container with a warm cache. The generator is
deterministic, so the plans can be reproduced. Absolute timings depend on the
machine.

| Table         | Rows    |
| ------------- | ------: |
| `customers`   | 10,012  |
| `products`    | 10,024  |
| `orders`      | 100,018 |
| `order_items` | 249,952 |

---

## 1. Orders of one customer: `get_customer_orders()`

Migration: [0002_index_orders_by_customer.sql](../database/migrations/0002_index_orders_by_customer.sql)
· Script: [sql/explain_customer_orders.sql](sql/explain_customer_orders.sql)

### The query

The body of [get_customer_orders()](../database/functions/get_customer_orders.sql):

```sql
SELECT o.order_id, o.status, o.total_amount,
       COALESCE(items.unit_count, 0)::INTEGER AS item_count, o.created_at
FROM orders o
LEFT JOIN LATERAL (
    SELECT sum(oi.quantity) AS unit_count
    FROM order_items oi
    WHERE oi.order_id = o.order_id
) AS items ON true
WHERE o.customer_id = $1
ORDER BY o.created_at DESC, o.order_id DESC;
```

The query is explained directly, not the function call.
`EXPLAIN SELECT * FROM get_customer_orders(5012)` shows only a `Function Scan`,
because PL/pgSQL runs its statements internally.

The per-order item count already uses the unique index on
`order_items (order_id, product_id)`, since `order_id` is its leading column.
The problem is finding the customer's orders.

### Before: sequential scan

Customer 5012 has 11 orders, which is typical (the median is 9, the maximum 216).

```text
Sort (actual time=4.779..4.780 rows=11.00 loops=1)
  Sort Key: o.created_at DESC, o.order_id DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1080
  ->  Nested Loop Left Join (actual time=0.454..4.724 rows=11.00 loops=1)
        ->  Seq Scan on orders o (actual time=0.425..4.585 rows=11.00 loops=1)
              Filter: (customer_id = '5012'::bigint)
              Rows Removed by Filter: 100007
              Buffers: shared hit=1030
        ->  Aggregate (actual time=0.011..0.011 rows=1.00 loops=11)
              ->  Index Scan using order_items_order_product_key on order_items oi
                    Index Cond: (order_id = o.order_id)
Execution Time: 4.817 ms
```

PostgreSQL reads all 1,030 pages of `orders` and throws away 100,007 rows to
find 11. The cost grows with the size of the whole table, not with the size of
the result.

### The index

```sql
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
```

### After: bitmap index scan

```text
Sort (actual time=0.075..0.076 rows=11.00 loops=1)
  Sort Key: o.created_at DESC, o.order_id DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=57
  ->  Nested Loop Left Join (actual time=0.027..0.067 rows=11.00 loops=1)
        ->  Bitmap Heap Scan on orders o (actual time=0.016..0.022 rows=11.00 loops=1)
              Recheck Cond: (customer_id = '5012'::bigint)
              Heap Blocks: exact=11
              Buffers: shared hit=13
              ->  Bitmap Index Scan on orders_customer_id_idx (actual time=0.009..0.009 rows=11.00 loops=1)
                    Index Cond: (customer_id = '5012'::bigint)
                    Buffers: shared hit=2
        ->  Aggregate (actual time=0.004..0.004 rows=1.00 loops=11)
              ->  Index Scan using order_items_order_product_key on order_items oi
                    Index Cond: (order_id = o.order_id)
Execution Time: 0.100 ms
```

PostgreSQL now reads 2 index pages and the 11 heap pages holding the
customer's orders, instead of the whole table.

### Result

Median of 7 runs:

| Customer              | Without index | With index | Pages read from `orders` |
| --------------------- | ------------: | ---------: | -----------------------: |
| 5012 (11 orders)      | 3.86 ms       | 0.08 ms    | 1,030 → 13               |
| 13 (216 orders, most) | 4.89 ms       | 0.81 ms    | 1,030 → 204              |

For the heaviest customer, most of the remaining time goes to the 216
per-order item lookups, not to finding the orders.

### Why not `(customer_id, created_at DESC, order_id DESC)`?

A composite index whose columns match both the filter and the `ORDER BY` is
the textbook choice, because it lets PostgreSQL return rows already sorted.
It was measured too:

| Index                                            | Size     | Plan for this query         | 11 orders | 216 orders |
| ------------------------------------------------ | -------: | --------------------------- | --------: | ---------: |
| `(customer_id)`                                  | 1,192 kB | Bitmap scan + in-memory sort | 0.08 ms   | 0.81 ms    |
| `(customer_id, created_at DESC, order_id DESC)`  | 3,984 kB | Bitmap scan + in-memory sort | 0.08 ms   | 0.68 ms    |

With either index the planner chooses a bitmap scan followed by a sort.
Sorting at most a few hundred rows in memory is cheaper than an ordered index
scan that visits heap pages in index order, so the extra columns go unused.

The single-column index is **3.3× smaller** because of B-tree deduplication
(PostgreSQL 13+): each `customer_id` is stored once with a list of row
pointers. In the composite index every entry is unique, so nothing can be
deduplicated. A smaller index means less memory, cache and write overhead on
every `INSERT` into `orders`.

The composite index becomes worthwhile when the query can stop early, for
example with pagination (`ORDER BY created_at DESC LIMIT 20`). The ordered
index scan can then read the first 20 entries and skip the sort. If
`get_customer_orders()` gains pagination, this decision should be revisited.

### Also worth knowing

- **Foreign keys are not indexed automatically.** `orders.customer_id`
  references `customers`, but PostgreSQL only indexes the referenced side (the
  primary key). Without this index, deleting a customer would also need a
  sequential scan of `orders` to check for references.
- **Production:** on a busy table, build the index with
  `CREATE INDEX CONCURRENTLY` so writes are not blocked. That statement cannot
  run inside a transaction, and every JalaDB migration runs in one.
- **Test coverage:** [large-dataset.test.ts](../database/tests/large-dataset.test.ts)
  generates a small version of the dataset, runs `ANALYZE`, and checks that the
  planner uses `orders_customer_id_idx` rather than a sequential scan. Removing
  the index makes the test fail.
- **Row versions:** an earlier version of the data generator inserted orders
  and then `UPDATE`d their totals. PostgreSQL's MVCC writes a new row version
  on every update, so the table doubled to 1,966 pages of which half were dead,
  and every "before" measurement was inflated. The generator now computes
  totals first and inserts each order once. `MERGE ... RETURNING` (PostgreSQL
  17+) maps the generated rows to their new ids.

---

## 2. Stock of one product in one warehouse: `get_product_availability()`

Script: [sql/explain_product_availability.sql](sql/explain_product_availability.sql)

This is an example of **not** adding an index. The function looks up one
`inventory` row by `(product_id, warehouse_id)`, which is exactly the primary
key of `inventory`, and checks that the product and warehouse exist through
their own primary keys.

```text
Index Scan using inventory_pkey on inventory i (actual time=0.051..0.052 rows=1.00 loops=1)
  Index Cond: ((product_id = 5024) AND (warehouse_id = 1))
  Index Searches: 1
  Buffers: shared hit=6
Execution Time: 0.064 ms
```

```text
Result (actual time=0.017..0.017 rows=1.00 loops=1)
  InitPlan 1
    ->  Index Only Scan using products_pkey on products p (actual time=0.016..0.016 rows=1.00 loops=1)
          Index Cond: (product_id = 5024)
          Buffers: shared hit=3
Execution Time: 0.027 ms
```

Each part is a single index lookup on a table of 30,042 inventory rows. An
additional index would only add write overhead.

### First call vs. later calls

`EXPLAIN ANALYZE` on the function call itself shows only a `Function Scan`,
but its timing shows something else. Repeated calls in **one** session:

| Call | 1st | 2nd | 3rd | 4th | 5th |
| ---- | --: | --: | --: | --: | --: |
| ms   | 1.36 | 0.14 | 0.25 | 0.15 | 0.12 |

The first call in a session compiles the PL/pgSQL function and prepares its
queries. PL/pgSQL caches both for the rest of the session, so later calls cost
only the lookups. The future API keeps connections open in a pool and gets the
fast case. A new connection per request would pay the first-call cost every
time.

The planner test in [large-dataset.test.ts](../database/tests/large-dataset.test.ts)
checks that the lookup uses `inventory_pkey`.

---

## 3. Best-selling products in a date range: `get_best_selling_products()`

Migration: [0004_brin_index_orders_created_at.sql](../database/migrations/0004_brin_index_orders_created_at.sql)
· Script: [sql/explain_best_selling_products.sql](sql/explain_best_selling_products.sql)

### The query

```sql
SELECT oi.product_id, sum(oi.quantity), sum(oi.line_total)
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status IN ('paid', 'shipped', 'delivered')
  AND o.created_at >= $start AND o.created_at < $end + 1
GROUP BY oi.product_id
ORDER BY 2 DESC, 3 DESC, 1
LIMIT $limit;
```

The date filter is written as a half-open range on the bare column. A form
like `created_at::date BETWEEN ...` would wrap the column in a function, and no
plain index on `created_at` could serve it.

### Measurements

Median of 5–7 runs per cell; individual runs vary by a few milliseconds.
Candidates: no index, a B-tree, and BRIN indexes with different block sizes
(`pages_per_range`):

| Range     | No index | B-tree       | BRIN, 128 pages | **BRIN, 32 pages** | BRIN, 16 pages |
| --------- | -------: | -----------: | --------------: | -----------------: | -------------: |
| 1 day     |   7.3 ms | **0.4 ms**   |          3.2 ms |         **1.0 ms** |         0.7 ms |
| 1 week    |   8.1 ms | 18.7 ms ⚠    |          5.9 ms |         **4.7 ms** |        18.6 ms ⚠ |
| 1 month   |  25.5 ms | 30.6 ms      |         32.2 ms |            30.6 ms |        31.6 ms |
| 1 quarter |  45.6 ms | 47.8 ms      |         40.3 ms |        **38.3 ms** |        37.3 ms |
| 1 year    |  76.5 ms | 68.9 ms      |         73.7 ms |            76.3 ms |        86.5 ms |
| Size      |        – | 2,208 kB     |           24 kB |          **24 kB** |          24 kB |

⚠ = the planner switched to a worse plan (a parallel sequential scan of all
order lines).

### What the plans show

**For a month or more, the order lines dominate, not the orders.** A month has
about 2,900 sold orders with about 7,200 lines. PostgreSQL reads all 250,000
order lines sequentially and hash-joins them, because 2,336 sequential page
reads are cheaper than about 2,900 separate index lookups. No index on `orders`
changes that:

```text
->  Hash Join
      ->  Seq Scan on order_items oi (actual time=0.008..10.616 rows=249952.00 loops=1)
      ->  Hash
            ->  Bitmap Heap Scan on orders o (actual time=0.031..1.891 rows=2854.00 loops=1)
Execution Time: 34.213 ms
```

Without the index, the planner splits that scan across two parallel workers.
With a cheaper way to find the orders, it picks a single-threaded plan instead,
so a month is about 5 ms slower with either index. That's a planner costing
effect, not the index doing extra work.

**For short ranges, finding the orders is the cost, and an index removes it.**
Without an index, one day still reads all of `orders`:

```text
->  Parallel Seq Scan on orders o (actual time=3.666..4.189 rows=58.00 loops=2)
Execution Time: 8.072 ms
```

With BRIN, PostgreSQL reads only the page blocks whose `created_at` range
overlaps the day:

```text
->  Bitmap Heap Scan on orders o (actual time=0.592..0.640 rows=116.00 loops=1)
      Rows Removed by Index Recheck: 6066
      Heap Blocks: lossy=64
      ->  Bitmap Index Scan on orders_created_at_brin_idx (actual time=0.029..0.029 rows=640.00 loops=1)
            Index Cond: ((created_at >= '2026-06-15'::date) AND (created_at < '2026-06-16'::date))
Execution Time: 1.061 ms
```

"Lossy" means the index only knows which blocks *might* match. PostgreSQL
reads those 64 pages and rechecks each row, which removes 6,066 rows that are
outside the day.

### Decision: BRIN with `pages_per_range = 32`

- **Why BRIN works here:** orders are appended in time order, so the table's
  physical order follows `created_at` (correlation 0.9995). A BRIN index only
  stores the minimum and maximum `created_at` per block of pages. That's why it
  is **24 kB against 2,208 kB** for the B-tree, and almost free to maintain on
  every `INSERT`.
- **Short ranges** (the "today" or "this week" cards a dashboard would show)
  are 2–7× faster. The B-tree is fastest for exactly one day, but for one week
  it led the planner into a plan twice as slow as having no index.
- **Long ranges** (a month or more): all variants are within about 10–20% of
  each other, sometimes in the index's favour and sometimes against it (the
  parallel-plan effect above). Aggregating order lines dominates; making that
  faster would need a different
  approach (e.g. a pre-aggregated daily sales table), which isn't justified at
  this data size.
- **32 pages per block:** finer than the default 128, so short ranges skip more
  of the table. 16 made the planner pick the bad parallel plan for one week.
- **`autosummarize = on`:** autovacuum summarises each newly filled block
  range. Without it, pages added since the last `VACUUM` stay unsummarised and
  are always scanned.

**Things to keep an eye on:**

- BRIN depends on physical order. Status updates write new row versions; if a
  page has no free space, the new version lands on a different page, far from
  rows of the same date, and that block's min/max range widens. The
  `correlation` value in `pg_stats` shows the state. A lower `fillfactor` on
  `orders` would keep updates on the same page (HOT updates, since no B-tree
  covers `status`), if that ever becomes a problem.
- The test dataset fits in one block range, where a sequential scan is
  naturally cheaper. The test in
  [large-dataset.test.ts](../database/tests/large-dataset.test.ts) therefore
  checks the index definition, and that the function's filter can use the index
  with sequential scans disabled. The speed-up itself is measured here.

---

## 4. A view with aggregation: `product_inventory_summary`

View: [product_inventory_summary.sql](../database/views/product_inventory_summary.sql)

The view sums each product's stock over all warehouses with
`GROUP BY p.product_id, c.category_id`. The question is what happens when a
caller filters the view:

```sql
SELECT * FROM product_inventory_summary WHERE sku = 'GEN-005000';
```

If PostgreSQL applied `sku = ...` only *after* the `GROUP BY`, every lookup
would sum the stock of all 10,000 products first. I expected that risk because
`sku` is not a grouping column, and compared three designs: this one, grouping
by every output column, and a `LATERAL` subquery per product.

### Result: the filter is pushed below the aggregation

```text
Subquery Scan on product_inventory_summary (actual time=0.080..0.081 rows=1.00 loops=1)
  ->  GroupAggregate
        ->  Nested Loop Left Join
              ->  Merge Join
                    ->  Index Scan using products_sku_key on products p (rows=1.00 loops=1)
                          Index Cond: (sku = 'GEN-005000'::text)
                    ->  Seq Scan on categories c (rows=6.00 loops=1)
              ->  Index Scan using inventory_pkey on inventory i (rows=3.00 loops=1)
                    Index Cond: (product_id = p.product_id)
```

`sku` is functionally dependent on `product_id`, the grouped primary key, so
filtering products before grouping gives the same result, and PostgreSQL does
exactly that. It finds the product through its unique SKU index and sums only
its 3 inventory rows.

To show what this is worth, the same view with an optimisation fence
(`OFFSET 0`, which stops PostgreSQL from pushing conditions into a subquery):

| Query (large dataset, median of 5) | Time | Pages read |
| --- | ---: | ---: |
| `product_inventory_summary WHERE sku = ...` | **0.05 ms** | 7 |
| Same view with `OFFSET 0` fence, same filter | 26.5 ms | 323 |
| `product_inventory_summary WHERE category = 'Books'` | 11.5 ms | 323 |
| `product_inventory_summary`, all 10,024 rows | 27.6 ms | 323 |

### Design comparison

| Design | By `product_id` | By `sku` | By category | All rows |
| --- | ---: | ---: | ---: | ---: |
| **`GROUP BY` primary keys (chosen)** | 0.04 ms | 0.05 ms | **7.2 ms** | **27.0 ms** |
| `GROUP BY` every output column | 0.04 ms | 0.04 ms | 7.4 ms | 27.2 ms |
| `LATERAL` sum per product | 0.03 ms | 0.04 ms | 15.1 ms | 32.0 ms |

Single-product lookups are equally fast in all three. For larger result sets,
one hash aggregation over `inventory` beats a separate index lookup per
product, so the `LATERAL` version is about 2× slower for a category. The
simplest design wins.

The planner test in [large-dataset.test.ts](../database/tests/large-dataset.test.ts)
checks that the SKU condition is applied where `products` is read, and that
inventory is read through `inventory_pkey`. With `OFFSET 0` added to the view,
that test fails.

## Reproduce

```bash
./dev up
./dev migrate
./dev seed-large                                        # ~10 s
./dev psql < docs/sql/explain_customer_orders.sql       # section 1: before and after
./dev psql < docs/sql/explain_product_availability.sql  # section 2
./dev psql < docs/sql/explain_best_selling_products.sql # section 3
```

`explain_customer_orders.sql` and `explain_best_selling_products.sql` drop
or create indexes inside a transaction, run `EXPLAIN ANALYZE`, and roll back. PostgreSQL DDL is transactional, so the index
is back immediately afterwards.

Run `./dev seed` to return to the small dataset.
