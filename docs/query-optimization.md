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

## Reproduce

```bash
./dev up
./dev migrate
./dev seed-large                                   # ~10 s
./dev psql < docs/sql/explain_customer_orders.sql  # before and after
```

The script drops the index inside a transaction, runs `EXPLAIN ANALYZE`, and
rolls back. PostgreSQL DDL is transactional, so the index is back immediately
afterwards.

Run `./dev seed` to return to the small dataset.
