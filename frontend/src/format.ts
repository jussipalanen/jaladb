import type { Cell } from './operations.ts';

/** "totalAmount" -> "Total amount", "orderId" -> "Order ID", "sku" -> "SKU" */
export function columnLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .map((word) => (word === 'id' || word === 'sku' ? word.toUpperCase() : word))
    .join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Timestamps as "2026-08-02 19:17 UTC"; everything else as text. */
export function formatCell(value: Cell): string {
  if (value === null) return '—';
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
    return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
  }
  return String(value);
}

/** Numbers and decimal strings (money) are right-aligned in tables. */
export function isNumeric(value: Cell): boolean {
  return typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value));
}
