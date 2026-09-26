/**
 * The predefined database operations the console can run. Each one maps form
 * values to exactly one API call; the console never sends SQL. The `sql` text
 * is shown to the user to explain which database function runs.
 */

export type FieldType = 'integer' | 'date' | 'lines';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  defaultValue: string;
  hint?: string;
}

/** Order lines for the create-order form. */
export interface Line {
  productId: string;
  quantity: string;
}

export type FormValues = Record<string, string | Line[]>;

export interface Request {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

export type Cell = string | number | boolean | null;

/** How a successful response is displayed: a table or a single record. */
export type ResultView =
  | { kind: 'table'; columns: string[]; rows: Record<string, Cell>[] }
  | { kind: 'record'; fields: Record<string, Cell> };

export interface Operation {
  id: string;
  title: string;
  description: string;
  /** Database function called by the API. */
  dbFunction: string;
  /** The SQL the API runs, for display only. */
  sql: string;
  fields: Field[];
  toRequest(values: FormValues): Request;
  toView(data: unknown): ResultView;
}

// Form values are sent as typed JSON; anything that is not a valid number is
// sent unchanged, so the API's own validation answers (and is visible).
const number = (value: string | Line[] | undefined) => {
  const text = String(value ?? '').trim();
  return text !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
};
const text = (value: string | Line[] | undefined) => encodeURIComponent(String(value ?? '').trim());

type Json = Record<string, unknown>;
const record = (data: unknown): ResultView => ({ kind: 'record', fields: data as Record<string, Cell> });
const table = (rows: Json[], columns: string[]): ResultView => ({
  kind: 'table',
  columns,
  rows: rows as Record<string, Cell>[],
});

export const operations: Operation[] = [
  {
    id: 'customer-orders',
    title: 'Customer orders',
    description: 'All orders of one customer, newest first, with item counts and totals.',
    dbFunction: 'get_customer_orders',
    sql: 'SELECT * FROM get_customer_orders($1)',
    fields: [{ name: 'customerId', label: 'Customer ID', type: 'integer', defaultValue: '1', hint: '1–12 in the seed data; 12 has no orders' }],
    toRequest: (v) => ({ method: 'GET', path: `/api/customers/${text(v.customerId)}/orders` }),
    toView: (data) =>
      table((data as { orders: Json[] }).orders, ['orderId', 'status', 'totalAmount', 'itemCount', 'createdAt']),
  },
  {
    id: 'product-availability',
    title: 'Product availability',
    description: 'Stock on hand, reserved and available for one product in one warehouse.',
    dbFunction: 'get_product_availability',
    sql: 'SELECT * FROM get_product_availability($1, $2)',
    fields: [
      { name: 'productId', label: 'Product ID', type: 'integer', defaultValue: '5', hint: '5 = noise-cancelling headphones' },
      { name: 'warehouseId', label: 'Warehouse ID', type: 'integer', defaultValue: '1', hint: '1 Helsinki · 2 Tampere · 3 Oulu' },
    ],
    toRequest: (v) => ({
      method: 'GET',
      path: `/api/products/${text(v.productId)}/availability?warehouseId=${text(v.warehouseId)}`,
    }),
    toView: record,
  },
  {
    id: 'reserve-stock',
    title: 'Reserve stock',
    description: 'Reserves units under a row lock. Fails with INSUFFICIENT_STOCK when there are not enough.',
    dbFunction: 'reserve_stock',
    sql: 'SELECT reserve_stock($1, $2, $3)',
    fields: [
      { name: 'productId', label: 'Product ID', type: 'integer', defaultValue: '5' },
      { name: 'warehouseId', label: 'Warehouse ID', type: 'integer', defaultValue: '1' },
      { name: 'quantity', label: 'Quantity', type: 'integer', defaultValue: '2', hint: 'Try more than is available' },
    ],
    toRequest: (v) => ({
      method: 'POST',
      path: '/api/inventory/reserve',
      body: { productId: number(v.productId), warehouseId: number(v.warehouseId), quantity: number(v.quantity) },
    }),
    toView: record,
  },
  {
    id: 'create-order',
    title: 'Create order',
    description: 'Creates an order and reserves its stock in one transaction: all lines succeed, or nothing is saved.',
    dbFunction: 'create_order',
    sql: 'SELECT create_order($1, $2, $3::jsonb)',
    fields: [
      { name: 'customerId', label: 'Customer ID', type: 'integer', defaultValue: '1' },
      { name: 'warehouseId', label: 'Warehouse ID', type: 'integer', defaultValue: '1' },
      { name: 'items', label: 'Order lines', type: 'lines', defaultValue: '', hint: 'Product 7 = chef’s knife, 5 = headphones' },
    ],
    toRequest: (v) => ({
      method: 'POST',
      path: '/api/orders',
      body: {
        customerId: number(v.customerId),
        warehouseId: number(v.warehouseId),
        items: (v.items as Line[]).map((line) => ({ productId: number(line.productId), quantity: number(line.quantity) })),
      },
    }),
    toView: record,
  },
  {
    id: 'best-selling',
    title: 'Best-selling products',
    description: 'Top products by units sold in a date range (paid, shipped and delivered orders).',
    dbFunction: 'get_best_selling_products',
    sql: 'SELECT * FROM get_best_selling_products($1, $2, $3)',
    fields: [
      { name: 'start', label: 'Start date', type: 'date', defaultValue: '2026-01-01' },
      { name: 'end', label: 'End date', type: 'date', defaultValue: '2026-06-30' },
      { name: 'limit', label: 'Limit', type: 'integer', defaultValue: '5', hint: '1–100' },
    ],
    toRequest: (v) => ({
      method: 'GET',
      path: `/api/reports/best-selling?start=${text(v.start)}&end=${text(v.end)}&limit=${text(v.limit)}`,
    }),
    toView: (data) =>
      table((data as { products: Json[] }).products, ['productId', 'sku', 'name', 'unitsSold', 'revenue']),
  },
];

export const defaultLines = (): Line[] => [
  { productId: '5', quantity: '2' },
  { productId: '7', quantity: '1' },
];

export function initialValues(operation: Operation): FormValues {
  return Object.fromEntries(
    operation.fields.map((field) => [field.name, field.type === 'lines' ? defaultLines() : field.defaultValue]),
  );
}
