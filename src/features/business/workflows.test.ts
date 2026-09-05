import { describe, expect, it } from 'vitest';
import { calculateDocument } from './calculations';
import { createFeeDraftSnapshot, createInvoiceFromAcceptedQuote, createQuoteFromFeeDraft } from './workflows';

describe('Fee Calculator -> Quote -> Invoice snapshot workflow', () => {
  it('preserves item prices and totals across the complete handoff', () => {
    const draftInput = createFeeDraftSnapshot({
      items: [
        { id: 'catalog-item', description: 'Carousel bulanan', quantity: 4, unitPrice: 250_000 },
        { id: 'manual-item', description: 'Workshop', quantity: 1.5, unitPrice: 400_000 },
      ],
      discountPercent: 5,
      taxPercent: 11,
      notes: 'Snapshot harga September',
    });
    const draft = { ...draftInput, id: 'draft-1', source: 'fee-calculator' as const, createdAt: new Date().toISOString() };
    const quote = createQuoteFromFeeDraft(draft, 'Bilik Strategi');
    quote.status = 'accepted';
    quote.recipient.companyName = 'Klien A';
    const quoteTotals = calculateDocument(quote);

    const invoice = createInvoiceFromAcceptedQuote(quote, 'Bilik Strategi');
    const invoiceTotals = calculateDocument(invoice);

    expect(invoice.sourceQuoteId).toBe(quote.id);
    expect(invoice.items).not.toBe(quote.items);
    expect(invoice.items.map((item) => item.unitPrice)).toEqual([250_000, 400_000]);
    expect(invoiceTotals).toEqual(quoteTotals);
    expect(invoiceTotals.grandTotal).toBe(1_687_200);
  });

  it('rejects invoice creation before the quote is accepted', () => {
    const draft = {
      ...createFeeDraftSnapshot({ items: [{ id: 'x', description: 'Service', quantity: 1, unitPrice: 10 }], discountPercent: 0, taxPercent: 0, notes: '' }),
      id: 'draft-2',
      source: 'fee-calculator' as const,
      createdAt: new Date().toISOString(),
    };
    const quote = createQuoteFromFeeDraft(draft, 'Agency');
    expect(() => createInvoiceFromAcceptedQuote(quote, 'Agency')).toThrow(/Diterima/);
  });

  it('imports fee items without overwriting branding, recipient, or document settings', () => {
    const draft = {
      ...createFeeDraftSnapshot({ items: [{ id: 'x', description: 'Service', quantity: 2, unitPrice: 50 }], discountPercent: 0, taxPercent: 0, notes: '' }),
      id: 'draft-3',
      source: 'fee-calculator' as const,
      createdAt: new Date().toISOString(),
    };
    const template = createQuoteFromFeeDraft(draft, 'Agency');
    template.business.logoUrl = 'https://assets.example/logo.png';
    template.recipient.companyName = 'Klien Tetap';
    template.appearance.accentColor = '#F26B5E';
    template.currency = 'SGD';

    const imported = createQuoteFromFeeDraft({ ...draft, id: 'draft-4' }, 'Agency', template);

    expect(imported.id).not.toBe(template.id);
    expect(imported.business.logoUrl).toBe(template.business.logoUrl);
    expect(imported.recipient.companyName).toBe('Klien Tetap');
    expect(imported.appearance.accentColor).toBe('#F26B5E');
    expect(imported.currency).toBe('SGD');
    expect(imported.sourceFeeCalculationId).toBe('draft-4');
  });
});
