import { describe, expect, it } from 'vitest';
import { useApi } from './helpers.ts';

const api = useApi();

describe('GET /api/reports/best-selling', () => {
  it('returns the best-selling products in the date range', async () => {
    const response = await api.app().inject('/api/reports/best-selling?start=2026-01-01&end=2026-06-30&limit=3');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      start: '2026-01-01',
      end: '2026-06-30',
      limit: 3,
      products: [
        { productId: 11, sku: 'OUTD-3003', name: 'Insulated Water Bottle 1 L', unitsSold: 3, revenue: '89.70' },
        { productId: 18, sku: 'OFFC-5003', name: 'A5 Dotted Notebook (3-pack)', unitsSold: 3, revenue: '44.70' },
        { productId: 3, sku: 'ELEC-1003', name: 'USB-C Charger 65 W', unitsSold: 2, revenue: '79.80' },
      ],
    });
  });

  it('defaults the limit to 10', async () => {
    const response = await api.app().inject('/api/reports/best-selling?start=2026-01-01&end=2026-12-31');

    expect(response.json().limit).toBe(10);
    expect(response.json().products).toHaveLength(10);
  });

  it('returns 400 INVALID_ARGUMENT when start is after end (checked by the database)', async () => {
    const response = await api.app().inject('/api/reports/best-selling?start=2026-06-30&end=2026-01-01');

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'start date 2026-06-30 is after end date 2026-01-01',
        sqlstate: '22023',
      },
    });
  });

  it.each([
    ['a missing end date', 'start=2026-01-01'],
    ['an impossible date', 'start=2026-02-30&end=2026-03-31'],
    ['a date in another format', 'start=01.01.2026&end=2026-03-31'],
    ['a limit above 100', 'start=2026-01-01&end=2026-03-31&limit=101'],
    ['a limit of 0', 'start=2026-01-01&end=2026-03-31&limit=0'],
  ])('rejects %s with 400', async (_, query) => {
    const response = await api.app().inject(`/api/reports/best-selling?${query}`);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
