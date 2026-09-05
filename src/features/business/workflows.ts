import { calculateLineItems } from './calculations';
import { createDocument, createId } from './defaults';
import type { BusinessDocument, CustomQuote, FeeQuoteDraft, LineItem } from './types';

function snapshotItems(items: LineItem[]): LineItem[] {
  return items.map((item) => ({ ...item, id: createId() }));
}

export function createFeeDraftSnapshot(customQuote: CustomQuote): Omit<FeeQuoteDraft, 'id' | 'createdAt' | 'source'> {
  const items = customQuote.items.map((item) => ({ ...item }));
  return {
    items,
    discountPercent: customQuote.discountPercent,
    taxPercent: customQuote.taxPercent,
    notes: customQuote.notes,
    totals: calculateLineItems(items, customQuote.discountPercent, customQuote.taxPercent),
  };
}

export function createQuoteFromFeeDraft(
  draft: FeeQuoteDraft,
  workspaceName: string,
  template?: BusinessDocument,
): BusinessDocument {
  const quote = createDocument('quote', workspaceName);
  if (template?.kind === 'quote') {
    quote.number = template.number;
    quote.title = template.title;
    quote.issueDate = template.issueDate;
    quote.dueDate = template.dueDate;
    quote.currency = template.currency;
    quote.appearance = { ...template.appearance };
    quote.business = { ...template.business };
    quote.recipient = { ...template.recipient };
    quote.payment = { ...template.payment };
    quote.terms = template.terms;
    quote.footer = template.footer;
    quote.introduction = template.introduction;
    quote.additionalPages = template.additionalPages.map((page) => ({ ...page, id: createId() }));
  }
  quote.items = snapshotItems(draft.items);
  quote.discountPercent = draft.discountPercent;
  quote.taxPercent = draft.taxPercent;
  quote.notes = draft.notes;
  quote.sourceFeeCalculationId = draft.id;
  return quote;
}

export function createInvoiceFromAcceptedQuote(quote: BusinessDocument, workspaceName: string): BusinessDocument {
  if (quote.kind !== 'quote' || quote.status !== 'accepted') {
    throw new Error('Invoice hanya dapat dibuat dari penawaran berstatus Diterima.');
  }
  const invoice = createDocument('invoice', workspaceName);
  invoice.business = { ...quote.business };
  invoice.recipient = { ...quote.recipient };
  invoice.items = snapshotItems(quote.items);
  invoice.discountPercent = quote.discountPercent;
  invoice.taxPercent = quote.taxPercent;
  invoice.currency = quote.currency;
  invoice.payment = { ...quote.payment };
  invoice.notes = `Berdasarkan penawaran ${quote.number}${quote.notes ? `\n\n${quote.notes}` : ''}`;
  invoice.sourceQuoteId = quote.id;
  return invoice;
}
