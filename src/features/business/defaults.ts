import type {
  AddOnItem,
  BusinessDocument,
  DocumentKind,
  FeeCalculatorState,
  LivingCostItem,
  OperationalItem,
  ProductionItem,
  UnitPriceItem,
} from './types';

const RANDOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const IGNORED_AGENCY_WORDS = new Set(['PT', 'CV', 'UD', 'FA', 'TB', 'LTD', 'INC', 'YAYASAN']);

export function createId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function localDateInput(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return localDateInput(parsed);
}

export function agencyInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .filter((word) => word && !IGNORED_AGENCY_WORDS.has(word))
  if (words.length === 1) return words[0];
  return words.slice(0, 2).map((word) => word[0]).join('') || 'AG';
}

export function randomDocumentId(): string {
  let value = '';
  const randomValues = new Uint32Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(randomValues);
  for (let index = 0; index < 6; index += 1) {
    const randomIndex = randomValues[index]
      ? randomValues[index] % RANDOM_ALPHABET.length
      : Math.floor(Math.random() * RANDOM_ALPHABET.length);
    value += RANDOM_ALPHABET[randomIndex];
  }
  return value;
}

export function generateDocumentNumber(kind: DocumentKind, businessName: string, date: string): string {
  const safeDate = date ? new Date(`${date}T12:00:00`) : new Date();
  const day = String(safeDate.getDate()).padStart(2, '0');
  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const year = safeDate.getFullYear();
  return `${kind === 'invoice' ? 'INV' : 'QTN'}/${randomDocumentId()}/${agencyInitials(businessName)}/${day}${month}/${year}`;
}

export function createDocument(kind: DocumentKind, workspaceName: string): BusinessDocument {
  const issueDate = localDateInput();
  return {
    id: createId(),
    kind,
    number: generateDocumentNumber(kind, workspaceName, issueDate),
    title: kind === 'invoice' ? 'INVOICE' : 'PENAWARAN HARGA',
    issueDate,
    dueDate: addDays(issueDate, 14),
    currency: 'IDR',
    status: 'draft',
    appearance: {
      font: 'Inter/Sans',
      backgroundColor: '#FFFFFF',
      accentColor: '#24324A',
      textColor: '#1F2937',
      backgroundImageUrl: '',
      backgroundImagePath: '',
    },
    business: {
      logoUrl: '',
      logoPath: '',
      name: workspaceName,
      address: '',
      email: '',
      phone: '',
    },
    recipient: {
      companyName: '',
      contactName: '',
      address: '',
      email: '',
      phone: '',
    },
    items: [{ id: createId(), description: '', quantity: 1, unitPrice: 0 }],
    discountPercent: 0,
    taxPercent: 0,
    payment: {
      title: 'Informasi Pembayaran',
      bankName: '',
      accountName: '',
      accountNumber: '',
      instructions: '',
    },
    notes: '',
    terms: '',
    footer: `Terima kasih telah mempercayai ${workspaceName}.`,
    introduction: '',
    additionalPages: [],
    sourceFeeCalculationId: null,
    sourceQuoteId: null,
  };
}

function ordered<T extends { id: string; sortOrder: number }>(items: Omit<T, 'id' | 'sortOrder'>[]): T[] {
  return items.map((item, index) => ({ ...item, id: createId(), sortOrder: index })) as T[];
}

