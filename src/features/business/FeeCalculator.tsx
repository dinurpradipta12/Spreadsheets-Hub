import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  Check,
  CircleDollarSign,
  Clock3,
  FilePlus2,
  Layers3,
  LoaderCircle,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../../types';
import {
  createFeeQuoteDraft,
  getBusinessAccess,
  loadFeeCalculator,
  saveFeeCalculator,
  saveFeeCustomQuote,
} from './api';
import {
  calculateFeeCalculator,
  calculateLineItems,
  formatCompactNumber,
  formatCurrency,
} from './calculations';
import { createDefaultFeeCalculator, createId } from './defaults';
import {
  type BusinessToast,
  ConfirmationDialog,
  EmptyPanel,
  Field,
  LineItemEditor,
  LoadingButton,
  Modal,
  NumberInput,
  cx,
  panelAccentStyle,
  WorkspaceHeaderActionsPortal,
} from './shared';
import type {
  AddOnItem,
  FeeCalculatorState,
  LivingCostItem,
  OperationalItem,
  PersistenceSource,
  ProductionItem,
  UnitPriceCategory,
  UnitPriceItem,
} from './types';
import { createFeeDraftSnapshot } from './workflows';

type FeeTab = 'summary' | 'custom' | 'unit-prices';
type SettingsModal = 'rate' | 'production' | 'addon' | 'operational' | 'packages' | null;

const CATEGORIES: Array<{ value: UnitPriceCategory; label: string }> = [
  { value: 'production', label: 'Produksi' },
  { value: 'addon', label: 'Add-on' },
  { value: 'operational', label: 'Operasional' },
  { value: 'other', label: 'Lainnya' },
];

function countLabel(value: number, singular: string): string {
  return `${formatCompactNumber(value)} ${singular}`;
}

