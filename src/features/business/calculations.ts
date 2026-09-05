import type {
  BusinessDocument,
  CalculationTotals,
  FeeCalculation,
  FeeCalculatorState,
  LineItem,
} from './types';

export function nonNegative(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function calculateLineItems(
  items: LineItem[],
  discountPercent: number,
  taxPercent: number,
): CalculationTotals {
  const subtotal = items.reduce(
    (sum, item) => sum + nonNegative(item.quantity) * nonNegative(item.unitPrice),
    0,
  );
  const discountAmount = subtotal * nonNegative(discountPercent) / 100;
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxableAmount * nonNegative(taxPercent) / 100;

  return {
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    grandTotal: taxableAmount + taxAmount,
  };
}

export function calculateDocument(document: BusinessDocument): CalculationTotals {
  return calculateLineItems(document.items, document.discountPercent, document.taxPercent);
}

export function calculateFeeCalculator(state: FeeCalculatorState): FeeCalculation {
  const livingCostTotal = state.livingCosts.reduce((sum, item) => sum + nonNegative(item.amount), 0);
  const hoursPerDay = nonNegative(state.hoursPerDay);
  const daysPerWeek = nonNegative(state.daysPerWeek);
  const monthlyWorkHours = hoursPerDay * daysPerWeek * 4;
  const minimumHourlyRate = monthlyWorkHours === 0 ? 0 : livingCostTotal / monthlyWorkHours;
  const recommendedHourlyRate = minimumHourlyRate * (1 + nonNegative(state.profitMarginPercent) / 100);
  const retainerTotal = recommendedHourlyRate * monthlyWorkHours;
  const productionHours = state.productionItems.reduce(
    (sum, item) => sum + nonNegative(item.hoursPerItem) * nonNegative(item.quantity),
    0,
  );
  const contentCount = state.productionItems.reduce((sum, item) => sum + nonNegative(item.quantity), 0);
  const productionTotal = productionHours * recommendedHourlyRate;
  const equivalentProductionDays = hoursPerDay === 0 ? 0 : productionHours / hoursPerDay;
  const addOnTotal = state.addOns.reduce(
    (sum, item) => sum + nonNegative(item.price) * nonNegative(item.quantity),
    0,
  );
  const addOnCount = state.addOns.filter((item) => nonNegative(item.quantity) > 0).length;
  const operationalTotal = state.operationalItems.reduce((sum, item) => sum + nonNegative(item.amount), 0);
  const operationalCount = state.operationalItems.filter((item) => nonNegative(item.amount) > 0).length;
  const baseServiceFee = retainerTotal + productionTotal + addOnTotal;
  const baseAllInPrice = baseServiceFee + operationalTotal;

  return {
    livingCostTotal,
    monthlyWorkHours,
    minimumHourlyRate,
    recommendedHourlyRate,
    retainerTotal,
    productionHours,
    contentCount,
    productionTotal,
    equivalentProductionDays,
    addOnTotal,
    addOnCount,
    operationalTotal,
    operationalCount,
    baseServiceFee,
    baseAllInPrice,
    packages: state.packages.map((item) => {
      const markupAmount = baseServiceFee * nonNegative(item.markupPercent) / 100;
      const serviceFee = baseServiceFee + markupAmount;
      return {
        ...item,
        markupAmount,
        serviceFee,
        allInPrice: serviceFee + operationalTotal,
      };
    }),
  };
}

export function formatCurrency(value: number, currency: string = 'IDR'): string {
  const locale = currency === 'IDR' ? 'id-ID' : currency === 'MYR' ? 'ms-MY' : 'en-SG';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

export function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
}

export function splitItemsForA4(items: LineItem[], maxUnits = 6): LineItem[][] {
  if (items.length === 0) return [[]];
  const pages: LineItem[][] = [];
  let page: LineItem[] = [];
  let usedUnits = 0;

  for (const item of items) {
    const descriptionUnits = Math.max(1, Math.ceil((item.description || '').length / 52));
    const units = Math.min(3, descriptionUnits);
    if (page.length > 0 && usedUnits + units > maxUnits) {
      pages.push(page);
      page = [];
      usedUnits = 0;
    }
    page.push(item);
    usedUnits += units;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
