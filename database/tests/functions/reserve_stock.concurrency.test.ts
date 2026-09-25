import { describe, expect, it } from 'vitest';
import { settle, useCommittedFixtures } from '../helpers/concurrency.ts';

// These tests need data that other connections can see, so unlike the other
// test files they commit their fixtures and delete them again afterwards.

const RESERVE = 'SELECT reserve_stock($1, $2, $3) AS remaining';

const fixtures = useCommittedFixtures();

describe('reserve_stock under concurrency', () => {
  it('makes a competing reservation wait, then fail if the first one committed', async () => {
    const stock = await fixtures.stock({ onHand: 5 });
    const first = await fixtures.openClient();
    const second = await fixtures.openClient();

    await first.query('BEGIN');
    await first.query(RESERVE, [stock.productId, stock.warehouseId, 4]);

    // The second transaction wants 3 of the 5 units. It must wait for the
    // first transaction's row lock instead of reading the old stock level.
    await second.query('BEGIN');
    const secondAttempt = settle(second.query(RESERVE, [stock.productId, stock.warehouseId, 3]));
    await fixtures.waitUntilBlocked(second, first);

    await first.query('COMMIT');

    const outcome = await secondAttempt;
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatchObject({
      code: 'JD001',
      message: expect.stringContaining('requested 3, available 1'),
    });
    await second.query('ROLLBACK');

    expect(await fixtures.reservedQuantity(stock)).toBe(4);
  });

  it('lets the waiting reservation succeed if the first one rolled back', async () => {
    const stock = await fixtures.stock({ onHand: 5 });
    const first = await fixtures.openClient();
    const second = await fixtures.openClient();

    await first.query('BEGIN');
    await first.query(RESERVE, [stock.productId, stock.warehouseId, 4]);

    await second.query('BEGIN');
    const secondAttempt = settle(second.query(RESERVE, [stock.productId, stock.warehouseId, 3]));
    await fixtures.waitUntilBlocked(second, first);

    await first.query('ROLLBACK');

    const outcome = await secondAttempt;
    expect(outcome).toMatchObject({ ok: true, result: { rows: [{ remaining: 2 }] } });
    await second.query('COMMIT');

    expect(await fixtures.reservedQuantity(stock)).toBe(3);
  });

  it('never over-reserves when many connections compete for the last units', async () => {
    const stock = await fixtures.stock({ onHand: 5 });
    const clients = await Promise.all(Array.from({ length: 12 }, () => fixtures.openClient()));

    // Twelve customers try to reserve one unit each at the same time.
    const outcomes = await Promise.all(
      clients.map((client) => settle(client.query(RESERVE, [stock.productId, stock.warehouseId, 1]))),
    );

    const succeeded = outcomes.filter((o) => o.ok);
    const failed = outcomes.filter((o) => !o.ok);
    expect(succeeded).toHaveLength(5);
    expect(failed).toHaveLength(7);
    for (const outcome of failed) {
      expect(!outcome.ok && outcome.error).toMatchObject({ code: 'JD001' });
    }
    expect(await fixtures.reservedQuantity(stock)).toBe(5);
  });
});

describe('reserve_stock in a larger transaction', () => {
  it('is rolled back when a later step of the same transaction fails', async () => {
    const plenty = await fixtures.stock({ onHand: 10 });
    const scarce = await fixtures.stock({ onHand: 1 });
    const client = await fixtures.openClient();

    await client.query('BEGIN');
    await client.query(RESERVE, [plenty.productId, plenty.warehouseId, 3]);
    await expect(client.query(RESERVE, [scarce.productId, scarce.warehouseId, 2])).rejects.toMatchObject({
      code: 'JD001',
    });
    await client.query('ROLLBACK');

    expect(await fixtures.reservedQuantity(plenty)).toBe(0);
    expect(await fixtures.reservedQuantity(scarce)).toBe(0);
  });
});
