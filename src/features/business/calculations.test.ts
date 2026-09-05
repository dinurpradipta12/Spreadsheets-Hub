import { describe, expect, it } from 'vitest';
import {
  calculateFeeCalculator,
  calculateLineItems,
  formatCurrency,
  nonNegative,
  splitItemsForA4,
} from './calculations';
import { agencyInitials, createDefaultFeeCalculator, generateDocumentNumber } from './defaults';

describe('document calculation utilities', () => {
  it('calculates subtotal, discount, taxable amount, tax, and total without early rounding', () => {
    const totals = calculateLineItems([
      { id: 'a', description: 'A', quantity: 2, unitPrice: 100 },
      { id: 'b', description: 'B', quantity: 1.5, unitPrice: 200 },
    ], 10, 11);

    expect(totals).toEqual({
      subtotal: 500,
      discountAmount: 50,
      taxableAmount: 450,
      taxAmount: 49.5,
      grandTotal: 499.5,
    });
  });

  it('never produces a negative taxable amount or accepts negative numeric input', () => {
    const totals = calculateLineItems([
      { id: 'a', description: 'A', quantity: -2, unitPrice: 100 },
    ], 200, 11);
    expect(totals.taxableAmount).toBe(0);
    expect(totals.grandTotal).toBe(0);
    expect(nonNegative(Number.NaN)).toBe(0);
    expect(nonNegative(-50)).toBe(0);
  });

  it('paginates long item collections without dropping or duplicating rows', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `item-${index}`,
      description: index % 3 === 0 ? 'Deskripsi panjang '.repeat(10) : `Item ${index}`,
      quantity: 1,
      unitPrice: 100,
    }));
    const pages = splitItemsForA4(items, 5);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().map((item) => item.id)).toEqual(items.map((item) => item.id));
  });
});

describe('fee calculator formulas', () => {
  it('implements the exact monthly and package formulas without marking up operations', () => {
    const state = createDefaultFeeCalculator();
    state.livingCosts = [{ id: 'living', label: 'Needs', description: '', amount: 14_000_000, sortOrder: 0 }];
    state.productionItems = [{ id: 'production', label: 'Content', hoursPerItem: 2, quantity: 5, sortOrder: 0 }];
    state.addOns = [{ id: 'addon', label: 'Report', price: 250_000, quantity: 2, sortOrder: 0 }];
    state.operationalItems = [{ id: 'ops', label: 'Tools', description: '', amount: 600_000, sortOrder: 0 }];
    const result = calculateFeeCalculator(state);

    expect(result.livingCostTotal).toBe(14_000_000);
    expect(result.monthlyWorkHours).toBe(140);
    expect(result.minimumHourlyRate).toBe(100_000);
    expect(result.recommendedHourlyRate).toBe(140_000);
    expect(result.retainerTotal).toBe(19_600_000);
    expect(result.productionHours).toBe(10);
    expect(result.contentCount).toBe(5);
    expect(result.productionTotal).toBe(1_400_000);
    expect(result.equivalentProductionDays).toBeCloseTo(10 / 7);
    expect(result.addOnTotal).toBe(500_000);
    expect(result.addOnCount).toBe(1);
    expect(result.operationalTotal).toBe(600_000);
    expect(result.operationalCount).toBe(1);
    expect(result.baseServiceFee).toBe(21_500_000);
    expect(result.baseAllInPrice).toBe(22_100_000);
    expect(result.packages[1].markupAmount).toBe(4_300_000);
    expect(result.packages[1].serviceFee).toBe(25_800_000);
    expect(result.packages[1].allInPrice).toBe(26_400_000);
  });

  it('returns zero rates rather than Infinity or NaN when monthly hours are zero', () => {
    const state = createDefaultFeeCalculator();
    state.hoursPerDay = 0;
    const result = calculateFeeCalculator(state);
    expect(result.monthlyWorkHours).toBe(0);
    expect(result.minimumHourlyRate).toBe(0);
    expect(result.recommendedHourlyRate).toBe(0);
    expect(result.equivalentProductionDays).toBe(0);
  });

  it('formats all supported document currencies without decimal digits', () => {
    expect(formatCurrency(999_000, 'IDR')).toMatch(/Rp\s?999\.000/);
    expect(formatCurrency(999_000, 'USD')).toMatch(/US\$999,000/);
    expect(formatCurrency(999_000, 'SGD')).toMatch(/\$999,000/);
    expect(formatCurrency(999_000, 'MYR')).toMatch(/RM\s?999,000/);
  });
});

describe('document numbering', () => {
  it('ignores legal entity words when creating agency initials', () => {
    expect(agencyInitials('PT Bilik Strategi')).toBe('BS');
    expect(agencyInitials('CV Ruang Sosmed Indonesia')).toBe('RSI');
    expect(agencyInitials('Yayasan')).toBe('AG');
  });

  it('creates a six-character unambiguous random id in the requested format', () => {
    const number = generateDocumentNumber('invoice', 'PT Bilik Strategi', '2026-09-04');
    expect(number).toMatch(/^INV\/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}\/BS\/0409\/2026$/);
  });
});
