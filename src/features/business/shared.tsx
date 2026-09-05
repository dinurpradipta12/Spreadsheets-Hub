import {
  Calculator,
  ChevronDown,
  FileText,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  Moon,
  Plus,
  ReceiptText,
  RefreshCw,
  Sun,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { DocumentKind, LineItem } from './types';
import { formatCurrency, nonNegative } from './calculations';
import { createId } from './defaults';
import { compressImage } from './media';
import { uploadBusinessImage } from './api';

export type BusinessToast = (type: 'success' | 'error' | 'info', message: string) => void;

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  size = 'large',
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: 'small' | 'medium' | 'large' | 'wide';
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      first?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="business-modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className={cx('business-modal', `business-modal-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="business-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="business-icon-button" onClick={onClose} aria-label={`Tutup ${title}`}>
            <X size={18} />
          </button>
        </div>
        <div className="business-modal-body">{children}</div>
        {footer && <div className="business-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  danger = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={message}
      size="small"
      onClose={() => { if (!busy) onClose(); }}
      footer={(
        <>
          <button className="business-button business-button-secondary" type="button" onClick={onClose} disabled={busy}>Batal</button>
          <button
            className={cx('business-button', danger ? 'business-button-danger' : 'business-button-primary')}
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy && <LoaderCircle className="spin" size={17} />}
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="confirmation-visual" aria-hidden="true"><Trash2 size={24} /></div>
    </Modal>
  );
}

export function EditorAccordion({
  title,
  description,
  open,
  onToggle,
  children,
  badge,
}: {
  title: string;
  description?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: string;
}) {
  const contentId = useId();
  return (
    <section className={cx('editor-accordion', open && 'editor-accordion-open')}>
      <button
        type="button"
        className="editor-accordion-trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        <span className="editor-accordion-meta">
          {badge && <span className="editor-accordion-badge">{badge}</span>}
          <ChevronDown size={18} aria-hidden="true" />
        </span>
      </button>
      {open && <div className="editor-accordion-content" id={contentId}>{children}</div>}
    </section>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('business-field', className, error && 'business-field-error')}>
      <span className="business-field-label">{label}</span>
      {children}
      {error ? <span className="business-field-message">{error}</span> : hint ? <span className="business-field-hint">{hint}</span> : null}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 'any',
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      {...props}
      className={cx('business-input', props.className)}
      type="number"
      min="0"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(event) => onChange(nonNegative(event.target.value))}
    />
  );
}

export function LineItemEditor({
  items,
  currency,
  onChange,
}: {
  items: LineItem[];
  currency: string;
  onChange: (items: LineItem[]) => void;
}) {
  const updateItem = (id: string, patch: Partial<LineItem>) => {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };
  const removeItem = (id: string) => {
    if (items.length <= 1) return;
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="line-item-editor">
      <div className="line-item-list">
        {items.map((item, index) => (
          <article className="line-item-card" key={item.id}>
            <div className="line-item-card-head">
              <span>Item {index + 1}</span>
              <button
                type="button"
                className="business-icon-button business-icon-danger"
                onClick={() => removeItem(item.id)}
                disabled={items.length <= 1}
                aria-label={`Hapus item ${index + 1}`}
                title={items.length <= 1 ? 'Minimal satu item harus tersedia' : 'Hapus item'}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <Field label="Deskripsi" className="line-item-description">
              <textarea
                className="business-textarea business-textarea-compact"
                value={item.description}
                rows={2}
                placeholder="Nama layanan atau pekerjaan"
                onChange={(event) => updateItem(item.id, { description: event.target.value })}
              />
            </Field>
            <div className="line-item-number-grid">
              <Field label="Quantity">
                <NumberInput value={item.quantity} onChange={(quantity) => updateItem(item.id, { quantity })} />
              </Field>
              <Field label="Harga satuan">
                <NumberInput value={item.unitPrice} onChange={(unitPrice) => updateItem(item.id, { unitPrice })} />
              </Field>
            </div>
            <div className="line-item-subtotal">
              <span>Subtotal item</span>
              <strong>{formatCurrency(item.quantity * item.unitPrice, currency)}</strong>
            </div>
          </article>
        ))}
      </div>
      <button
        type="button"
        className="business-button business-button-secondary business-button-full"
        onClick={() => onChange([...items, { id: createId(), description: '', quantity: 1, unitPrice: 0 }])}
      >
        <Plus size={17} /> Tambah Item
      </button>
    </div>
  );
}