export function FeeCalculatorPage({
  workspace,
  toast,
  onNavigate,
}: {
  workspace: Workspace;
  toast: BusinessToast;
  onNavigate: (path: string) => void;
}) {
  const [state, setState] = useState<FeeCalculatorState>(() => createDefaultFeeCalculator());
  const [activeTab, setActiveTab] = useState<FeeTab>('summary');
  const [settingsModal, setSettingsModal] = useState<SettingsModal>(null);
  const [unitPriceModal, setUnitPriceModal] = useState(false);
  const [editingUnitPriceId, setEditingUnitPriceId] = useState<string | null>(null);
  const [unitPriceDraft, setUnitPriceDraft] = useState<UnitPriceItem>(() => ({ id: createId(), label: '', category: 'production', unit: '', price: 0, description: '', isActive: true, sortOrder: 0 }));
  const [catalogSelection, setCatalogSelection] = useState('');
  const [source, setSource] = useState<PersistenceSource>('recovery');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [deleteUnitPrice, setDeleteUnitPrice] = useState<UnitPriceItem | null>(null);
  const [continuing, setContinuing] = useState(false);
  const firstLoadRef = useRef(true);
  const saveSequenceRef = useRef(0);
  const access = getBusinessAccess(workspace.id);
  // The workspace password establishes owner access. Fee Calculator is not a
  // separate role entitlement, so every owner session can manage its data.
  const canManagePricing = Boolean(access?.token);

  const calculations = useMemo(() => calculateFeeCalculator(state), [state]);
  const customTotals = useMemo(
    () => calculateLineItems(state.customQuote.items, state.customQuote.discountPercent, state.customQuote.taxPercent),
    [state.customQuote],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await loadFeeCalculator(workspace.id);
      if (cancelled) return;
      setState(result.data);
      setSource(result.source);
      setWarning(result.warning ?? '');
      setLoading(false);
      firstLoadRef.current = false;
    })();
    return () => { cancelled = true; };
  }, [workspace.id]);

  useEffect(() => {
    if (firstLoadRef.current || !dirty) return undefined;
    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    setSaveStatus('saving');
    const timer = window.setTimeout(async () => {
      const result = canManagePricing
        ? await saveFeeCalculator(workspace.id, state)
        : await saveFeeCustomQuote(workspace.id, state);
      if (saveSequenceRef.current !== sequence) return;
      setSource(result.source);
      setWarning(result.warning ?? '');
      setSaveStatus(result.source === 'server' ? 'saved' : 'error');
      setDirty(false);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [canManagePricing, dirty, state, workspace.id]);

  const updateState = (updater: (current: FeeCalculatorState) => FeeCalculatorState) => {
    setState((current) => updater(current));
    setDirty(true);
    setSaveStatus('idle');
  };

  const retry = async () => {
    setSaveStatus('saving');
    const result = canManagePricing
      ? await saveFeeCalculator(workspace.id, state)
      : await saveFeeCustomQuote(workspace.id, state);
    setSource(result.source);
    setWarning(result.warning ?? '');
    setSaveStatus(result.source === 'server' ? 'saved' : 'error');
    toast(result.source === 'server' ? 'success' : 'error', result.source === 'server' ? 'Konfigurasi tersimpan di workspace.' : 'API belum tersedia; recovery perangkat tetap disimpan.');
  };

  const resetDefaults = () => {
    updateState(() => createDefaultFeeCalculator());
    setResetConfirmation(false);
    toast('info', 'Konfigurasi default dipulihkan dan sedang disimpan.');
  };

  const addCatalogItem = () => {
    const item = state.unitPrices.find((candidate) => candidate.id === catalogSelection && candidate.isActive);
    if (!item) {
      toast('error', 'Pilih item dari katalog terlebih dahulu.');
      return;
    }
    updateState((current) => ({
      ...current,
      customQuote: {
        ...current.customQuote,
        items: [
          ...current.customQuote.items.filter((candidate) => candidate.description || candidate.unitPrice > 0),
          { id: createId(), description: item.label, quantity: 1, unitPrice: item.price },
        ],
      },
    }));
    setCatalogSelection('');
  };

  const addManualItem = () => {
    updateState((current) => ({
      ...current,
      customQuote: {
        ...current.customQuote,
        items: [...current.customQuote.items, { id: createId(), description: '', quantity: 1, unitPrice: 0 }],
      },
    }));
  };

  const continueToQuote = async () => {
    if (state.customQuote.items.some((item) => !item.description.trim())) {
      toast('error', 'Lengkapi deskripsi semua item sebelum melanjutkan.');
      return;
    }
    setContinuing(true);
    try {
      const result = await createFeeQuoteDraft(workspace.id, createFeeDraftSnapshot(state.customQuote));
      setSource(result.source);
      setWarning(result.warning ?? '');
      if (result.source === 'recovery') {
        toast('info', 'Draft disimpan sementara di sesi perangkat karena API belum tersedia.');
      }
      onNavigate(`/quotes/new?source=fee-calculator&draft_id=${encodeURIComponent(result.data.id)}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Gagal membuat draft penawaran.');
    } finally {
      setContinuing(false);
    }
  };

  const openNewUnitPrice = () => {
    setEditingUnitPriceId(null);
    setUnitPriceDraft({ id: createId(), label: '', category: 'production', unit: '', price: 0, description: '', isActive: true, sortOrder: state.unitPrices.length });
    setUnitPriceModal(true);
  };

  const openEditUnitPrice = (item: UnitPriceItem) => {
    setEditingUnitPriceId(item.id);
    setUnitPriceDraft({ ...item });
    setUnitPriceModal(true);
  };

  const saveUnitPriceDraft = () => {
    if (!unitPriceDraft.label.trim() || !unitPriceDraft.unit.trim()) {
      toast('error', 'Nama layanan dan satuan wajib diisi.');
      return;
    }
    updateState((current) => ({
      ...current,
      unitPrices: editingUnitPriceId
        ? current.unitPrices.map((item) => item.id === editingUnitPriceId ? { ...unitPriceDraft } : item)
        : [...current.unitPrices, { ...unitPriceDraft, sortOrder: current.unitPrices.length }],
    }));
    setUnitPriceModal(false);
    toast('success', editingUnitPriceId ? 'Harga satuan diperbarui.' : 'Harga satuan ditambahkan.');
  };

  const confirmDeleteUnitPrice = () => {
    if (!deleteUnitPrice) return;
    updateState((current) => ({ ...current, unitPrices: current.unitPrices.filter((item) => item.id !== deleteUnitPrice.id) }));
    setDeleteUnitPrice(null);
    toast('success', 'Harga satuan dihapus dari katalog.');
  };

  const saveIndicator = loading
    ? <><LoaderCircle className="spin" size={15} /> Memuat...</>
    : saveStatus === 'saving'
      ? <><LoaderCircle className="spin" size={15} /> Menyimpan...</>
      : saveStatus === 'saved'
        ? <><Check size={15} /> Tersimpan</>
        : saveStatus === 'error'
          ? <><RefreshCw size={15} /> Gagal menyimpan server</>
          : dirty ? 'Menunggu autosave...' : 'Siap';

  return (
    <div className="business-page fee-calculator-page">
      <WorkspaceHeaderActionsPortal>
        <button type="button" className="business-button business-button-secondary" onClick={() => setResetConfirmation(true)} disabled={!canManagePricing}>
          <RefreshCw size={17} /> Reset
        </button>
        <button type="button" className={cx('fee-save-indicator', saveStatus === 'error' && 'is-error')} onClick={() => { if (saveStatus === 'error') void retry(); }} disabled={saveStatus !== 'error'}>
          {saveIndicator}
        </button>
      </WorkspaceHeaderActionsPortal>

      {warning && (
        <div className="studio-status-strip has-warning" role="status">
          <div><strong>Recovery perangkat aktif.</strong><small>{warning} Data lintas perangkat belum dapat dijamin.</small></div>
          <button type="button" className="business-button business-button-ghost" onClick={() => void retry()}><RefreshCw size={16} /> Retry</button>
        </div>
      )}

      <div className="fee-tabs" role="tablist" aria-label="Bagian Fee Calculator">
        <button type="button" role="tab" aria-selected={activeTab === 'summary'} className={cx(activeTab === 'summary' && 'is-active')} onClick={() => setActiveTab('summary')}><BarChart3 size={17} /> Ringkasan Harga</button>
        <button type="button" role="tab" aria-selected={activeTab === 'custom'} className={cx(activeTab === 'custom' && 'is-active')} onClick={() => setActiveTab('custom')}><FilePlus2 size={17} /> Penawaran Custom</button>
        <button type="button" role="tab" aria-selected={activeTab === 'unit-prices'} className={cx(activeTab === 'unit-prices' && 'is-active')} onClick={() => setActiveTab('unit-prices')}><BookOpen size={17} /> Harga Satuan</button>
      </div>

      {loading ? (
        <div className="fee-loading-grid" aria-label="Memuat Fee Calculator">
          {Array.from({ length: 6 }).map((_, index) => <div className="business-skeleton-card" key={index} />)}
        </div>
      ) : activeTab === 'summary' ? (
        <div className="fee-summary-content">
          <section className="fee-section">
            <div className="fee-section-heading">
              <div><span className="business-eyebrow">Hasil Otomatis</span><h2>Tiga paket siap ditawarkan</h2><p>Markup diterapkan pada fee jasa, lalu biaya operasional ditambahkan tanpa markup.</p></div>
              <button type="button" className="business-button business-button-secondary" onClick={() => setSettingsModal('packages')} disabled={!canManagePricing}><Settings2 size={17} /> Atur Paket</button>
            </div>
            <div className="fee-package-grid">
              {calculations.packages.map((item, index) => {
                const accents = ['#3978C5', '#E5765C', '#865DD5'];
                return (
                  <article className="fee-package-card" style={panelAccentStyle(accents[index] ?? '#3978C5')} key={item.id}>
                    <div className="fee-package-top"><span>Paket {index + 1}</span><Sparkles size={18} /></div>
                    <h3>{item.name}</h3>
                    <strong className="fee-package-price">{formatCurrency(item.allInPrice)}</strong>
                    <div className="fee-package-details">
                      <div><span>Markup</span><strong>{formatCompactNumber(item.markupPercent)}%</strong></div>
                      <div><span>Fee jasa</span><strong>{formatCurrency(item.serviceFee)}</strong></div>
                      <div><span>Operasional</span><strong>{formatCurrency(calculations.operationalTotal)}</strong></div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="fee-section">
            <div className="fee-section-heading"><div><span className="business-eyebrow">Komponen Dasar</span><h2>Patokan harga workspace</h2></div></div>
            <div className="fee-component-grid">
              <SummaryCard icon={<Clock3 size={20} />} title="Rate & Retainer" accent="#3978C5" onClick={() => setSettingsModal('rate')} disabled={!canManagePricing} rows={[
                ['Rate rekomendasi / jam', formatCurrency(calculations.recommendedHourlyRate)],
                ['Total retainer', formatCurrency(calculations.retainerTotal)],
                ['Jam kerja bulanan', countLabel(calculations.monthlyWorkHours, 'jam')],
              ]} />
              <SummaryCard icon={<Layers3 size={20} />} title="Produksi Konten" accent="#E5765C" onClick={() => setSettingsModal('production')} disabled={!canManagePricing} rows={[
                ['Total produksi', formatCurrency(calculations.productionTotal)],
                ['Jumlah konten', countLabel(calculations.contentCount, 'konten')],
                ['Jam produksi', countLabel(calculations.productionHours, 'jam')],
                ['Estimasi hari', countLabel(calculations.equivalentProductionDays, 'hari')],
              ]} />
              <SummaryCard icon={<PackageOpen size={20} />} title="Add-On" accent="#865DD5" onClick={() => setSettingsModal('addon')} disabled={!canManagePricing} rows={[
                ['Total add-on', formatCurrency(calculations.addOnTotal)],
                ['Komponen dipilih', countLabel(calculations.addOnCount, 'komponen')],
              ]} />
              <SummaryCard icon={<WalletCards size={20} />} title="Operasional" accent="#4F9D78" onClick={() => setSettingsModal('operational')} disabled={!canManagePricing} rows={[
                ['Total operasional', formatCurrency(calculations.operationalTotal)],
                ['Komponen aktif', countLabel(calculations.operationalCount, 'komponen')],
              ]} />
            </div>
          </section>

          <section className="fee-base-summary">
            <div><span>Total kebutuhan bulanan</span><strong>{formatCurrency(calculations.livingCostTotal)}</strong></div>
            <div><span>Fee jasa dasar</span><strong>{formatCurrency(calculations.baseServiceFee)}</strong></div>
            <div><span>Total all-in dasar</span><strong>{formatCurrency(calculations.baseAllInPrice)}</strong></div>
            <p><Calculator size={16} /> Perhitungan bulanan menggunakan empat minggu.</p>
          </section>
        </div>
      ) : activeTab === 'custom' ? (
        <div className="custom-quote-grid">
          <section className="custom-quote-editor">
            <div className="fee-section-heading">
              <div><span className="business-eyebrow">Penawaran Custom</span><h2>Susun kebutuhan customer</h2><p>Harga disalin sebagai snapshot agar dokumen lama tidak berubah saat katalog diperbarui.</p></div>
            </div>
            <div className="catalog-add-row">
              <Field label="Ambil dari katalog">
                <select className="business-select" value={catalogSelection} onChange={(event) => setCatalogSelection(event.target.value)}>
                  <option value="">Pilih layanan...</option>
                  {state.unitPrices.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.label} · {formatCurrency(item.price)}/{item.unit}</option>)}
                </select>
              </Field>
              <button type="button" className="business-button business-button-primary" onClick={addCatalogItem}><Plus size={17} /> Tambahkan</button>
              <button type="button" className="business-button business-button-secondary" onClick={addManualItem}><Pencil size={17} /> Item Manual</button>
            </div>
            <LineItemEditor items={state.customQuote.items} currency="IDR" onChange={(items) => updateState((current) => ({ ...current, customQuote: { ...current.customQuote, items } }))} />
            <div className="business-form-grid business-form-spaced">
              <Field label="Diskon (%)"><NumberInput value={state.customQuote.discountPercent} onChange={(discountPercent) => updateState((current) => ({ ...current, customQuote: { ...current.customQuote, discountPercent } }))} /></Field>
              <Field label="Pajak (%)"><NumberInput value={state.customQuote.taxPercent} onChange={(taxPercent) => updateState((current) => ({ ...current, customQuote: { ...current.customQuote, taxPercent } }))} /></Field>
              <Field label="Catatan/keterangan penawaran" className="business-field-full"><textarea className="business-textarea" rows={5} value={state.customQuote.notes} onChange={(event) => updateState((current) => ({ ...current, customQuote: { ...current.customQuote, notes: event.target.value } }))} /></Field>
            </div>
          </section>
          <aside className="custom-quote-summary">
            <div className="custom-summary-icon"><CircleDollarSign size={24} /></div>
            <span className="business-eyebrow">Ringkasan</span>
            <h2>Total Penawaran</h2>
            <strong className="custom-grand-total">{formatCurrency(customTotals.grandTotal)}</strong>
            <div className="custom-summary-lines">
              <div><span>Subtotal</span><strong>{formatCurrency(customTotals.subtotal)}</strong></div>
              <div><span>Nominal diskon</span><strong>- {formatCurrency(customTotals.discountAmount)}</strong></div>
              <div><span>Setelah diskon</span><strong>{formatCurrency(customTotals.taxableAmount)}</strong></div>
              <div><span>Pajak</span><strong>{formatCurrency(customTotals.taxAmount)}</strong></div>
              <div className="is-total"><span>Total penawaran</span><strong>{formatCurrency(customTotals.grandTotal)}</strong></div>
            </div>
            <LoadingButton className="business-button-accent business-button-full" busy={continuing} busyLabel="Membuat draft..." onClick={() => void continueToQuote()}>
              Lanjut ke Penawaran Harga <ArrowRight size={17} />
            </LoadingButton>
            <small>Query hanya membawa ID draft; seluruh nominal diambil dari snapshot server.</small>
          </aside>
        </div>
      ) : (
        <div className="unit-price-content">
          <div className="fee-section-heading">
            <div><span className="business-eyebrow">Price Book</span><h2>Patokan Harga Satuan</h2><p>Katalog ini langsung tersedia pada dropdown Penawaran Custom.</p></div>
            <button type="button" className="business-button business-button-primary" onClick={openNewUnitPrice} disabled={!canManagePricing}><Plus size={17} /> Tambah Harga Satuan</button>
          </div>
          {state.unitPrices.length === 0 ? (
            <EmptyPanel title="Katalog masih kosong" description="Tambahkan layanan pertama untuk mulai menyusun penawaran custom." action={<button type="button" className="business-button business-button-primary" onClick={openNewUnitPrice}>Tambah Layanan</button>} />
          ) : CATEGORIES.map((category) => {
            const items = state.unitPrices.filter((item) => item.category === category.value);
            if (items.length === 0) return null;
            return (
              <section className="unit-price-group" key={category.value}>
                <div className="unit-price-group-title"><h3>{category.label}</h3><span>{items.length} layanan</span></div>
                <div className="unit-price-list">
                  {items.map((item) => (
                    <article className="unit-price-card" key={item.id}>
                      <div className="unit-price-main"><span className={cx('unit-price-status', item.isActive && 'is-active')}>{item.isActive ? 'Aktif' : 'Nonaktif'}</span><h4>{item.label}</h4><p>{item.description || 'Tanpa keterangan tambahan'}</p></div>
                      <div className="unit-price-value"><strong>{formatCurrency(item.price)}</strong><span>per {item.unit}</span></div>
                      <div className="unit-price-actions">
                        <button type="button" className="business-icon-button" onClick={() => openEditUnitPrice(item)} disabled={!canManagePricing} aria-label={`Edit ${item.label}`}><Pencil size={16} /></button>
                        <button type="button" className="business-icon-button business-icon-danger" onClick={() => setDeleteUnitPrice(item)} disabled={!canManagePricing} aria-label={`Hapus ${item.label}`}><Trash2 size={16} /></button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <SettingsModals modal={settingsModal} onClose={() => setSettingsModal(null)} state={state} updateState={updateState} />
      <Modal
        open={unitPriceModal}
        onClose={() => setUnitPriceModal(false)}
        title={editingUnitPriceId ? 'Edit Harga Satuan' : 'Tambah Harga Satuan'}
        description="Nilai ini akan menjadi patokan baru untuk penawaran berikutnya."
        size="medium"
        footer={<><button type="button" className="business-button business-button-secondary" onClick={() => setUnitPriceModal(false)}>Batal</button><button type="button" className="business-button business-button-primary" onClick={saveUnitPriceDraft}>Simpan Harga</button></>}
      >
        <div className="business-form-grid">
          <Field label="Nama layanan" className="business-field-full"><input className="business-input" value={unitPriceDraft.label} onChange={(event) => setUnitPriceDraft((current) => ({ ...current, label: event.target.value }))} /></Field>
          <Field label="Kategori"><select className="business-select" value={unitPriceDraft.category} onChange={(event) => setUnitPriceDraft((current) => ({ ...current, category: event.target.value as UnitPriceCategory }))}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></Field>
          <Field label="Satuan"><input className="business-input" value={unitPriceDraft.unit} placeholder="konten, jam, sesi..." onChange={(event) => setUnitPriceDraft((current) => ({ ...current, unit: event.target.value }))} /></Field>
          <Field label="Harga fix" className="business-field-full"><NumberInput value={unitPriceDraft.price} onChange={(price) => setUnitPriceDraft((current) => ({ ...current, price }))} /></Field>
          <Field label="Keterangan" className="business-field-full"><textarea className="business-textarea" rows={4} value={unitPriceDraft.description} onChange={(event) => setUnitPriceDraft((current) => ({ ...current, description: event.target.value }))} /></Field>
          <label className="business-checkbox business-field-full"><input type="checkbox" checked={unitPriceDraft.isActive} onChange={(event) => setUnitPriceDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Aktif dan tampil di dropdown Penawaran Custom</span></label>
        </div>
      </Modal>
      <ConfirmationDialog open={resetConfirmation} title="Reset semua pengaturan?" message="Rate, produksi, add-on, operasional, paket, dan katalog akan kembali ke nilai default." confirmLabel="Reset ke Default" onConfirm={resetDefaults} onClose={() => setResetConfirmation(false)} />
      <ConfirmationDialog open={Boolean(deleteUnitPrice)} title="Hapus harga satuan?" message={deleteUnitPrice ? `${deleteUnitPrice.label} akan dihapus dari katalog. Snapshot penawaran lama tidak berubah.` : ''} confirmLabel="Hapus Harga" onConfirm={confirmDeleteUnitPrice} onClose={() => setDeleteUnitPrice(null)} />
    </div>
  );
}

function SummaryCard({ icon, title, accent, rows, onClick, disabled }: { icon: React.ReactNode; title: string; accent: string; rows: string[][]; onClick: () => void; disabled: boolean }) {
  return (
    <article className="fee-component-card" style={panelAccentStyle(accent)}>
      <div className="fee-component-head"><span>{icon}</span><h3>{title}</h3></div>
      <div className="fee-component-rows">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <button type="button" className="business-button business-button-secondary business-button-full" onClick={onClick} disabled={disabled}><Settings2 size={16} /> Atur</button>
    </article>
  );
}

function SettingsModals({ modal, onClose, state, updateState }: { modal: SettingsModal; onClose: () => void; state: FeeCalculatorState; updateState: (updater: (current: FeeCalculatorState) => FeeCalculatorState) => void }) {
  const addLiving = () => updateState((current) => ({ ...current, livingCosts: [...current.livingCosts, { id: createId(), label: '', description: '', amount: 0, sortOrder: current.livingCosts.length }] }));
  const addProduction = () => updateState((current) => ({ ...current, productionItems: [...current.productionItems, { id: createId(), label: '', hoursPerItem: 1, quantity: 0, sortOrder: current.productionItems.length }] }));
  const addOn = () => updateState((current) => ({ ...current, addOns: [...current.addOns, { id: createId(), label: '', price: 0, quantity: 0, sortOrder: current.addOns.length }] }));
  const addOperational = () => updateState((current) => ({ ...current, operationalItems: [...current.operationalItems, { id: createId(), label: '', description: '', amount: 0, sortOrder: current.operationalItems.length }] }));

  return (
    <>
      <Modal open={modal === 'rate'} onClose={onClose} title="Rate & Retainer" description="Hitung rate minimum dari kebutuhan hidup dan kapasitas kerja bulanan." size="wide" footer={<button type="button" className="business-button business-button-primary" onClick={onClose}>Selesai</button>}>
        <div className="business-form-grid modal-settings-grid">
          <Field label="Jam kerja per hari"><NumberInput value={state.hoursPerDay} onChange={(hoursPerDay) => updateState((current) => ({ ...current, hoursPerDay }))} /></Field>
          <Field label="Hari kerja per minggu"><NumberInput value={state.daysPerWeek} onChange={(daysPerWeek) => updateState((current) => ({ ...current, daysPerWeek }))} /></Field>
          <Field label="Target margin profit (%)" className="business-field-full"><NumberInput value={state.profitMarginPercent} onChange={(profitMarginPercent) => updateState((current) => ({ ...current, profitMarginPercent }))} /></Field>
        </div>
        <EditableItemList title="Kebutuhan hidup bulanan" addLabel="Tambah Kebutuhan" onAdd={addLiving}>
          {state.livingCosts.map((item, index) => <LivingCostRow key={item.id} item={item} index={index} state={state} updateState={updateState} />)}
        </EditableItemList>
      </Modal>

      <Modal open={modal === 'production'} onClose={onClose} title="Produksi Konten" description="Waktu produksi dikalikan rate rekomendasi per jam." size="wide" footer={<button type="button" className="business-button business-button-primary" onClick={onClose}>Selesai</button>}>
        <EditableItemList title="Komponen produksi" addLabel="Tambah Komponen" onAdd={addProduction}>
          {state.productionItems.map((item, index) => <ProductionRow key={item.id} item={item} index={index} state={state} updateState={updateState} />)}
        </EditableItemList>
      </Modal>

      <Modal open={modal === 'addon'} onClose={onClose} title="Add-On & Deliverable" description="Pilih kuantitas untuk komponen tambahan yang dibutuhkan." size="wide" footer={<button type="button" className="business-button business-button-primary" onClick={onClose}>Selesai</button>}>
        <EditableItemList title="Komponen add-on" addLabel="Tambah Add-On" onAdd={addOn}>
          {state.addOns.map((item, index) => <AddOnRow key={item.id} item={item} index={index} state={state} updateState={updateState} />)}
        </EditableItemList>
      </Modal>

      <Modal open={modal === 'operational'} onClose={onClose} title="Budget Operasional" description="Biaya ini ditambahkan setelah markup dan tidak ikut dimarkup." size="wide" footer={<button type="button" className="business-button business-button-primary" onClick={onClose}>Selesai</button>}>
        <EditableItemList title="Komponen operasional" addLabel="Tambah Biaya" onAdd={addOperational}>
          {state.operationalItems.map((item, index) => <OperationalRow key={item.id} item={item} index={index} state={state} updateState={updateState} />)}
        </EditableItemList>
      </Modal>

      <Modal open={modal === 'packages'} onClose={onClose} title="Pengaturan Tiga Paket" description="Jumlah paket tetap tiga; nama dan markup dapat disesuaikan." size="medium" footer={<button type="button" className="business-button business-button-primary" onClick={onClose}>Selesai</button>}>
        <div className="package-settings-list">
          {state.packages.map((item, index) => {
            const calculation = calculateFeeCalculator(state).packages[index];
            return <article key={item.id} className="package-setting-card"><div className="business-form-grid"><Field label={`Nama paket ${index + 1}`}><input className="business-input" value={item.name} onChange={(event) => updateState((current) => ({ ...current, packages: current.packages.map((candidate) => candidate.id === item.id ? { ...candidate, name: event.target.value } : candidate) }))} /></Field><Field label="Markup fee jasa (%)"><NumberInput value={item.markupPercent} onChange={(markupPercent) => updateState((current) => ({ ...current, packages: current.packages.map((candidate) => candidate.id === item.id ? { ...candidate, markupPercent } : candidate) }))} /></Field></div><div className="package-setting-preview"><span>Preview all-in</span><strong>{formatCurrency(calculation?.allInPrice ?? 0)}</strong></div></article>;
          })}
        </div>
      </Modal>
    </>
  );
}

function EditableItemList({ title, addLabel, onAdd, children }: { title: string; addLabel: string; onAdd: () => void; children: React.ReactNode }) {
  return <div className="editable-settings-list"><div className="editable-settings-heading"><h3>{title}</h3><button type="button" className="business-button business-button-secondary" onClick={onAdd}><Plus size={16} /> {addLabel}</button></div><div>{children}</div></div>;
}

type StateUpdater = (updater: (current: FeeCalculatorState) => FeeCalculatorState) => void;

function LivingCostRow({ item, index, state, updateState }: { item: LivingCostItem; index: number; state: FeeCalculatorState; updateState: StateUpdater }) {
  return <article className="settings-item-row"><span className="settings-item-index">{index + 1}</span><div className="settings-item-fields"><Field label="Nama kebutuhan"><input className="business-input" value={item.label} onChange={(event) => updateState((current) => ({ ...current, livingCosts: current.livingCosts.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate) }))} /></Field><Field label="Keterangan"><input className="business-input" value={item.description} onChange={(event) => updateState((current) => ({ ...current, livingCosts: current.livingCosts.map((candidate) => candidate.id === item.id ? { ...candidate, description: event.target.value } : candidate) }))} /></Field><Field label="Nominal per bulan"><NumberInput value={item.amount} onChange={(amount) => updateState((current) => ({ ...current, livingCosts: current.livingCosts.map((candidate) => candidate.id === item.id ? { ...candidate, amount } : candidate) }))} /></Field></div><button type="button" className="business-icon-button business-icon-danger" onClick={() => updateState((current) => ({ ...current, livingCosts: current.livingCosts.filter((candidate) => candidate.id !== item.id) }))} aria-label={`Hapus ${item.label || `kebutuhan ${index + 1}`}`}><Trash2 size={16} /></button></article>;
}

function ProductionRow({ item, index, state, updateState }: { item: ProductionItem; index: number; state: FeeCalculatorState; updateState: StateUpdater }) {
  const rate = calculateFeeCalculator(state).recommendedHourlyRate;
  return <article className="settings-item-row"><span className="settings-item-index">{index + 1}</span><div className="settings-item-fields settings-item-fields-production"><Field label="Jenis konten"><input className="business-input" value={item.label} onChange={(event) => updateState((current) => ({ ...current, productionItems: current.productionItems.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate) }))} /></Field><Field label="Jam / item"><NumberInput value={item.hoursPerItem} onChange={(hoursPerItem) => updateState((current) => ({ ...current, productionItems: current.productionItems.map((candidate) => candidate.id === item.id ? { ...candidate, hoursPerItem } : candidate) }))} /></Field><Field label="Jumlah / bulan"><NumberInput value={item.quantity} onChange={(quantity) => updateState((current) => ({ ...current, productionItems: current.productionItems.map((candidate) => candidate.id === item.id ? { ...candidate, quantity } : candidate) }))} /></Field><div className="settings-auto-total"><span>Total otomatis</span><strong>{formatCurrency(item.hoursPerItem * item.quantity * rate)}</strong></div></div><button type="button" className="business-icon-button business-icon-danger" onClick={() => updateState((current) => ({ ...current, productionItems: current.productionItems.filter((candidate) => candidate.id !== item.id) }))} aria-label={`Hapus ${item.label}`}><Trash2 size={16} /></button></article>;
}

function AddOnRow({ item, index, state, updateState }: { item: AddOnItem; index: number; state: FeeCalculatorState; updateState: StateUpdater }) {
  return <article className="settings-item-row"><span className="settings-item-index">{index + 1}</span><div className="settings-item-fields settings-item-fields-addon"><Field label="Nama add-on"><input className="business-input" value={item.label} onChange={(event) => updateState((current) => ({ ...current, addOns: current.addOns.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate) }))} /></Field><Field label="Harga satuan"><NumberInput value={item.price} onChange={(price) => updateState((current) => ({ ...current, addOns: current.addOns.map((candidate) => candidate.id === item.id ? { ...candidate, price } : candidate) }))} /></Field><Field label="Kuantitas"><NumberInput value={item.quantity} onChange={(quantity) => updateState((current) => ({ ...current, addOns: current.addOns.map((candidate) => candidate.id === item.id ? { ...candidate, quantity } : candidate) }))} /></Field><div className="settings-auto-total"><span>Subtotal</span><strong>{formatCurrency(item.price * item.quantity)}</strong></div></div><button type="button" className="business-icon-button business-icon-danger" onClick={() => updateState((current) => ({ ...current, addOns: current.addOns.filter((candidate) => candidate.id !== item.id) }))} aria-label={`Hapus ${item.label}`}><Trash2 size={16} /></button></article>;
}

function OperationalRow({ item, index, state, updateState }: { item: OperationalItem; index: number; state: FeeCalculatorState; updateState: StateUpdater }) {
  return <article className="settings-item-row"><span className="settings-item-index">{index + 1}</span><div className="settings-item-fields"><Field label="Nama biaya"><input className="business-input" value={item.label} onChange={(event) => updateState((current) => ({ ...current, operationalItems: current.operationalItems.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate) }))} /></Field><Field label="Keterangan"><input className="business-input" value={item.description} onChange={(event) => updateState((current) => ({ ...current, operationalItems: current.operationalItems.map((candidate) => candidate.id === item.id ? { ...candidate, description: event.target.value } : candidate) }))} /></Field><Field label="Nominal"><NumberInput value={item.amount} onChange={(amount) => updateState((current) => ({ ...current, operationalItems: current.operationalItems.map((candidate) => candidate.id === item.id ? { ...candidate, amount } : candidate) }))} /></Field></div><button type="button" className="business-icon-button business-icon-danger" onClick={() => updateState((current) => ({ ...current, operationalItems: current.operationalItems.filter((candidate) => candidate.id !== item.id) }))} aria-label={`Hapus ${item.label}`}><Trash2 size={16} /></button></article>;
}
