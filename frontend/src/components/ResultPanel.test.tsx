import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiResponse } from '../api.ts';
import { type Operation, operations } from '../operations.ts';
import { ResultPanel } from './ResultPanel.tsx';

const op = (id: string) => operations.find((o) => o.id === id) as Operation;

const response = (overrides: Partial<ApiResponse>): ApiResponse => ({
  method: 'GET',
  path: '/api/customers/1/orders',
  status: 200,
  ok: true,
  durationMs: 12.34,
  data: null,
  ...overrides,
});

describe('ResultPanel', () => {
  it('renders list results as a table with metadata', () => {
    render(
      <ResultPanel
        operation={op('customer-orders')}
        response={response({
          data: {
            customerId: 1,
            orders: [
              { orderId: 14, status: 'cancelled', totalAmount: '79.00', itemCount: 1, createdAt: '2026-08-02T19:17:00.000Z' },
              { orderId: 6, status: 'delivered', totalAmount: '174.80', itemCount: 2, createdAt: '2026-03-11T06:20:00.000Z' },
            ],
          },
        })}
      />,
    );

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Order ID',
      'Status',
      'Total amount',
      'Item count',
      'Created at',
    ]);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('2026-08-02 19:17 UTC')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('12.3 ms')).toBeInTheDocument();
    expect(screen.getByText('GET /api/customers/1/orders')).toBeInTheDocument();
  });

  it('says so when a list is empty', () => {
    render(<ResultPanel operation={op('customer-orders')} response={response({ data: { customerId: 12, orders: [] } })} />);

    expect(screen.getByText('No rows returned.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders single results as labelled values', () => {
    render(
      <ResultPanel
        operation={op('product-availability')}
        response={response({
          data: { productId: 5, warehouseId: 1, quantityOnHand: 40, quantityReserved: 1, quantityAvailable: 39 },
        })}
      />,
    );

    expect(screen.getByText('Quantity available').nextSibling).toHaveTextContent('39');
  });

  it('shows API errors with code, SQLSTATE and message', () => {
    render(
      <ResultPanel
        operation={op('reserve-stock')}
        response={response({
          method: 'POST',
          path: '/api/inventory/reserve',
          body: { productId: 5, warehouseId: 1, quantity: 999 },
          status: 409,
          ok: false,
          data: {
            error: {
              code: 'INSUFFICIENT_STOCK',
              message: 'insufficient stock for product 5 in warehouse 1: requested 999, available 39',
              sqlstate: 'JD001',
            },
          },
        })}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('INSUFFICIENT_STOCK');
    expect(alert).toHaveTextContent('SQLSTATE JD001');
    expect(alert).toHaveTextContent('requested 999, available 39');
    expect(screen.getByText('409')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains when the API cannot be reached', () => {
    render(
      <ResultPanel
        operation={op('customer-orders')}
        response={response({
          status: 0,
          ok: false,
          data: { error: { code: 'API_UNREACHABLE', message: 'Could not reach the API. Start it with ./dev api.' } },
        })}
      />,
    );

    expect(screen.getByText('No response')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('API_UNREACHABLE');
  });
});
