-- Order status history triggers.
--
-- Two triggers on orders fill order_status_history:
--
-- 1. orders_status_history_on_insert: statement-level, AFTER INSERT
--    Records each new order's initial status (old_status NULL), timed at the
--    order's created_at. The transition table new_orders holds all rows the
--    statement inserted, so a bulk insert (seed data, the large dataset
--    generator's MERGE) writes its history with one INSERT ... SELECT instead
--    of one trigger call per row.
--
-- 2. orders_status_history_on_update: row-level, AFTER UPDATE OF status
--    WHEN (OLD.status IS DISTINCT FROM NEW.status)
--    The WHEN condition is evaluated by PostgreSQL before the trigger function
--    is called, so updates that set the same status, or that change other
--    columns only, cost nothing and record nothing. (Column lists and WHEN
--    conditions are not available for triggers with transition tables, which
--    is why this one is row-level.)
--
-- AFTER triggers see the final row values, and run inside the same
-- transaction: if the change is rolled back, so is its history.

CREATE OR REPLACE FUNCTION record_new_order_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO order_status_history (order_id, old_status, new_status, changed_at)
    SELECT n.order_id, NULL, n.status, n.created_at
    FROM new_orders n;

    RETURN NULL;  -- ignored for AFTER triggers
END;
$$;

CREATE OR REPLACE FUNCTION record_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO order_status_history (order_id, old_status, new_status)
    VALUES (NEW.order_id, OLD.status, NEW.status);

    RETURN NULL;  -- ignored for AFTER triggers
END;
$$;

CREATE OR REPLACE TRIGGER orders_status_history_on_insert
    AFTER INSERT ON orders
    REFERENCING NEW TABLE AS new_orders
    FOR EACH STATEMENT
    EXECUTE FUNCTION record_new_order_status();

CREATE OR REPLACE TRIGGER orders_status_history_on_update
    AFTER UPDATE OF status ON orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION record_order_status_change();
