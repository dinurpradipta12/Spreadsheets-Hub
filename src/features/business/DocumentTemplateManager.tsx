import { Edit3, Eye, EyeOff, GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createId, DEFAULT_DOCUMENT_TEMPLATES } from './defaults';
import {
  deleteDocumentTemplate,
  loadDocumentTemplates,
  saveDocumentTemplate,
} from './templateCatalog';
import {
  type BusinessToast,
  DocumentTemplateIcon,
  Modal,
} from './shared';
import type { DocumentTemplate, DocumentTemplateKind, DocumentTemplateVariant, DocumentFont } from './types';

type DocumentTemplateManagerProps = {
  onToast: BusinessToast;
};

const FONT_OPTIONS: DocumentFont[] = ['Inter/Sans', 'Arial', 'Georgia', 'Times New Roman', 'Courier New'];
const KIND_OPTIONS: Array<{ value: DocumentTemplateKind; label: string }> = [
  { value: 'both', label: 'Invoice & Penawaran' },
  { value: 'invoice', label: 'Invoice saja' },
  { value: 'quote', label: 'Penawaran saja' },
];
const VARIANT_OPTIONS: Array<{ value: DocumentTemplateVariant; label: string }> = [
  { value: 'classic', label: 'Klasik Ledger' },
  { value: 'project', label: 'Minimal Proyek' },
  { value: 'corporate', label: 'Corporate Grid' },
  { value: 'soft', label: 'Soft Editorial' },
];