export function createDefaultFeeCalculator(): FeeCalculatorState {
  const livingCosts = ordered<LivingCostItem>([
    { label: 'Sewa/kos/cicilan rumah', description: '', amount: 0 },
    { label: 'Makan & minum', description: '', amount: 0 },
    { label: 'Transportasi', description: '', amount: 0 },
    { label: 'Internet & listrik', description: '', amount: 0 },
    { label: 'Kesehatan & pribadi', description: '', amount: 0 },
    { label: 'Hiburan & sosial', description: '', amount: 0 },
    { label: 'Tabungan/investasi target', description: '', amount: 0 },
    { label: 'Lain-lain/tak terduga', description: '', amount: 0 },
  ]);

  const productionItems = ordered<ProductionItem>([
    { label: 'Foto/Grafis static post', hoursPerItem: 1.5, quantity: 0 },
    { label: 'Carousel/Infografis', hoursPerItem: 3, quantity: 0 },
    { label: 'Video/Reels pendek di bawah 60 detik', hoursPerItem: 4.5, quantity: 0 },
    { label: 'Long-form video di atas 60 detik', hoursPerItem: 7, quantity: 0 },
    { label: 'Copywriting caption', hoursPerItem: 0.75, quantity: 0 },
    { label: 'Story/Ephemeral content', hoursPerItem: 0.75, quantity: 0 },
    { label: 'Thumbnail/Cover design', hoursPerItem: 1, quantity: 0 },
    { label: 'Jenis konten lainnya', hoursPerItem: 1, quantity: 0 },
  ]);

  const addOns = ordered<AddOnItem>([
    { label: 'Strategy deck/content plan bulanan', price: 250_000, quantity: 0 },
    { label: 'Monthly report & analitik', price: 200_000, quantity: 0 },
    { label: 'Meeting klien', price: 150_000, quantity: 0 },
    { label: 'Brand audit/riset kompetitor', price: 350_000, quantity: 0 },
    { label: 'Community management dasar', price: 750_000, quantity: 0 },
    { label: 'Community management penuh', price: 1_500_000, quantity: 0 },
    { label: 'Paid ads setup & monitoring', price: 750_000, quantity: 0 },
    { label: 'Konsultasi non-retainer', price: 200_000, quantity: 0 },
  ]);

  const operationalItems = ordered<OperationalItem>([
    { label: 'Aplikasi/tools berbayar', description: '', amount: 200_000 },
    { label: 'Adobe CC/software desain', description: '', amount: 250_000 },
    { label: 'Musik/stock berlisensi', description: '', amount: 0 },
    { label: 'Penyimpanan cloud', description: '', amount: 50_000 },
    { label: 'Internet/kuota tambahan', description: '', amount: 100_000 },
    { label: 'Transport ke klien', description: '', amount: 0 },
    { label: 'Parkir dan operasional lapangan', description: '', amount: 0 },
    { label: 'Operasional lainnya', description: '', amount: 0 },
  ]);

  const unitPrices = ordered<UnitPriceItem>([
    { label: 'Foto/Grafis static post', category: 'production', unit: 'konten', price: 150_000, description: '', isActive: true },
    { label: 'Carousel/Infografis', category: 'production', unit: 'konten', price: 250_000, description: '', isActive: true },
    { label: 'Video/Reels pendek', category: 'production', unit: 'video', price: 400_000, description: '', isActive: true },
    { label: 'Long-form video', category: 'production', unit: 'video', price: 750_000, description: '', isActive: true },
    { label: 'Copywriting caption', category: 'production', unit: 'caption', price: 75_000, description: '', isActive: true },
    { label: 'Story/Ephemeral content', category: 'production', unit: 'konten', price: 75_000, description: '', isActive: true },
    { label: 'Thumbnail/Cover design', category: 'production', unit: 'desain', price: 100_000, description: '', isActive: true },
    { label: 'Strategy deck/content plan', category: 'addon', unit: 'dokumen', price: 250_000, description: '', isActive: true },
    { label: 'Monthly report & analitik', category: 'addon', unit: 'laporan', price: 200_000, description: '', isActive: true },
    { label: 'Meeting klien', category: 'addon', unit: 'sesi', price: 150_000, description: '', isActive: true },
    { label: 'Brand audit/riset kompetitor', category: 'addon', unit: 'proyek', price: 350_000, description: '', isActive: true },
    { label: 'Konsultasi non-retainer', category: 'addon', unit: 'jam', price: 200_000, description: '', isActive: true },
  ]);

  return {
    hoursPerDay: 7,
    daysPerWeek: 5,
    profitMarginPercent: 40,
    livingCosts,
    productionItems,
    addOns,
    operationalItems,
    packages: ordered([
      { name: 'Starter', markupPercent: 0 },
      { name: 'Growth', markupPercent: 20 },
      { name: 'Scale', markupPercent: 40 },
    ]),
    unitPrices,
    customQuote: {
      items: [{ id: createId(), description: '', quantity: 1, unitPrice: 0 }],
      discountPercent: 0,
      taxPercent: 0,
      notes: '',
    },
  };
}
