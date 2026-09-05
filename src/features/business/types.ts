export type DocumentKind = 'invoice' | 'quote';

export type CurrencyCode = 'IDR' | 'USD' | 'SGD' | 'MYR';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected';
export type DocumentStatus = InvoiceStatus | QuoteStatus;

export type DocumentFont =
  | 'Inter/Sans'
  | 'Arial'
  | 'Georgia'
  | 'Times New Roman'
  | 'Courier New';

export type DocumentTemplateKind = 'invoice' | 'quote' | 'both';

export type DocumentTemplateVariant = 'classic' | 'project' | 'corporate' | 'soft';

export type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: DocumentTemplateKind;
  variant: DocumentTemplateVariant;
  font: DocumentFont;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  surfaceColor: string;
  borderColor: string;
  mutedColor: string;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DocumentTemplateSnapshot = Pick<
  DocumentTemplate,
  | 'id'
  | 'name'
  | 'description'
  | 'icon'
  | 'variant'
  | 'font'
  | 'accentColor'
  | 'backgroundColor'
  | 'textColor'
  | 'surfaceColor'
  | 'borderColor'
  | 'mutedColor'
  | 'version'
>;

export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

export type DocumentAppearance = {
  font: DocumentFont;
  backgroundColor: string;
  accentColor: string;
  textColor: string;
  backgroundImageUrl: string;
  backgroundImagePath: string;
};

export type BusinessIdentity = {
  logoUrl: string;
  logoPath: string;
  name: string;
  address: string;
  email: string;
  phone: string;
};

export type RecipientIdentity = {
  companyName: string;
  contactName: string;
  address: string;
  email: string;
  phone: string;
};

export type PaymentInformation = {
  title: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  instructions: string;
};

export type QuoteAdditionalPage = {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
};

export type BusinessDocument = {
  id: string;
  kind: DocumentKind;
  number: string;
  title: string;
  issueDate: string;
  dueDate: string;
  currency: CurrencyCode;
  status: DocumentStatus;
  appearance: DocumentAppearance;
  template: DocumentTemplateSnapshot;
  business: BusinessIdentity;
  recipient: RecipientIdentity;
  items: LineItem[];
  discountPercent: number;
  taxPercent: number;
  payment: PaymentInformation;
  notes: string;
  terms: string;
  footer: string;
  introduction: string;
  additionalPages: QuoteAdditionalPage[];
  sourceFeeCalculationId?: string | null;
  sourceQuoteId?: string | null;
};

export type StoredDocument = {
  id: string;
  workspace_id: string;
  document_number: string;
  status: DocumentStatus;
  data: BusinessDocument;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
  source_fee_calculation_id?: string | null;
  source_quote_id?: string | null;
};

export type CalculationTotals = {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  grandTotal: number;
};

export type LivingCostItem = {
  id: string;
  label: string;
  description: string;
  amount: number;
  sortOrder: number;
};

export type ProductionItem = {
  id: string;
  label: string;
  hoursPerItem: number;
  quantity: number;
  sortOrder: number;
};

export type AddOnItem = {
  id: string;
  label: string;
  price: number;
  quantity: number;
  sortOrder: number;
};

export type OperationalItem = {
  id: string;
  label: string;
  description: string;
  amount: number;
  sortOrder: number;
};

export type FeePackage = {
  id: string;
  name: string;
  markupPercent: number;
  sortOrder: number;
};

export type UnitPriceCategory = 'production' | 'addon' | 'operational' | 'other';

export type UnitPriceItem = {
  id: string;
  label: string;
  category: UnitPriceCategory;
  unit: string;
  price: number;
  description: string;
  isActive: boolean;
  sortOrder: number;
};

export type CustomQuote = {
  items: LineItem[];
  discountPercent: number;
  taxPercent: number;
  notes: string;
};

export type FeeCalculatorState = {
  hoursPerDay: number;
  daysPerWeek: number;
  profitMarginPercent: number;
  livingCosts: LivingCostItem[];
  productionItems: ProductionItem[];
  addOns: AddOnItem[];
  operationalItems: OperationalItem[];
  packages: FeePackage[];
  unitPrices: UnitPriceItem[];
  customQuote: CustomQuote;
};

export type FeeCalculation = {
  livingCostTotal: number;
  monthlyWorkHours: number;
  minimumHourlyRate: number;
  recommendedHourlyRate: number;
  retainerTotal: number;
  productionHours: number;
  contentCount: number;
  productionTotal: number;
  equivalentProductionDays: number;
  addOnTotal: number;
  addOnCount: number;
  operationalTotal: number;
  operationalCount: number;
  baseServiceFee: number;
  baseAllInPrice: number;
  packages: Array<FeePackage & {
    markupAmount: number;
    serviceFee: number;
    allInPrice: number;
  }>;
};

export type FeeQuoteDraft = {
  id: string;
  source: 'fee-calculator';
  createdAt: string;
  items: LineItem[];
  discountPercent: number;
  taxPercent: number;
  notes: string;
  totals: CalculationTotals;
};

export type PersistenceSource = 'server' | 'recovery';

export type PersistenceResult<T> = {
  data: T;
  source: PersistenceSource;
  warning?: string;
};

export type BusinessAccess = {
  role: 'admin' | 'finance' | 'pricing' | 'member';
  pages: string[];
  token: string;
};
