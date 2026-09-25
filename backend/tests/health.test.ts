import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { useApi } from './helpers.ts';

const api = useApi();

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const response = await api.app().inject('/api/health');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('returns 503 when the database cannot be reached', async () => {
    const app = buildApp({
      db: { query: () => Promise.reject(new Error('connect ECONNREFUSED')) } as never,
    });

    const response = await app.inject('/api/health');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', database: 'unreachable' });
    await app.close();
  });
});

describe('error handling', () => {
  it('answers unknown routes with 404 ROUTE_NOT_FOUND', async () => {
    const response = await api.app().inject('/api/does-not-exist');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route GET /api/does-not-exist not found' },
    });
  });

  it('rejects a malformed JSON body with 400', async () => {
    const response = await api.app().inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'content-type': 'application/json' },
      payload: '{"customerId": 1,',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('hides the details of unexpected errors', async () => {
    const app = buildApp({
      db: { query: () => Promise.reject(new Error('password authentication failed for user "x"')) } as never,
    });

    const response = await app.inject('/api/customers/1/orders');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(response.body).not.toContain('password');
    await app.close();
  });
});
