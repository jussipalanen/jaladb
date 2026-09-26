import { describe, expect, it } from 'vitest';
import { columnLabel, formatCell, isNumeric } from './format.ts';

describe('columnLabel', () => {
  it.each([
    ['totalAmount', 'Total amount'],
    ['orderId', 'Order ID'],
    ['sku', 'SKU'],
    ['quantityAvailable', 'Quantity available'],
  ])('turns %s into %s', (key, label) => {
    expect(columnLabel(key)).toBe(label);
  });
});

describe('formatCell', () => {
  it('shows timestamps as date, minutes and UTC', () => {
    expect(formatCell('2026-08-02T19:17:00.000Z')).toBe('2026-08-02 19:17 UTC');
  });

  it('keeps money strings exactly as the API sent them', () => {
    expect(formatCell('477.00')).toBe('477.00');
  });

  it('shows null as a dash', () => {
    expect(formatCell(null)).toBe('—');
  });
});

describe('isNumeric', () => {
  it.each([
    [3, true],
    ['89.70', true],
    ['-2', true],
    ['OUTD-3003', false],
    ['2026-08-02T19:17:00.000Z', false],
    [null, false],
  ])('%j -> %s', (value, expected) => {
    expect(isNumeric(value)).toBe(expected);
  });
});
