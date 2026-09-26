import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/health') return json(200, { status: 'ok', database: 'ok' });
    if (url === '/api/inventory/reserve') {
      const body = JSON.parse(String(init?.body));
      return json(409, {
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: `insufficient stock for product ${body.productId} in warehouse ${body.warehouseId}: requested ${body.quantity}, available 39`,
          sqlstate: 'JD001',
        },
      });
    }
    if (url === '/api/customers/1/orders') {
      return json(200, {
        customerId: 1,
        orders: [{ orderId: 14, status: 'cancelled', totalAmount: '79.00', itemCount: 1, createdAt: '2026-08-02T19:17:00.000Z' }],
      });
    }
    return json(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'not mocked' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows that the API and database are online', async () => {
    render(<App />);

    expect(await screen.findByText('API & database online')).toBeInTheDocument();
  });

  it('runs the selected operation and shows its rows', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Run' }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('cancelled')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/customers/1/orders', expect.objectContaining({ method: 'GET' }));
  });

  it('sends the form values and shows the database error', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Reserve stock/ }));
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    await user.clear(quantity);
    await user.type(quantity, '999');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('requested 999, available 39');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inventory/reserve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ productId: 5, warehouseId: 1, quantity: 999 }),
      }),
    );
  });

  it('keeps each operation’s result when switching between them', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Product availability/ }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Customer orders/ }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