export function ImageUploader({
  label,
  value,
  path,
  imageKind,
  documentKind,
  workspaceId,
  onChange,
  toast,
}: {
  label: string;
  value: string;
  path: string;
  imageKind: 'logo' | 'background';
  documentKind: DocumentKind;
  workspaceId: string;
  onChange: (value: { url: string; path: string }) => void;
  toast: BusinessToast;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setProgress(12);
    setError('');
    try {
      const compressed = await compressImage(file, imageKind === 'logo' ? 900 : 1600);
      setProgress(52);
      const result = await uploadBusinessImage(
        workspaceId,
        documentKind,
        imageKind,
        compressed.blob,
        compressed.extension,
      );
      setProgress(100);
      onChange(result.data);
      if (result.source === 'recovery') {
        toast('info', 'Gambar tersimpan sementara di perangkat. Upload server perlu migration/API aktif.');
      } else {
        toast('success', `${label} berhasil diupload.`);
      }
      URL.revokeObjectURL(compressed.previewUrl);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Gagal mengupload gambar.';
      setError(message);
      toast('error', message);
    } finally {
      window.setTimeout(() => setProgress(0), 500);
      setBusy(false);
    }
  };

  return (
    <div className="image-uploader">
      <div className="business-field-label">{label}</div>
      {value ? (
        <div className={cx('image-uploader-preview', imageKind === 'background' && 'image-uploader-preview-bg')}>
          <img src={value} alt={`Preview ${label}`} crossOrigin={value.startsWith('data:') ? undefined : 'anonymous'} />
          <div>
            <span>{path ? 'Tersimpan di Storage' : 'Recovery perangkat'}</span>
            <button type="button" className="business-link-danger" onClick={() => onChange({ url: '', path: '' })}>
              <Trash2 size={15} /> Hapus
            </button>
          </div>
        </div>
      ) : (
        <label className={cx('image-upload-dropzone', busy && 'is-busy')} htmlFor={inputId}>
          {busy ? <LoaderCircle className="spin" size={22} /> : imageKind === 'logo' ? <ImagePlus size={22} /> : <UploadCloud size={22} />}
          <span>{busy ? 'Mengompres & mengupload...' : `Pilih ${label.toLowerCase()}`}</span>
          <small>PNG, JPEG, atau WebP, maks. 12 MB</small>
        </label>
      )}
      <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void handleFile(event)} />
      {progress > 0 && <div className="upload-progress" aria-label={`Progress upload ${progress}%`}><span style={{ width: `${progress}%` }} /></div>}
      {error && <p className="business-field-message">{error}</p>}
    </div>
  );
}

const NAV_ITEMS = [
  { path: '/', label: 'Client & Sheets', mobileLabel: 'Sheets', icon: LayoutGrid, access: 'sheets' },
  { path: '/fee-calculator', label: 'Fee Calculator', mobileLabel: 'Fee', icon: Calculator, access: 'fee-calculator' },
  { path: '/invoices', label: 'Invoices', mobileLabel: 'Invoice', icon: ReceiptText, access: 'invoices' },
  { path: '/quotes', label: 'Penawaran Harga', mobileLabel: 'Penawaran', icon: FileText, access: 'quotes' },
] as const;

export function WorkspaceNavigation({
  workspaceName,
  activePath,
  dark,
  onToggleDark,
  onNavigate,
  canAccess,
}: {
  workspaceName: string;
  activePath: string;
  dark: boolean;
  onToggleDark: () => void;
  onNavigate: (path: string) => void;
  canAccess: (page: string) => boolean;
}) {
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item.access));
  const isActive = (path: string) => path === '/' ? activePath === '/' : activePath.startsWith(path);
  return (
    <>
      <aside className="workspace-nav" aria-label="Navigasi dashboard">
        <div className="workspace-nav-brand">
          <span className="workspace-nav-mark">SH</span>
          <span><strong>Workspace</strong><small>{workspaceName}</small></span>
        </div>
        <p className="workspace-nav-group">Bisnis & Keuangan</p>
        <nav>
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.path}
                className={cx('workspace-nav-item', isActive(item.path) && 'is-active')}
                aria-current={isActive(item.path) ? 'page' : undefined}
                onClick={() => onNavigate(item.path)}
              >
                <Icon size={18} /> <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button type="button" className="workspace-theme-toggle" onClick={onToggleDark}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
          <span>{dark ? 'Mode terang' : 'Mode gelap'}</span>
        </button>
      </aside>
      <nav className="workspace-mobile-nav" aria-label="Navigasi mobile">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.path}
              className={cx(isActive(item.path) && 'is-active')}
              aria-current={isActive(item.path) ? 'page' : undefined}
              onClick={() => onNavigate(item.path)}
            >
              <Icon size={19} /><span>{item.mobileLabel}</span>
            </button>
          );
        })}
      </nav>
      <button type="button" className="workspace-mobile-theme" onClick={onToggleDark} aria-label={dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'} title={dark ? 'Mode terang' : 'Mode gelap'}>
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </>
  );
}

export function BusinessPageHeader({
  eyebrow,
  title,
  description,
  actions,
  connection,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  connection?: { source: 'server' | 'recovery'; label?: string };
}) {
  return (
    <header className="business-page-header">
      <div>
        <div className="business-eyebrow-row">
          <span className="business-eyebrow">{eyebrow}</span>
          {connection && (
            <span className={cx('persistence-pill', connection.source === 'server' ? 'is-server' : 'is-recovery')}>
              <span aria-hidden="true" />
              {connection.label ?? (connection.source === 'server' ? 'Supabase aktif' : 'Recovery perangkat')}
            </span>
          )}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="business-page-actions">{actions}</div>}
    </header>
  );
}

export function RefreshNumberButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="business-input-action" onClick={onClick} aria-label="Buat nomor dokumen baru" title="Buat nomor baru">
      <RefreshCw size={16} />
    </button>
  );
}

export function LoadingButton({
  busy,
  busyLabel,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  busyLabel?: string;
}) {
  return (
    <button {...props} className={cx('business-button', className)} disabled={busy || props.disabled}>
      {busy && <LoaderCircle className="spin" size={17} />}
      {busy ? busyLabel ?? 'Memproses...' : children}
    </button>
  );
}

export function EmptyPanel({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="business-empty-panel">
      <div aria-hidden="true">{icon ?? <FileText size={28} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function panelAccentStyle(color: string): CSSProperties {
  return { '--panel-accent': color } as CSSProperties;
}