function sortTemplates(templates: DocumentTemplate[]): DocumentTemplate[] {
  return templates.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function createTemplate(sortOrder: number): DocumentTemplate {
  return {
    ...DEFAULT_DOCUMENT_TEMPLATES[0],
    id: `template-${createId().slice(0, 8)}`,
    name: 'Template Baru',
    description: 'Template dokumen baru untuk workspace.',
    sortOrder,
    version: 1,
    isActive: true,
  };
}

function kindLabel(kind: DocumentTemplateKind): string {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function variantLabel(variant: DocumentTemplateVariant): string {
  return VARIANT_OPTIONS.find((option) => option.value === variant)?.label ?? variant;
}

export function DocumentTemplateManager({ onToast }: DocumentTemplateManagerProps) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadDocumentTemplates(true);
    setTemplates(sortTemplates(result.data));
    setLoading(false);
    if (result.source === 'fallback' && result.warning) {
      onToast('info', 'Katalog template belum tersedia di server. Menampilkan template bawaan.');
    }
  }, [onToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeCount = useMemo(() => templates.filter((template) => template.isActive).length, [templates]);

  const updateEditing = <K extends keyof DocumentTemplate>(key: K, value: DocumentTemplate[K]) => {
    setEditing((current) => current ? { ...current, [key]: value } : current);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      onToast('error', 'Nama template wajib diisi.');
      return;
    }
    setBusy('save');
    try {
      const saved = await saveDocumentTemplate({ ...editing, name: editing.name.trim() });
      setTemplates((current) => sortTemplates([...current.filter((template) => template.id !== saved.id), saved]));
      setEditing(null);
      onToast('success', `Template “${saved.name}” tersimpan dan disinkronkan ke semua workspace.`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : 'Template gagal disimpan.');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (template: DocumentTemplate) => {
    if (!window.confirm(`Hapus template “${template.name}”? Dokumen tersimpan tetap aman karena memakai snapshot.`)) return;
    setBusy(template.id);
    try {
      await deleteDocumentTemplate(template.id);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      onToast('success', `Template “${template.name}” dihapus dari katalog global.`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : 'Template gagal dihapus.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="dev-templates-section">
      <div className="dev-template-heading">
        <div>
          <span className="dev-template-kicker">DOCUMENT STUDIO</span>
          <h3>Katalog Template Dokumen</h3>
          <p>Pilih, atur, tambah, atau hapus tema invoice dan penawaran. Template aktif langsung tersedia di semua workspace.</p>
        </div>
        <div className="dev-template-heading-actions">
          <span className="dev-template-count">{activeCount} aktif · {templates.length} total</span>
          <button className="btn-primary" type="button" onClick={() => setEditing(createTemplate(templates.length))}>
            <Plus size={16} /> Tambah Template
          </button>
        </div>
      </div>

      {loading ? (
        <div className="dev-loading"><span className="dev-template-loading-line" /><span className="dev-template-loading-line" /><span className="dev-template-loading-line" /></div>
      ) : templates.length === 0 ? (
        <div className="dev-empty"><p>Belum ada template. Tambahkan template pertama untuk mulai.</p></div>
      ) : (
        <div className="dev-template-grid">
          {templates.map((template) => (
            <article className="dev-template-card" key={template.id}>
              <div className="dev-template-card-head">
                <span className="dev-template-drag" title={`Urutan ${template.sortOrder + 1}`}><GripVertical size={15} /></span>
                <span className="dev-template-icon" style={{ color: template.accentColor }}><DocumentTemplateIcon name={template.icon} size={21} /></span>
                <div className="dev-template-card-title">
                  <strong>{template.name}</strong>
                  <small>{kindLabel(template.kind)} · {variantLabel(template.variant)}</small>
                </div>
                <span className={template.isActive ? 'dev-template-status is-active' : 'dev-template-status'}>
                  {template.isActive ? <><Eye size={12} /> Aktif</> : <><EyeOff size={12} /> Disembunyikan</>}
                </span>
              </div>
              <p className="dev-template-card-description">{template.description || 'Tanpa deskripsi.'}</p>
              <div className="dev-template-swatches" aria-label="Warna template">
                {[template.accentColor, template.backgroundColor, template.surfaceColor, template.borderColor].map((color) => <span key={color} style={{ backgroundColor: color }} title={color} />)}
                <small>v{template.version}</small>
              </div>
              <div className="dev-template-card-actions">
                <button className="dev-btn dev-btn-copy" type="button" onClick={() => setEditing({ ...template })}><Edit3 size={14} /> Atur</button>
                <button className="dev-btn dev-btn-delete" type="button" onClick={() => void handleDelete(template)} disabled={busy === template.id}><Trash2 size={14} /> Hapus</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        title={editing?.id.startsWith('template-') ? 'Tambah Template' : 'Atur Template'}
        description="Perubahan disimpan sebagai katalog global. Dokumen lama tetap memakai tampilan saat terakhir disimpan."
        size="wide"
        onClose={() => { if (!busy) setEditing(null); }}
        footer={(
          <>
            <button className="business-button business-button-secondary" type="button" onClick={() => setEditing(null)} disabled={Boolean(busy)}>Batal</button>
            <button className="business-button business-button-primary" type="button" onClick={() => void handleSave()} disabled={busy === 'save'}>
              <Save size={16} /> {busy === 'save' ? 'Menyimpan...' : 'Simpan & Sinkronkan'}
            </button>
          </>
        )}
      >
        {editing && (
          <div className="dev-template-form">
            <div className="dev-template-form-grid">
              <label className="form-group"><span className="form-label">Nama template</span><input className="form-input" value={editing.name} onChange={(event) => updateEditing('name', event.target.value)} /></label>
              <label className="form-group"><span className="form-label">Icon Lucide</span><input className="form-input" value={editing.icon} onChange={(event) => updateEditing('icon', event.target.value)} placeholder="file-text" /></label>
              <label className="form-group"><span className="form-label">Dipakai untuk</span><select className="form-input" value={editing.kind} onChange={(event) => updateEditing('kind', event.target.value as DocumentTemplateKind)}>{KIND_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
              <label className="form-group"><span className="form-label">Gaya layout</span><select className="form-input" value={editing.variant} onChange={(event) => updateEditing('variant', event.target.value as DocumentTemplateVariant)}>{VARIANT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
              <label className="form-group"><span className="form-label">Font</span><select className="form-input" value={editing.font} onChange={(event) => updateEditing('font', event.target.value as DocumentFont)}>{FONT_OPTIONS.map((font) => <option value={font} key={font}>{font}</option>)}</select></label>
              <label className="form-group"><span className="form-label">Urutan</span><input className="form-input" type="number" min="0" step="1" value={editing.sortOrder} onChange={(event) => updateEditing('sortOrder', Math.max(0, Number(event.target.value) || 0))} /></label>
              <label className="form-group dev-template-form-full"><span className="form-label">Deskripsi</span><textarea className="form-input dev-template-description-input" rows={3} value={editing.description} onChange={(event) => updateEditing('description', event.target.value)} /></label>
            </div>
            <div className="dev-template-color-grid">
              {([
                ['accentColor', 'Accent / garis utama'],
                ['backgroundColor', 'Latar halaman'],
                ['textColor', 'Warna teks'],
                ['surfaceColor', 'Permukaan blok'],
                ['borderColor', 'Garis/border'],
                ['mutedColor', 'Teks sekunder'],
              ] as Array<[keyof DocumentTemplate, string]>).map(([key, label]) => (
                <label className="dev-template-color-field" key={key}>
                  <span>{label}</span>
                  <input type="color" value={String(editing[key])} onChange={(event) => updateEditing(key, event.target.value as never)} />
                  <code>{String(editing[key])}</code>
                </label>
              ))}
            </div>
            <label className="dev-template-active-toggle"><input type="checkbox" checked={editing.isActive} onChange={(event) => updateEditing('isActive', event.target.checked)} /><span>Tampilkan di pilihan user</span></label>
          </div>
        )}
      </Modal>
    </section>
  );
}
