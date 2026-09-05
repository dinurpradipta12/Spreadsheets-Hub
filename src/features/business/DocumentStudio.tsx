import {
  ArrowRight,
  Download,
  FilePlus2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Workspace } from '../../types';
import {
  BusinessApiError,
  clearRecoveryDraft,
  consumeFeeQuoteDraft,
  deleteDocument,
  getBusinessAccess,
  loadDocumentById,
  loadDocuments,
  loadFeeQuoteDraft,
  loadRecoveryDraft,
  saveDocument,
  saveRecoveryDraft,
} from './api';
import { calculateDocument, formatCurrency } from './calculations';
import { createDocument, createId, generateDocumentNumber } from './defaults';
import { DocumentA4Preview } from './DocumentPreview';
import { exportDocumentPdf } from './pdf';
import {
  type BusinessToast,
  ConfirmationDialog,
  EditorAccordion,
  Field,
  ImageUploader,
  LineItemEditor,
  LoadingButton,
  NumberInput,
  RefreshNumberButton,
  cx,
} from './shared';
import type {
  BusinessDocument,
  DocumentKind,
  DocumentStatus,
  FeeQuoteDraft,
  PersistenceSource,
  StoredDocument,
} from './types';
import { createInvoiceFromAcceptedQuote, createQuoteFromFeeDraft } from './workflows';

type StudioProps = {
  kind: DocumentKind;
  workspace: Workspace;
  toast: BusinessToast;
  onNavigate: (path: string) => void;
};

const STATUS_OPTIONS: Record<DocumentKind, Array<{ value: DocumentStatus; label: string }>> = {
  invoice: [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Terkirim' },
    { value: 'paid', label: 'Lunas' },
    { value: 'void', label: 'Dibatalkan' },
  ],
  quote: [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Terkirim' },
    { value: 'accepted', label: 'Diterima' },
    { value: 'rejected', label: 'Ditolak' },
  ],
};

const FONT_OPTIONS: BusinessDocument['appearance']['font'][] = [
  'Inter/Sans',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
];

function clientLabel(document: BusinessDocument): string {
  return document.recipient.companyName || document.recipient.contactName || 'Penerima belum diisi';
}

function historySignature(rows: StoredDocument[]): string {
  return rows.map((row) => `${row.id}:${row.updated_at}:${row.status}`).join('|');
}

