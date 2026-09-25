-- 0004_brin_index_orders_created_at.sql
--
-- Supports date-range reports such as get_best_selling_products():
--
--   WHERE o.created_at >= $start AND o.created_at < $end + 1
--
-- BRIN (block range index) instead of B-tree: orders are appended in time
-- order, so the physical row order follows created_at (correlation 0.9995 on
-- the large dataset). A BRIN index stores only the minimum and maximum
-- created_at of each block of pages, which makes it tiny and cheap to
-- maintain, and lets a date-range query skip every block outside the range.
--
-- Measured on the large dataset (docs/query-optimization.md, section 3):
--
--   range     no index   B-tree      BRIN (32 pages)
--   1 day      7.3 ms    0.4 ms       1.0 ms
--   1 week     8.1 ms   18.7 ms       4.7 ms
--   1 month   25.5 ms   30.6 ms      30.6 ms
--   1 quarter 45.6 ms   47.8 ms      38.3 ms
--   size          -     2,208 kB      24 kB
--
-- For a month or more, aggregating the order lines dominates and no index on
-- orders helps. For short ranges BRIN is 2-7x faster, never picks a much worse
-- plan (the B-tree did for one week), and is ~90x smaller than the B-tree.
--
-- pages_per_range = 32 (default 128): finer blocks skip more of the table for
-- short ranges; 16 was measured too and made the planner choose a worse plan
-- for one week. autosummarize = on: autovacuum summarises each newly filled
-- block range, instead of leaving new pages unsummarised (and always scanned)
-- until the next VACUUM.

CREATE INDEX orders_created_at_brin_idx
    ON orders USING brin (created_at)
    WITH (pages_per_range = 32, autosummarize = on);