function removeTransientQuery(): void {
  const url = new URL(window.location.href);
  ['source', 'draft_id', 'quote_id', 'prefill'].forEach((key) => url.searchParams.delete(key));
  url.pathname = url.pathname.startsWith('/invoices') ? '/invoices' : '/quotes';
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function DocumentStudio({ kind, workspace, toast, onNavigate }: StudioProps) {
  const [document, setDocument] = useState<BusinessDocument>(() => createDocument(kind, workspace.owner_name));
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<PersistenceSource>('recovery');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [remotePending, setRemotePending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StoredDocument | null>(null);
  const [newConfirmation, setNewConfirmation] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<StoredDocument | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['identity', 'items']));
  const [ready, setReady] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const historySignatureRef = useRef('');
  const importHandledRef = useRef(false);

  const isInvoice = kind === 'invoice';
  const totals = useMemo(() => calculateDocument(document), [document]);

  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const loadHistory = useCallback(async (selectLatest = false) => {
    setLoading(true);
    const result = await loadDocuments(workspace.id, workspace.owner_name, kind);
    historySignatureRef.current = historySignature(result.data);
    setDocuments(result.data);
    setSource(result.source);
    setWarning(result.warning ?? '');
    if (selectLatest && result.data.length > 0) {
      setSelectedId(result.data[0].id);
      setDocument(result.data[0].data);
      setDirty(false);
    }
    setLoading(false);
    setReady(true);
  }, [kind, workspace.id, workspace.owner_name]);

  const refreshRemote = useCallback(async () => {
    const result = await loadDocuments(workspace.id, workspace.owner_name, kind);
    if (result.source !== 'server') return;
    const nextSignature = historySignature(result.data);
    if (nextSignature === historySignatureRef.current) return;
    historySignatureRef.current = nextSignature;
    setDocuments(result.data);
    setSource('server');
    setWarning('');

    if (dirtyRef.current) {
      setRemotePending(true);
      return;
    }

    const activeDocument = result.data.find((row) => row.id === selectedIdRef.current);
    if (activeDocument) {
      setDocument(activeDocument.data);
    } else if (selectedIdRef.current) {
      setSelectedId(null);
      setDocument(createDocument(kind, workspace.owner_name));
    }
    setRemotePending(false);
  }, [kind, workspace.id, workspace.owner_name]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await loadDocuments(workspace.id, workspace.owner_name, kind);
      if (cancelled) return;
      historySignatureRef.current = historySignature(result.data);
      setDocuments(result.data);
      setSource(result.source);
      setWarning(result.warning ?? '');
      const recovery = loadRecoveryDraft(workspace.id, kind);
      if (recovery) {
        setDocument(recovery);
        setSelectedId(result.data.some((item) => item.id === recovery.id) ? recovery.id : null);
        setDirty(true);
      }
      setLoading(false);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [kind, workspace.id, workspace.owner_name]);

  useEffect(() => {
    if (!ready || importHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const sourceParam = params.get('source');
    const draftId = params.get('draft_id');
    const quoteId = params.get('quote_id');

    if (kind === 'quote' && sourceParam === 'fee-calculator' && draftId) {
      importHandledRef.current = true;
      (async () => {
        const result = await loadFeeQuoteDraft(workspace.id, draftId);
        if (!result.data || result.data.source !== 'fee-calculator') {
          toast('error', 'Draft Fee Calculator tidak ditemukan atau sudah kedaluwarsa.');
          removeTransientQuery();
          return;
        }
        setDocument((current) => createQuoteFromFeeDraft(result.data!, workspace.owner_name, current));
        setSelectedId(null);
        setDirty(true);
        setSource(result.source);
        setWarning(result.warning ?? '');
        consumeFeeQuoteDraft(workspace.id, draftId);
        removeTransientQuery();
        toast('success', 'Draft Fee Calculator berhasil dimasukkan ke Penawaran Harga.');
      })();
      return;
    }

    if (kind === 'quote' && params.get('prefill') === 'fee-calculator') {
      importHandledRef.current = true;
      const raw = sessionStorage.getItem('fee-calculator-prefill');
      sessionStorage.removeItem('fee-calculator-prefill');
      removeTransientQuery();
      if (!raw) return;
      try {
        const legacy = JSON.parse(raw) as FeeQuoteDraft;
        setDocument((current) => createQuoteFromFeeDraft(legacy, workspace.owner_name, current));
        setDirty(true);
        toast('success', 'Draft Fee Calculator berhasil dimasukkan.');
      } catch {
        toast('error', 'Payload Fee Calculator tidak valid.');
      }
      return;
    }

    if (kind === 'invoice' && sourceParam === 'quote' && quoteId) {
      importHandledRef.current = true;
      (async () => {
        const result = await loadDocumentById(workspace.id, workspace.owner_name, 'quote', quoteId);
        const quote = result.data?.data;
        removeTransientQuery();
        if (!quote) {
          toast('error', 'Penawaran sumber tidak ditemukan.');
          return;
        }
        if (quote.status !== 'accepted') {
          toast('error', 'Invoice hanya dapat dibuat dari penawaran berstatus Diterima.');
          return;
        }
        const invoice = createInvoiceFromAcceptedQuote(quote, workspace.owner_name);
        setDocument(invoice);
        setSelectedId(null);
        setDirty(true);
        setSource(result.source);
        setWarning(result.warning ?? '');
        toast('success', 'Snapshot penawaran disalin ke Invoice. Harga tidak akan mengikuti perubahan katalog.');
      })();
    }
  }, [kind, ready, toast, workspace.id, workspace.owner_name]);

  useEffect(() => {
    if (!dirty) return undefined;
    const timer = window.setTimeout(() => saveRecoveryDraft(workspace.id, document), 650);
    return () => window.clearTimeout(timer);
  }, [dirty, document, workspace.id]);

  useEffect(() => {
    const table = kind === 'invoice' ? 'app_invoices' : 'app_quotes';
    const channel = supabase
      .channel(`business-documents-${kind}-${workspace.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table,
        filter: `workspace_id=eq.${workspace.id}`,
      }, () => {
        void refreshRemote();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [kind, refreshRemote, workspace.id]);

  // Custom workspace sessions are not Supabase Auth JWTs, so Postgres Changes
  // cannot safely authorize them through RLS. Poll the same scoped server API as
  // a fallback while retaining Realtime for Supabase Auth workspace members.
  useEffect(() => {
    if (!getBusinessAccess(workspace.id)?.token) return undefined;
    const interval = window.setInterval(() => { void refreshRemote(); }, 15_000);
    const handleVisibility = () => {
      if (window.document.visibilityState === 'visible') void refreshRemote();
    };
    window.document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshRemote, workspace.id]);

  const updateDocument = useCallback((updater: (current: BusinessDocument) => BusinessDocument) => {
    setDocument((current) => updater(current));
    setDirty(true);
    setErrors({});
  }, []);

  const toggleSection = (section: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const uniqueNumber = useCallback(() => {
    let next = generateDocumentNumber(kind, document.business.name || workspace.owner_name, document.issueDate);
    let attempts = 0;
    while (documents.some((row) => row.document_number === next && row.id !== document.id) && attempts < 24) {
      next = generateDocumentNumber(kind, document.business.name || workspace.owner_name, document.issueDate);
      attempts += 1;
    }
    updateDocument((current) => ({ ...current, number: next }));
  }, [document.business.name, document.id, document.issueDate, documents, kind, updateDocument, workspace.owner_name]);

  const resetToNew = useCallback(() => {
    clearRecoveryDraft(workspace.id, kind);
    setDocument(createDocument(kind, workspace.owner_name));
    setSelectedId(null);
    setDirty(false);
    setRemotePending(false);
    setErrors({});
    setNewConfirmation(false);
  }, [kind, workspace.id, workspace.owner_name]);

  const requestNew = () => {
    if (dirty) setNewConfirmation(true);
    else resetToNew();
  };

  const openStored = (row: StoredDocument) => {
    if (dirty && row.id !== selectedId) {
      setSwitchTarget(row);
      return;
    }
    setDocument(row.data);
    setSelectedId(row.id);
    setDirty(false);
    setRemotePending(false);
    setErrors({});
  };

  const confirmSwitch = () => {
    if (!switchTarget) return;
    clearRecoveryDraft(workspace.id, kind);
    setDocument(switchTarget.data);
    setSelectedId(switchTarget.id);
    setDirty(false);
    setRemotePending(false);
    setSwitchTarget(null);
    setErrors({});
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!document.number.trim()) nextErrors.number = 'Nomor dokumen wajib diisi.';
    if (!document.title.trim()) nextErrors.title = 'Judul dokumen wajib diisi.';
    if (!document.business.name.trim()) nextErrors.businessName = 'Nama bisnis wajib diisi.';
    if (!document.recipient.companyName.trim() && !document.recipient.contactName.trim()) {
      nextErrors.recipient = 'Isi nama klien/perusahaan atau nama penerima.';
    }
    if (document.items.some((item) => !item.description.trim())) nextErrors.items = 'Setiap item perlu memiliki deskripsi.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setOpenSections((current) => new Set([...current, 'identity', 'branding', 'items']));
      toast('error', 'Periksa field yang masih kosong.');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (savingRef.current || !validate()) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await saveDocument(workspace.id, document);
      setSource(result.source);
      setWarning(result.warning ?? '');
      setSelectedId(result.data.id);
      setDocument(result.data.data);
      setDocuments((current) => {
        const next = [result.data, ...current.filter((item) => item.id !== result.data.id)]
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        historySignatureRef.current = historySignature(next);
        return next;
      });
      clearRecoveryDraft(workspace.id, kind);
      setDirty(false);
      setRemotePending(false);
      toast(
        result.source === 'server' ? 'success' : 'info',
        result.source === 'server'
          ? `${isInvoice ? 'Invoice' : 'Penawaran'} tersimpan di workspace.`
          : 'Server belum tersedia. Dokumen baru tersimpan sebagai recovery di perangkat ini.',
      );
    } catch (error) {
      if (error instanceof BusinessApiError && error.code === 'number_conflict') {
        uniqueNumber();
        toast('error', 'Nomor sudah digunakan. Nomor baru dibuat; periksa lalu simpan kembali.');
      } else {
        toast('error', error instanceof Error ? error.message : 'Gagal menyimpan dokumen.');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteDocument(workspace.id, kind, deleteTarget.id);
    setDocuments((current) => {
      const next = current.filter((item) => item.id !== deleteTarget.id);
      historySignatureRef.current = historySignature(next);
      return next;
    });
    if (selectedId === deleteTarget.id) resetToNew();
    setSource(result.source);
    setWarning(result.warning ?? '');
    setDeleteTarget(null);
    setDeleting(false);
    toast(
      result.source === 'server' ? 'success' : 'info',
      result.source === 'server' ? 'Dokumen berhasil dihapus.' : 'Dokumen dihapus dari recovery perangkat.',
    );
  };

  const handleExport = async () => {
    if (!previewRef.current || exporting) return;
    setExporting(true);
    try {
      await exportDocumentPdf(previewRef.current, document.number);
      toast('success', 'PDF HD berhasil dibuat.');
    } catch (error) {
      toast('error', `${error instanceof Error ? error.message : 'Export gagal.'} Membuka dialog print sebagai fallback.`);
      window.print();
    } finally {
      setExporting(false);
    }
  };

  const createInvoiceFromQuote = () => {
    if (kind !== 'quote') return;
    if (document.status !== 'accepted') {
      toast('error', 'Ubah status penawaran menjadi Diterima sebelum membuat invoice.');
      return;
    }
    if (dirty || !selectedId) {
      toast('error', 'Simpan penawaran terlebih dahulu agar snapshot dan relasinya tercatat.');
      return;
    }
    onNavigate(`/invoices/new?source=quote&quote_id=${encodeURIComponent(document.id)}`);
  };

  const updateAdditionalPage = (id: string, patch: Partial<BusinessDocument['additionalPages'][number]>) => {
    updateDocument((current) => ({
      ...current,
      additionalPages: current.additionalPages.map((page) => page.id === id ? { ...page, ...patch } : page),
    }));
  };

  return (
    <div className="business-page document-studio-page">
      <div className="business-page-toolbar" aria-label={isInvoice ? 'Aksi Invoice' : 'Aksi Penawaran Harga'}>
        {kind === 'quote' && document.status === 'accepted' && (
          <button type="button" className="business-button business-button-secondary" onClick={createInvoiceFromQuote}>
            Buat Invoice <ArrowRight size={17} />
          </button>
        )}
        <button type="button" className="business-button business-button-secondary" onClick={requestNew} disabled={saving || exporting}>
          <FilePlus2 size={17} /> {isInvoice ? 'Invoice Baru' : 'Penawaran Baru'}
        </button>
        <LoadingButton className="business-button-primary" busy={saving} busyLabel="Menyimpan..." onClick={() => void handleSave()} disabled={exporting}>
          <Save size={17} /> {isInvoice ? 'Simpan Invoice' : 'Simpan Penawaran'}
        </LoadingButton>
        <LoadingButton className="business-button-accent" busy={exporting} busyLabel="Membuat PDF..." onClick={() => void handleExport()} disabled={saving}>
          <Download size={17} /> Export PDF HD
        </LoadingButton>
      </div>

      {(warning || remotePending || dirty) && (
        <div className={cx('studio-status-strip', warning && 'has-warning')} role="status">
          <div>
            {dirty && <span className="unsaved-dot" aria-hidden="true" />}
            <strong>{dirty ? 'Ada perubahan yang belum disimpan.' : remotePending ? 'Ada perubahan baru dari workspace.' : 'Mode recovery perangkat aktif.'}</strong>
            {warning && <small>{warning} Data lintas perangkat belum dapat dijamin sampai API aktif.</small>}
          </div>
          {warning && (
            <button
              type="button"
              className="business-button business-button-ghost"
              onClick={() => void (selectedId ? handleSave() : loadHistory(false))}
            >
              <RefreshCw size={16} /> Retry
            </button>
          )}
        </div>
      )}

      <section className="document-history" aria-label={`Riwayat ${isInvoice ? 'invoice' : 'penawaran'}`}>
        <div className="document-history-label"><span>Riwayat dokumen</span><small>Terbaru di depan</small></div>
        <div className="document-history-scroll" role="tablist">
          <button
            type="button"
            className={cx('document-history-new', !selectedId && 'is-active')}
            role="tab"
            aria-selected={!selectedId}
            onClick={requestNew}
          >
            <Plus size={16} /> Draft Baru
          </button>
          {loading ? (
            <div className="document-history-loading"><LoaderCircle className="spin" size={18} /> Memuat riwayat...</div>
          ) : documents.length === 0 ? (
            <p className="document-history-empty">Belum ada {isInvoice ? 'invoice' : 'penawaran'} tersimpan.</p>
          ) : documents.map((row) => (
            <div className={cx('document-history-tab', selectedId === row.id && 'is-active')} key={row.id} role="presentation">
              <button type="button" role="tab" aria-selected={selectedId === row.id} onClick={() => openStored(row)}>
                <span><strong>{row.document_number}</strong><small>{clientLabel(row.data)}</small></span>
                <span className={cx('document-status-badge', `status-${row.status}`)}>{row.status}</span>
              </button>
              <button type="button" className="document-history-delete" onClick={() => setDeleteTarget(row)} aria-label={`Hapus ${row.document_number}`} title="Hapus dokumen">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="document-studio-grid">
        <aside className="document-editor-panel" aria-label={`Editor ${isInvoice ? 'invoice' : 'penawaran'}`}>
          <div className="document-editor-summary">
            <div><span>Total dokumen</span><strong>{formatCurrency(totals.grandTotal, document.currency)}</strong></div>
            <div><span>{document.items.length} item</span><span>{document.currency}</span></div>
          </div>

          <EditorAccordion title={isInvoice ? 'Identitas Invoice' : 'Identitas Penawaran'} open={openSections.has('identity')} onToggle={() => toggleSection('identity')}>
            <div className="business-form-grid">
              <Field label={isInvoice ? 'Nomor invoice' : 'Nomor penawaran'} error={errors.number} className="business-field-full">
                <div className="business-input-with-action">
                  <input className="business-input" value={document.number} onChange={(event) => updateDocument((current) => ({ ...current, number: event.target.value }))} />
                  <RefreshNumberButton onClick={uniqueNumber} />
                </div>
              </Field>
              <Field label="Judul dokumen" error={errors.title} className="business-field-full">
                <input className="business-input" value={document.title} onChange={(event) => updateDocument((current) => ({ ...current, title: event.target.value }))} />
              </Field>
              <Field label={isInvoice ? 'Tanggal invoice' : 'Tanggal penawaran'}>
                <input className="business-input" type="date" value={document.issueDate} onChange={(event) => updateDocument((current) => ({ ...current, issueDate: event.target.value }))} />
              </Field>
              <Field label={isInvoice ? 'Tanggal jatuh tempo' : 'Berlaku sampai'}>
                <input className="business-input" type="date" value={document.dueDate} onChange={(event) => updateDocument((current) => ({ ...current, dueDate: event.target.value }))} />
              </Field>
              <Field label="Mata uang">
                <select className="business-select" value={document.currency} onChange={(event) => updateDocument((current) => ({ ...current, currency: event.target.value as BusinessDocument['currency'] }))}>
                  <option value="IDR">IDR · Rupiah</option><option value="USD">USD · US Dollar</option><option value="SGD">SGD · Singapore Dollar</option><option value="MYR">MYR · Malaysian Ringgit</option>
                </select>
              </Field>
              <Field label="Status">
                <select className="business-select" value={document.status} onChange={(event) => updateDocument((current) => ({ ...current, status: event.target.value as DocumentStatus }))}>
                  {STATUS_OPTIONS[kind].map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </Field>
            </div>
          </EditorAccordion>

          {kind === 'quote' && (
            <EditorAccordion title="Halaman Tambahan Sebelum Tabel" description="Satu bagian menjadi satu halaman A4" badge={`${document.additionalPages.length}`} open={openSections.has('additional')} onToggle={() => toggleSection('additional')}>
              <div className="additional-page-list">
                {document.additionalPages.map((page, index) => (
                  <article className="additional-page-card" key={page.id}>
                    <div className="line-item-card-head">
                      <span>Halaman tambahan {index + 1}</span>
                      <button type="button" className="business-icon-button business-icon-danger" onClick={() => updateDocument((current) => ({ ...current, additionalPages: current.additionalPages.filter((item) => item.id !== page.id).map((item, pageIndex) => ({ ...item, sortOrder: pageIndex + 1 })) }))} aria-label={`Hapus halaman tambahan ${index + 1}`}><Trash2 size={16} /></button>
                    </div>
                    <Field label="Judul halaman"><input className="business-input" value={page.title} onChange={(event) => updateAdditionalPage(page.id, { title: event.target.value })} /></Field>
                    <Field label="Isi multiline"><textarea className="business-textarea" rows={7} value={page.content} onChange={(event) => updateAdditionalPage(page.id, { content: event.target.value })} /></Field>
                    <Field label="Nomor urutan"><NumberInput value={page.sortOrder} step="1" onChange={(sortOrder) => updateAdditionalPage(page.id, { sortOrder })} /></Field>
                  </article>
                ))}
                <button type="button" className="business-button business-button-secondary business-button-full" onClick={() => updateDocument((current) => ({ ...current, additionalPages: [...current.additionalPages, { id: createId(), title: '', content: '', sortOrder: current.additionalPages.length + 1 }] }))}>
                  <Plus size={17} /> Tambah Halaman
                </button>
              </div>
            </EditorAccordion>
          )}

          <EditorAccordion title="Tampilan" description="Warna dokumen tetap sama di dark mode" open={openSections.has('appearance')} onToggle={() => toggleSection('appearance')}>
            <div className="business-form-grid">
              <Field label="Font" className="business-field-full">
                <select className="business-select" value={document.appearance.font} onChange={(event) => updateDocument((current) => ({ ...current, appearance: { ...current.appearance, font: event.target.value as BusinessDocument['appearance']['font'] } }))}>
                  {FONT_OPTIONS.map((font) => <option key={font}>{font}</option>)}
                </select>
              </Field>
              <Field label="Background color"><input className="business-color-input" type="color" value={document.appearance.backgroundColor} onChange={(event) => updateDocument((current) => ({ ...current, appearance: { ...current.appearance, backgroundColor: event.target.value } }))} /></Field>
              <Field label="Accent color"><input className="business-color-input" type="color" value={document.appearance.accentColor} onChange={(event) => updateDocument((current) => ({ ...current, appearance: { ...current.appearance, accentColor: event.target.value } }))} /></Field>
              <Field label="Text color"><input className="business-color-input" type="color" value={document.appearance.textColor} onChange={(event) => updateDocument((current) => ({ ...current, appearance: { ...current.appearance, textColor: event.target.value } }))} /></Field>
              <div className="business-field-full">
                <ImageUploader label="Background image" value={document.appearance.backgroundImageUrl} path={document.appearance.backgroundImagePath} imageKind="background" documentKind={kind} workspaceId={workspace.id} toast={toast} onChange={({ url, path }) => updateDocument((current) => ({ ...current, appearance: { ...current.appearance, backgroundImageUrl: url, backgroundImagePath: path } }))} />
              </div>
            </div>
          </EditorAccordion>

          <EditorAccordion title="Branding & Pihak" open={openSections.has('branding')} onToggle={() => toggleSection('branding')}>
            <div className="business-section-title">Pihak penerbit</div>
            <ImageUploader label="Logo" value={document.business.logoUrl} path={document.business.logoPath} imageKind="logo" documentKind={kind} workspaceId={workspace.id} toast={toast} onChange={({ url, path }) => updateDocument((current) => ({ ...current, business: { ...current.business, logoUrl: url, logoPath: path } }))} />
            <div className="business-form-grid business-form-spaced">
              <Field label="Nama bisnis" error={errors.businessName} className="business-field-full"><input className="business-input" value={document.business.name} onChange={(event) => updateDocument((current) => ({ ...current, business: { ...current.business, name: event.target.value } }))} /></Field>
              <Field label="Alamat bisnis" className="business-field-full"><textarea className="business-textarea" rows={3} value={document.business.address} onChange={(event) => updateDocument((current) => ({ ...current, business: { ...current.business, address: event.target.value } }))} /></Field>
              <Field label="Email bisnis"><input className="business-input" type="email" value={document.business.email} onChange={(event) => updateDocument((current) => ({ ...current, business: { ...current.business, email: event.target.value } }))} /></Field>
              <Field label="Telepon bisnis"><input className="business-input" type="tel" value={document.business.phone} onChange={(event) => updateDocument((current) => ({ ...current, business: { ...current.business, phone: event.target.value } }))} /></Field>
            </div>
            <div className="business-section-title">{isInvoice ? 'Pihak klien' : 'Pihak penerima'}</div>
            {errors.recipient && <p className="business-field-message business-section-error">{errors.recipient}</p>}
            <div className="business-form-grid">
              <Field label={isInvoice ? 'Nama klien/perusahaan' : 'Nama perusahaan penerima'} className="business-field-full"><input className="business-input" value={document.recipient.companyName} onChange={(event) => updateDocument((current) => ({ ...current, recipient: { ...current.recipient, companyName: event.target.value } }))} /></Field>
              {kind === 'quote' && <Field label="Nama penerima/PIC" className="business-field-full"><input className="business-input" value={document.recipient.contactName} onChange={(event) => updateDocument((current) => ({ ...current, recipient: { ...current.recipient, contactName: event.target.value } }))} /></Field>}
              <Field label="Alamat" className="business-field-full"><textarea className="business-textarea" rows={3} value={document.recipient.address} onChange={(event) => updateDocument((current) => ({ ...current, recipient: { ...current.recipient, address: event.target.value } }))} /></Field>
              <Field label="Email"><input className="business-input" type="email" value={document.recipient.email} onChange={(event) => updateDocument((current) => ({ ...current, recipient: { ...current.recipient, email: event.target.value } }))} /></Field>
              {kind === 'quote' && <Field label="Telepon/WhatsApp"><input className="business-input" type="tel" value={document.recipient.phone} onChange={(event) => updateDocument((current) => ({ ...current, recipient: { ...current.recipient, phone: event.target.value } }))} /></Field>}
            </div>
          </EditorAccordion>

          <EditorAccordion title="Item & Harga" badge={`${document.items.length}`} open={openSections.has('items')} onToggle={() => toggleSection('items')}>
            {errors.items && <p className="business-field-message business-section-error">{errors.items}</p>}
            <LineItemEditor items={document.items} currency={document.currency} onChange={(items) => updateDocument((current) => ({ ...current, items }))} />
            <div className="business-form-grid business-form-spaced">
              <Field label="Diskon (%)"><NumberInput value={document.discountPercent} onChange={(discountPercent) => updateDocument((current) => ({ ...current, discountPercent }))} /></Field>
              <Field label="Pajak (%)"><NumberInput value={document.taxPercent} onChange={(taxPercent) => updateDocument((current) => ({ ...current, taxPercent }))} /></Field>
            </div>
            <div className="editor-total-breakdown">
              <div><span>Subtotal</span><strong>{formatCurrency(totals.subtotal, document.currency)}</strong></div>
              {document.discountPercent > 0 && <div><span>Diskon</span><strong>-{formatCurrency(totals.discountAmount, document.currency)}</strong></div>}
              {document.taxPercent > 0 && <div><span>Pajak</span><strong>{formatCurrency(totals.taxAmount, document.currency)}</strong></div>}
              <div><span>Total</span><strong>{formatCurrency(totals.grandTotal, document.currency)}</strong></div>
            </div>
          </EditorAccordion>

          <EditorAccordion title={isInvoice ? 'Pembayaran & Catatan' : 'Ketentuan & Pembayaran'} open={openSections.has('payment')} onToggle={() => toggleSection('payment')}>
            <div className="business-form-grid">
              {kind === 'quote' && <Field label="Pengantar dokumen" className="business-field-full"><textarea className="business-textarea" rows={4} value={document.introduction} onChange={(event) => updateDocument((current) => ({ ...current, introduction: event.target.value }))} /></Field>}
              <Field label={isInvoice ? 'Catatan invoice' : 'Keterangan penawaran'} className="business-field-full"><textarea className="business-textarea" rows={4} value={document.notes} onChange={(event) => updateDocument((current) => ({ ...current, notes: event.target.value }))} /></Field>
              {kind === 'quote' && <Field label="Syarat dan ketentuan" className="business-field-full"><textarea className="business-textarea" rows={5} value={document.terms} onChange={(event) => updateDocument((current) => ({ ...current, terms: event.target.value }))} /></Field>}
              <Field label="Judul pembayaran" className="business-field-full"><input className="business-input" value={document.payment.title} onChange={(event) => updateDocument((current) => ({ ...current, payment: { ...current.payment, title: event.target.value } }))} /></Field>
              <Field label="Nama bank"><input className="business-input" value={document.payment.bankName} onChange={(event) => updateDocument((current) => ({ ...current, payment: { ...current.payment, bankName: event.target.value } }))} /></Field>
              <Field label={isInvoice ? 'Nama pemilik rekening' : 'Nama rekening'}><input className="business-input" value={document.payment.accountName} onChange={(event) => updateDocument((current) => ({ ...current, payment: { ...current.payment, accountName: event.target.value } }))} /></Field>
              <Field label="Nomor rekening" className="business-field-full"><input className="business-input" inputMode="numeric" value={document.payment.accountNumber} onChange={(event) => updateDocument((current) => ({ ...current, payment: { ...current.payment, accountNumber: event.target.value } }))} /></Field>
              <Field label="Instruksi pembayaran" className="business-field-full"><textarea className="business-textarea" rows={3} value={document.payment.instructions} onChange={(event) => updateDocument((current) => ({ ...current, payment: { ...current.payment, instructions: event.target.value } }))} /></Field>
              <Field label="Footer dokumen" className="business-field-full"><input className="business-input" value={document.footer} onChange={(event) => updateDocument((current) => ({ ...current, footer: event.target.value }))} /></Field>
            </div>
          </EditorAccordion>
        </aside>

        <main className="document-preview-column">
          <DocumentA4Preview document={document} containerRef={previewRef} />
        </main>
      </div>

      <ConfirmationDialog open={Boolean(deleteTarget)} title={`Hapus ${isInvoice ? 'invoice' : 'penawaran'}?`} message={deleteTarget ? `${deleteTarget.document_number} akan dihapus dari workspace. Tindakan ini tidak dapat dibatalkan.` : ''} confirmLabel="Hapus Dokumen" busy={deleting} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} />
      <ConfirmationDialog open={newConfirmation} title="Mulai dokumen baru?" message="Perubahan yang belum disimpan tetap tersedia sebagai recovery perangkat, tetapi editor akan direset." confirmLabel="Mulai Baru" danger={false} onConfirm={resetToNew} onClose={() => setNewConfirmation(false)} />
      <ConfirmationDialog open={Boolean(switchTarget)} title="Buka dokumen lain?" message="Perubahan editor yang belum disimpan akan ditinggalkan. Draft recovery saat ini akan dibersihkan." confirmLabel="Buka Dokumen" danger={false} onConfirm={confirmSwitch} onClose={() => setSwitchTarget(null)} />
    </div>
  );
}
