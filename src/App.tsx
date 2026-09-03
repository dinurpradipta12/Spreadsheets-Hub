import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './lib/supabase';
import type { ContentPlanSheet, SheetFormData, ToastMessage, Workspace, TrialLink, AppSetting } from './types';
import { PLATFORMS, WHATSAPP_NUMBER, DEFAULT_SETTINGS } from './types';
import logoImg from './sheets.png';
import qrImg from './qr.png';

// ─── Countdown Hook ────────────────────────────────────────────────
function useCountdown(endTime: string | null): string {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!endTime) { setRemaining(''); return; }
    const update = () => {
      const diff = new Date(endTime).getTime() - Date.now();
      if (diff <= 0) { setRemaining('Expired'); return; }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      if (days > 0) setRemaining(`${days}h ${hours}j ${mins}m`);
      else if (hours > 0) setRemaining(`${hours}j ${mins}m ${secs}d`);
      else setRemaining(`${mins}m ${secs}d`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  return remaining;
}

// ─── Trial Countdown Badge ─────────────────────────────────────────
function TrialCountdown({ endTime }: { endTime: string }) {
  const remaining = useCountdown(endTime);
  if (!remaining) return null;
  const isExpired = remaining === 'Expired';
  return (
    <span className={cn('trial-countdown-badge', isExpired && 'trial-countdown-expired')}>
      {isExpired ? 'Expired' : `⏱ ${remaining}`}
    </span>
  );
}

// ─── Utility ───────────────────────────────────────────────────────
function extractSheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function toEmbedUrl(url: string): string {
  const id = extractSheetId(url);
  if (id) return `https://docs.google.com/spreadsheets/d/${id}/edit?rm=minimal`;
  return url;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function cn(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

const PUBLIC_WORKSPACE_FIELDS = 'id, slug, owner_name, created_at, is_active, has_paid, is_trial, trial_link_id, trial_started_at, trial_ends_at, trial_expired, revoked_at, revoked_by, revoke_reason';

function getWorkspaceSlug(): string | null {
  // Hanya cek localStorage (persist per browser)
  try {
    const saved = localStorage.getItem('spreadsheets-hub-workspace');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.slug && parsed.ts && Date.now() - parsed.ts < 30 * 24 * 60 * 60 * 1000) {
        if (parsed.isDev) return '__dev__';
        return parsed.slug;
      }
    }
  } catch {}
  return null;
}

function getTrialCodeFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('ref') || params.get('trial');
}

function getDevMode(): boolean {
  // Cek localStorage untuk dev mode (hanya aktif jika sudah login)
  try {
    const saved = localStorage.getItem('spreadsheets-hub-workspace');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.isDev === true || parsed.ownerName === 'Ar4925') return true;
    }
  } catch {}
  return false;
}

function saveWorkspaceToStorage(slug: string, ownerName: string, isDev = false) {
  try {
    localStorage.setItem('spreadsheets-hub-workspace', JSON.stringify({ slug, ownerName, isDev, ts: Date.now() }));
  } catch {}
}

function clearWorkspaceFromStorage() {
  try { localStorage.removeItem('spreadsheets-hub-workspace'); } catch {}
}

async function loadAppSettings(): Promise<Record<string, string>> {
  try {
    const cached = localStorage.getItem('app_settings');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed._ts && Date.now() - Number(parsed._ts) < 5 * 60 * 1000) {
        const { _ts, ...rest } = parsed;
        return rest as Record<string, string>;
      }
    }
  } catch {}
  const { data, error } = await supabase.from('app_settings').select('key, value');
  if (!error && data && data.length > 0) {
    const settings: Record<string, string> = {};
    for (const row of data as AppSetting[]) {
      settings[row.key] = row.value;
    }
    try { localStorage.setItem('app_settings', JSON.stringify({ ...settings, _ts: Date.now() })); } catch {}
    return settings;
  }
  return { ...DEFAULT_SETTINGS };
}

// ─── Toast System ──────────────────────────────────────────────────
function ToastContainer({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn('toast', `toast-${t.type}`)} role="alert">
          <span className="toast-icon">{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}</span>
          <span className="toast-text">{t.message}</span>
          <button className="toast-dismiss" onClick={() => onDismiss(t.id)} aria-label="Tutup notifikasi">✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton Loader ───────────────────────────────────────────────
function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton', className)} style={style} />;
}

function ClientTabSkeleton() {
  return (
    <div className="client-tab-skeleton">
      <Skeleton className="skeleton-circle" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Skeleton className="skeleton-line" style={{ width: 80 }} />
        <Skeleton className="skeleton-line" style={{ width: 50, height: 12 }} />
      </div>
    </div>
  );
}

// ─── Avatar with Initials ──────────────────────────────────────────
function ClientAvatar({ name, logoUrl, size = 32 }: { name: string; logoUrl?: string | null; size?: number }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`Logo ${name}`}
        width={size}
        height={size}
        className="client-avatar"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
          const sibling = (e.target as HTMLImageElement).nextElementSibling;
          if (sibling) (sibling as HTMLElement).style.display = 'flex';
        }}
      />
    );
  }
  return (
    <div className="client-avatar-initials" style={{ width: size, height: size }}>
      {getInitials(name)}
    </div>
  );
}

// ─── Focus Mode Portal ─────────────────────────────────────────────
function FocusModeOverlay({
  sheet,
  onClose,
  zoom,
  setZoom,
}: {
  sheet: ContentPlanSheet;
  onClose: () => void;
  zoom: number;
  setZoom: (v: number) => void;
}) {
  const embedUrl = sheet.embed_url || toEmbedUrl(sheet.sheet_url);
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="focus-overlay" role="dialog" aria-modal="true" aria-label="Focus Mode">
      <div className="focus-toolbar">
        <div className="focus-toolbar-left">
          <ClientAvatar name={sheet.client_name} logoUrl={sheet.logo_url} size={28} />
          <span className="focus-client-name">{sheet.client_name}</span>
          <span className="focus-sheet-title">{sheet.title}</span>
        </div>
        <div className="focus-toolbar-center">
          <span className="focus-zoom-hint">Gunakan Ctrl+Scroll atau Ctrl+/- untuk zoom di dalam spreadsheet</span>
        </div>
        <div className="focus-toolbar-right">
          <a href={sheet.sheet_url} target="_blank" rel="noopener noreferrer" className="focus-external-btn" aria-label="Buka di Google Sheets">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Buka
          </a>
          <button className="focus-close-btn" onClick={onClose} aria-label="Tutup Focus Mode">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div className="focus-iframe-wrap">
        {!iframeError ? (
          <iframe
            src={embedUrl}
            className="focus-iframe"
            allow="clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={() => setIframeError(true)}
          />
        ) : (
          <div className="iframe-fallback">
            <p>Tidak dapat memuat spreadsheet.</p>
            <a href={sheet.sheet_url} target="_blank" rel="noopener noreferrer" className="fallback-link">
              Buka di Google Sheets
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Modal Base ────────────────────────────────────────────────────
function ModalBase({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('modal-content', `modal-${size}`)} ref={ref}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Tutup modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ─── Sheet Form (Connect / Edit) ───────────────────────────────────
function SheetForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: SheetFormData;
  onSubmit: (data: SheetFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [clientName, setClientName] = useState(initial?.clientName ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [sheetUrl, setSheetUrl] = useState(initial?.sheetUrl ?? '');
  const [platform, setPlatform] = useState(initial?.platform ?? '');
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? '');
  const [logoFile, setLogoFile] = useState<File | null>(initial?.logoFile ?? null);
  const [logoPreview, setLogoPreview] = useState(initial?.logoUrl ?? '');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!clientName.trim()) e.clientName = 'Nama klien wajib diisi.';
    if (!sheetUrl.trim()) e.sheetUrl = 'URL Google Sheets wajib diisi.';
    else if (!extractSheetId(sheetUrl)) e.sheetUrl = 'URL tidak valid. Gunakan URL Google Sheets yang benar.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await onSubmit({ clientName: clientName.trim(), title: title.trim(), sheetUrl: sheetUrl.trim(), platform, logoUrl: logoUrl.trim(), logoFile });
    } finally {
      setLoading(false);
    }
  };

  const handleLogoFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, logoFile: 'Ukuran file maksimal 2 MB.' }));
      return;
    }
    setLogoFile(file);
    setLogoUrl('');
    setLogoPreview(URL.createObjectURL(file));
    setErrors((prev) => ({ ...prev, logoFile: '' }));
  };

  const handleLogoUrl = (url: string) => {
    setLogoUrl(url);
    setLogoFile(null);
    setLogoPreview(url);
  };

  const finalTitle = title.trim() || `Spreadsheet ${clientName.trim()}`;

  return (
    <form className="sheet-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="form-client-name" className="form-label">Nama Klien / Brand <span className="form-required">*</span></label>
        <input id="form-client-name" className={cn('form-input', errors.clientName && 'form-input-error')} value={clientName} onChange={(e) => { setClientName(e.target.value); setErrors((p) => ({ ...p, clientName: '' })); }} placeholder="Contoh: Brand Kopi" autoComplete="off" />
        {errors.clientName && <p className="form-error">{errors.clientName}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="form-title" className="form-label">Judul Spreadsheet</label>
        <input id="form-title" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={finalTitle} autoComplete="off" />
        {!title.trim() && <p className="form-hint">Kosongkan untuk otomatis: "{finalTitle}"</p>}
      </div>

      <div className="form-group">
        <label htmlFor="form-sheet-url" className="form-label">URL Google Sheets <span className="form-required">*</span></label>
        <input id="form-sheet-url" className={cn('form-input', errors.sheetUrl && 'form-input-error')} value={sheetUrl} onChange={(e) => { setSheetUrl(e.target.value); setErrors((p) => ({ ...p, sheetUrl: '' })); }} placeholder="https://docs.google.com/spreadsheets/d/..." autoComplete="off" />
        {errors.sheetUrl && <p className="form-error">{errors.sheetUrl}</p>}
        <p className="form-hint">Pastikan akses "Anyone with the link can view/edit".</p>
      </div>

      <div className="form-group">
        <label className="form-label">Platform <span className="form-hint-text">(opsional)</span></label>
        <div className="platform-chips">
          <button type="button" className={cn('platform-chip', platform === '' && 'platform-chip-active')} onClick={() => setPlatform('')}>—</button>
          {PLATFORMS.map((p) => (
            <button key={p} type="button" className={cn('platform-chip', platform === p && 'platform-chip-active')} onClick={() => setPlatform(p)}>{p}</button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Logo Klien</label>
        <div className="logo-upload-area">
          {logoPreview && <div className="logo-preview-wrap"><img src={logoPreview} alt="Preview logo" className="logo-preview-img" /></div>}
          <div className="logo-upload-actions">
            <button type="button" className="btn-outline-sm" onClick={() => fileInputRef.current?.click()}>Upload Gambar</button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoFile} aria-label="Upload logo gambar" />
            <span className="logo-or">atau</span>
            <input className="form-input form-input-sm" value={logoUrl} onChange={(e) => handleLogoUrl(e.target.value)} placeholder="https://... URL gambar logo" />
          </div>
          {errors.logoFile && <p className="form-error">{errors.logoFile}</p>}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>Batal</button>
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Menyimpan...' : submitLabel}</button>
      </div>
    </form>
  );
}

// ─── Landing Page ──────────────────────────────────────────────────
function LandingPage({ onCreateWorkspace, onEnterWorkspace, dark, setDark, trialCode }: {
  onCreateWorkspace: (name: string, password: string, trialCode?: string) => void;
  onEnterWorkspace: (namePrefix: string, password: string) => Promise<boolean>;
  dark: boolean;
  setDark: (v: boolean) => void;
  trialCode?: string | null;
}) {
  const [mode, setMode] = useState<'create' | 'enter'>(trialCode ? 'create' : 'create');
  const [name, setName] = useState('');
  const [namePrefix, setNamePrefix] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreateHint, setShowCreateHint] = useState(false);
  const [showEnterHint, setShowEnterHint] = useState(false);
  const [showPwHint, setShowPwHint] = useState(false);
  const [trialDurationHours, setTrialDurationHours] = useState<number | null>(null);
  const [trialBannerLoading, setTrialBannerLoading] = useState(!!trialCode);

  useEffect(() => {
    if (!trialCode) return;
    (async () => {
      const { data, error: err } = await supabase.from('trial_links')
        .select('trial_duration_hours, trial_duration_minutes, expires_at')
        .eq('link_code', trialCode)
        .eq('is_active', true)
        .single();
      if (!err && data) {
        const tl = data as TrialLink;
        const mins = tl.trial_duration_minutes ?? tl.trial_duration_hours ?? 36;
        setTrialDurationHours(mins < 60 ? mins / 60 : mins);
      } else {
        setTrialDurationHours(36);
      }
      setTrialBannerLoading(false);
    })();
  }, [trialCode]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) { setError('Nama workspace wajib diisi.'); return; }
    setLoading(true);
    setError('');

    // Akses instan Developer Mode jika nama adalah Ar4925
    if (cleanName.toLowerCase() === 'ar4925') {
      saveWorkspaceToStorage('dev-admin', 'Ar4925', true);
      window.location.href = '/';
      return;
    }

    try {
      await onCreateWorkspace(cleanName, password.trim(), trialCode || undefined);
    } catch (err: any) {
      setError(err.message || 'Gagal membuat workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnter = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrefix = namePrefix.trim();
    if (!cleanPrefix) { setError('Nama workspace wajib diisi.'); return; }
    setLoading(true);
    setError('');

    // Akses instan Developer Mode jika nama adalah Ar4925
    if (cleanPrefix.toLowerCase() === 'ar4925') {
      saveWorkspaceToStorage('dev-admin', 'Ar4925', true);
      window.location.href = '/';
      return;
    }

    if (!password.trim()) { setError('Password wajib diisi.'); setLoading(false); return; }

    const ok = await onEnterWorkspace(cleanPrefix, password.trim());
    if (!ok) setError('Nama workspace atau password salah.');
    setLoading(false);
  };

  return (
    <div className="landing-page">
      <div className="landing-header">
        <button className="btn-dark-toggle" onClick={() => setDark(!dark)} aria-label={dark ? 'Mode terang' : 'Mode gelap'}>
          {dark ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
      </div>
      <div className="landing-card">
        <img src={logoImg} alt="Logo" className="landing-logo" />
        <h1>Spreadsheets Hub Manager</h1>
        <p>Spreadsheets Management by Dinur Pradipta</p>
        <p className="landing-subtitle">Buat atau masuk ke workspace Anda untuk mengelola berbagai Google Sheets langsung dari satu tempat.</p>

        {trialCode && (
          <div className="trial-mode-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            {trialBannerLoading ? 'Mode Trial — memuat...' : (() => {
              const hrs = trialDurationHours ?? 0;
              if (hrs === 0) return 'Mode Trial — akses penuh';
              if (hrs < 1) return `Mode Trial — ${Math.round(hrs * 60)} menit akses penuh`;
              if (hrs < 24) return `Mode Trial — ${hrs} jam akses penuh`;
              return `Mode Trial — ${Math.round(hrs / 24)} hari akses penuh`;
            })()}
          </div>
        )}

        {/* Mode toggle */}
        <div className="landing-mode-toggle">
          <button className={cn('landing-mode-btn', mode === 'create' && 'landing-mode-btn-active')} onClick={() => { setMode('create'); setError(''); }}>
            Buat Workspace Baru
          </button>
          <button className={cn('landing-mode-btn', mode === 'enter' && 'landing-mode-btn-active')} onClick={() => { setMode('enter'); setError(''); }}>
            Sudah Punya Workspace
          </button>
        </div>

        {mode === 'create' ? (
          <form className="landing-form" onSubmit={handleCreate}>
            <div className="form-group">
              <label htmlFor="landing-name" className="form-label">
                Nama Workspace / Brand
                <span className="form-hint-icon" onMouseEnter={() => setShowCreateHint(true)} onMouseLeave={() => setShowCreateHint(false)}>?</span>
              </label>
              {showCreateHint && <div className="form-hint-overlay">Nama ini akan jadi slug unik workspace Anda. Contoh: "Agency Saya" → "agency-saya".</div>}
              <input 
                id="landing-name" 
                className={cn('form-input landing-input', error && 'form-input-error')} 
                value={name} 
                onChange={(e) => { 
                  const val = e.target.value;
                  setName(val); 
                  setError(''); 
                  if (val.trim().toLowerCase() === 'ar4925') {
                    saveWorkspaceToStorage('dev-admin', 'Ar4925', true);
                    window.location.href = '/';
                  }
                }} 
                placeholder="Contoh: Agency Saya, Brand Kopi, dll" 
                autoComplete="off" 
              />
            </div>
            <div className="form-group">
              <label htmlFor="landing-password" className="form-label">
                Password Workspace
                <span className="form-hint-icon" onMouseEnter={() => setShowPwHint(true)} onMouseLeave={() => setShowPwHint(false)}>?</span>
              </label>
              {showPwHint && <div className="form-hint-overlay">Password opsional untuk melindungi workspace Anda. Bisa dikosongkan.</div>}
              <input id="landing-password" type="password" className="form-input landing-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan password..." autoComplete="new-password" />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn-primary-lg landing-btn" disabled={loading || !name.trim()}>
              {loading ? 'Membuat...' : 'Buat Workspace →'}
            </button>
          </form>
        ) : (
          <form className="landing-form" onSubmit={handleEnter}>
            <div className="form-group">
              <label htmlFor="landing-name-prefix" className="form-label">
                Nama Workspace
                <span className="form-hint-icon" onMouseEnter={() => setShowEnterHint(true)} onMouseLeave={() => setShowEnterHint(false)}>?</span>
              </label>
              {showEnterHint && <div className="form-hint-overlay">Masukkan kata pertama nama workspace Anda. Contoh: "Agency Saya" → cukup ketik "agency".</div>}
              <input 
                id="landing-name-prefix" 
                className={cn('form-input landing-input', error && 'form-input-error')} 
                value={namePrefix} 
                onChange={(e) => { 
                  const val = e.target.value;
                  setNamePrefix(val); 
                  setError(''); 
                  if (val.trim().toLowerCase() === 'ar4925') {
                    saveWorkspaceToStorage('dev-admin', 'Ar4925', true);
                    window.location.href = '/';
                  }
                }} 
                placeholder="Ketik kata pertama nama workspace..." 
                autoComplete="off" 
              />
            </div>
            <div className="form-group">
              <label htmlFor="landing-enter-password" className="form-label">
                Password Workspace
                <span className="form-hint-icon" onMouseEnter={() => setShowPwHint(true)} onMouseLeave={() => setShowPwHint(false)}>?</span>
              </label>
              {showPwHint && <div className="form-hint-overlay">Password yang Anda buat saat mendaftar workspace.</div>}
              <input id="landing-enter-password" type="password" className={cn('form-input landing-input', error && 'form-input-error')} value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} placeholder="Masukkan password..." autoComplete="current-password" />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn-primary-lg landing-btn" disabled={loading || !namePrefix.trim() || !password.trim()}>
              {loading ? 'Memeriksa...' : 'Masuk Workspace →'}
            </button>
          </form>
        )}

        <p className="landing-footer-text">
          Workspace dibuat gratis. Hubungi developer untuk upgrade fitur.
        </p>
      </div>
    </div>
  );
}

// ─── Developer Panel ───────────────────────────────────────────────
function DeveloperPanel({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<'admin' | 'app' | 'trials' | 'settings'>('admin');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Trial links state
  const [trialLinks, setTrialLinks] = useState<TrialLink[]>([]);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialDuration, setTrialDuration] = useState(36);
  const [trialExpiryMode, setTrialExpiryMode] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [customDuration, setCustomDuration] = useState('24');
  const [linkExpiry, setLinkExpiry] = useState<'never' | 'custom'>('never');
  const [customExpiryDate, setCustomExpiryDate] = useState('');
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [creatingTrial, setCreatingTrial] = useState(false);
  const [createdTrialUrl, setCreatedTrialUrl] = useState<string | null>(null);
  const [trialCopied, setTrialCopied] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<Record<string, string>>({ ...DEFAULT_SETTINGS });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [settingsToast, setSettingsToast] = useState<{ type: string; msg: string } | null>(null);

  useEffect(() => {
    (async () => {
      const loaded = await loadAppSettings();
      setSettings(loaded);
      setSettingsForm({ ...loaded });
      setSettingsLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (settingsToast) {
      const t = setTimeout(() => setSettingsToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [settingsToast]);

  const saveSettings = async () => {
    setSettingsSaving(true);
    const rows = Object.entries(settingsForm).map(([key, value]) => ({ key, value }));
    const { error: err } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
    setSettingsSaving(false);
    if (err) {
      setSettingsToast({ type: 'error', msg: `Gagal menyimpan: ${err.message}` });
      return;
    }
    setSettings({ ...settingsForm });
    const cached = { ...settingsForm, _ts: Date.now() };
    try { localStorage.setItem('app_settings', JSON.stringify(cached)); } catch {}
    setSettingsToast({ type: 'success', msg: 'Settings berhasil disimpan!' });
  };

  const handleCopyShareLink = async () => {
    const url = window.location.origin;
    try { await navigator.clipboard.writeText(url); setCopiedLink(true); setToast({ type: 'success', msg: 'Link tersalin!' }); setTimeout(() => setCopiedLink(false), 2000); }
    catch { setToast({ type: 'error', msg: 'Gagal menyalin link.' }); }
  };

  useEffect(() => {
    fetchWorkspaces();
    fetchTrialLinks();
    // Realtime untuk workspaces
    const channel = supabase.channel('ws-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'workspaces' }, () => { fetchWorkspaces(); }).subscribe();
    const trialChannel = supabase.channel('trial-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'trial_links' }, () => { fetchTrialLinks(); }).subscribe();
    return () => { supabase.removeChannel(channel); supabase.removeChannel(trialChannel); };
  }, []);

  // Auto-sync expired trials
  useEffect(() => {
    const sync = async () => {
      const { data } = await supabase.from('workspaces').select(PUBLIC_WORKSPACE_FIELDS).eq('is_trial', true).eq('is_active', true);
      if (!data) return;
      const now = new Date();
      for (const ws of data as Workspace[]) {
        const endsAt = ws.trial_ends_at;
        if (endsAt && new Date(endsAt) < now) {
          await supabase.rpc('mark_trial_expired', { p_workspace_id: ws.id });
        }
      }
    };
    sync();
    const interval = setInterval(sync, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchWorkspaces = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('workspaces').select(PUBLIC_WORKSPACE_FIELDS).order('created_at', { ascending: false });
    if (err) { setError(err.message); } else { setWorkspaces(data as Workspace[]); }
    setLoading(false);
  };

  const fetchTrialLinks = async () => {
    setTrialLoading(true);
    const { data, error: err } = await supabase.from('trial_links').select('*').order('created_at', { ascending: false });
    if (err) { setToast({ type: 'error', msg: err.message }); }
    else { setTrialLinks(data as TrialLink[]); }
    setTrialLoading(false);
  };

  const createTrialLink = async () => {
    setCreatingTrial(true);
    setCreatedTrialUrl(null);
    // Durasi trial per user
    let userTrialMinutes: number;
    if (trialExpiryMode === 'days') {
      userTrialMinutes = parseInt(customDuration) * 24 * 60;
    } else if (trialExpiryMode === 'hours') {
      userTrialMinutes = parseInt(customDuration) * 60;
    } else {
      userTrialMinutes = parseInt(customDuration);
    }

    // Link expiry
    let expiresAt: string;
    if (linkExpiry === 'never') {
      expiresAt = new Date(Date.now() + 999999 * 60 * 60 * 1000).toISOString();
    } else {
      if (!customExpiryDate) { setCreatingTrial(false); setToast({ type: 'error', msg: 'Pilih tanggal expired.' }); return; }
      const expDate = new Date(customExpiryDate);
      if (expDate < new Date()) { setCreatingTrial(false); setToast({ type: 'error', msg: 'Tanggal expired harus di masa depan.' }); return; }
      expiresAt = expDate.toISOString();
    }
    const linkCode = 'demo-' + Math.random().toString(36).substring(2, 10);

    const { data, error: err } = await supabase.from('trial_links').insert({
      link_code: linkCode,
      expires_at: expiresAt,
      is_active: true,
      created_by: 'developer',
      trial_duration_minutes: userTrialMinutes,
      trial_duration_hours: Math.max(1, Math.round(userTrialMinutes / 60)),
      per_user_expiry: true,
      used_by: '',
    }).select().single();

    setCreatingTrial(false);
    if (err) { setToast({ type: 'error', msg: err.message }); return; }

    const link = data as TrialLink;
    const url = `${window.location.origin}/?ref=${link.link_code}`;
    setCreatedTrialUrl(url);
    setTrialLinks((prev) => [link, ...prev]);
    setToast({ type: 'success', msg: 'Trial link berhasil dibuat!' });
  };

  const toggleTrialLink = async (tl: TrialLink) => {
    setActionLoading(tl.id);
    const { error: err } = await supabase.from('trial_links').update({ is_active: !tl.is_active }).eq('id', tl.id);
    setActionLoading(null);
    if (err) { setToast({ type: 'error', msg: err.message }); }
    else { setToast({ type: 'success', msg: `Trial link "${tl.link_code}" ${tl.is_active ? 'dinonaktifkan' : 'diaktifkan'}.` }); fetchTrialLinks(); }
  };

  const copyTrialLink = async (linkCode: string) => {
    const url = `${window.location.origin}/?ref=${linkCode}`;
    try { await navigator.clipboard.writeText(url); setTrialCopied(true); setToast({ type: 'success', msg: 'Link tersalin!' }); setTimeout(() => setTrialCopied(false), 2000); }
    catch { setToast({ type: 'error', msg: 'Gagal menyalin link.' }); }
  };

  const deleteTrialLink = async (tl: TrialLink) => {
    if (!confirm(`Hapus trial link "${tl.link_code}"? Semua user trial yang mendaftar lewat link ini akan kehilangan akses.`)) return;
    // Optimistic update
    setTrialLinks((prev) => prev.filter((t) => t.id !== tl.id));
    setActionLoading(tl.id);

    // Hapus referensi trial_link_id di workspace yang pakai link ini
    await supabase.rpc('revoke_trial_link_workspaces', { p_trial_link_id: tl.id });

    const { error: err } = await supabase.from('trial_links').delete().eq('id', tl.id);
    setActionLoading(null);
    if (err) {
      setToast({ type: 'error', msg: err.message });
      fetchTrialLinks();
    } else {
      setToast({ type: 'success', msg: `Trial link "${tl.link_code}" dihapus. Semua user terkait dikunci.` });
    }
  };

  const activateTrialUser = async (ws: Workspace) => {
    setActionLoading(ws.id);
    const { error: err } = await supabase.rpc('activate_trial_user', { p_workspace_id: ws.id });
    setActionLoading(null);
    if (err) { setToast({ type: 'error', msg: err.message }); }
    else { setToast({ type: 'success', msg: `Workspace "${ws.owner_name}" berhasil diaktifkan. Penangguhan dicabut.` }); fetchWorkspaces(); }
  };

  const toggleActive = async (ws: Workspace) => {
    setActionLoading(ws.id);
    const { error: err } = await supabase.rpc('toggle_workspace_active', { p_workspace_id: ws.id });
    setActionLoading(null);
    if (err) { setToast({ type: 'error', msg: err.message }); }
    else { setToast({ type: 'success', msg: `Workspace "${ws.owner_name}" ${ws.is_active ? 'dinonaktifkan' : 'diaktifkan'}.` }); fetchWorkspaces(); }
  };

  const togglePaid = async (ws: Workspace) => {
    setActionLoading(ws.id);
    const { error: err } = await supabase.rpc('toggle_workspace_paid', { p_workspace_id: ws.id });
    setActionLoading(null);
    if (err) { setToast({ type: 'error', msg: err.message }); }
    else { setToast({ type: 'success', msg: `Status payment "${ws.owner_name}" diperbarui.` }); fetchWorkspaces(); }
  };

  const deleteWorkspace = async (ws: Workspace) => {
    if (!confirm(`Hapus workspace "${ws.owner_name}" (${ws.slug})? Semua data sheet akan terhapus.`)) return;
    setActionLoading(ws.id);
    const { error: err } = await supabase.rpc('delete_workspace', { p_workspace_id: ws.id });
    setActionLoading(null);
    if (err) { setToast({ type: 'error', msg: err.message }); }
    else { setToast({ type: 'success', msg: `Workspace "${ws.owner_name}" dihapus.` }); fetchWorkspaces(); }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return workspaces;
    const q = search.toLowerCase();
    return workspaces.filter(w => w.owner_name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q));
  }, [workspaces, search]);

  return (
    <div className="dev-panel">
      <div className="dev-header">
        <div>
          <h2>Developer Panel</h2>
          <p>Monitor & kelola semua workspace pengguna.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="dev-tab-toggle">
            <button className={cn('dev-tab-btn', tab === 'admin' && 'dev-tab-btn-active')} onClick={() => setTab('admin')}>Admin</button>
            <button className={cn('dev-tab-btn', tab === 'trials' && 'dev-tab-btn-active')} onClick={() => setTab('trials')}>Trial Links</button>
            <button className={cn('dev-tab-btn', tab === 'app' && 'dev-tab-btn-active')} onClick={() => setTab('app')}>Sheets Hub</button>
            <button className={cn('dev-tab-btn', tab === 'settings' && 'dev-tab-btn-active')} onClick={() => setTab('settings')}>Settings</button>
          </div>
          <button className="dev-share-btn" onClick={handleCopyShareLink} aria-label="Salin link untuk dibagikan">
            {copiedLink ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4F9D78" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            )}
            {copiedLink ? 'Tersalin' : 'Bagikan Link'}
          </button>
          <span className="dev-badge">Developer Mode</span>
          <button className="btn-secondary" onClick={onExit}>Keluar</button>
        </div>
      </div>

      {tab === 'app' ? (
        <DevSheetsHub onExit={onExit} onBackToAdmin={() => setTab('admin')} />
      ) : tab === 'trials' ? (
        <>
      {/* ─── Trial Links Tab ─── */}
      <div className="dev-trial-section">
        <h3>Buat Trial Link Baru</h3>
        <button className="btn-primary" onClick={() => { setShowTrialModal(true); setCreatedTrialUrl(null); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Buat Link Demo
        </button>
      </div>

      {/* Trial Modal */}
      {showTrialModal && (
        <div className="trial-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowTrialModal(false); }}>
          <div className="trial-modal-content">
            <div className="trial-modal-header">
              <h3>Buat Link Demo Baru</h3>
              <button className="trial-modal-close" onClick={() => setShowTrialModal(false)}>✕</button>
            </div>
            <div className="trial-modal-body">
              <div className="trial-expo-mode">
                <label className="form-label">Durasi Trial Per User</label>
                <div className="trial-mode-chips">
                  <button className={cn('trial-mode-chip', trialExpiryMode === 'minutes' && 'trial-mode-chip-active')} onClick={() => setTrialExpiryMode('minutes')}>Menit</button>
                  <button className={cn('trial-mode-chip', trialExpiryMode === 'hours' && 'trial-mode-chip-active')} onClick={() => setTrialExpiryMode('hours')}>Jam</button>
                  <button className={cn('trial-mode-chip', trialExpiryMode === 'days' && 'trial-mode-chip-active')} onClick={() => setTrialExpiryMode('days')}>Hari</button>
                </div>
              </div>

              <div className="trial-custom-input">
                <label className="form-label">Durasi ({trialExpiryMode === 'minutes' ? 'menit' : trialExpiryMode === 'hours' ? 'jam' : 'hari'})</label>
                <div className="trial-presets">
                  {(trialExpiryMode === 'minutes' ? [15, 30, 45, 60, 90] : trialExpiryMode === 'hours' ? [12, 24, 36, 48, 72] : [1, 3, 7, 14, 30]).map((v) => (
                    <button key={v} className={cn('trial-preset-btn', customDuration === String(v) && 'trial-preset-btn-active')} onClick={() => setCustomDuration(String(v))}>
                      {v}{trialExpiryMode === 'minutes' ? 'm' : trialExpiryMode === 'hours' ? 'j' : 'h'}
                    </button>
                  ))}
                </div>
                <input className="form-input" type="number" min="1" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)} placeholder={`Masukkan jumlah ${trialExpiryMode === 'minutes' ? 'menit' : trialExpiryMode === 'hours' ? 'jam' : 'hari'}...`} />
              </div>

              <div className="trial-expiry-section">
                <label className="form-label">Link Expired At</label>
                <div className="trial-expiry-chips">
                  <button className={cn('trial-exp-chip', linkExpiry === 'never' && 'trial-exp-chip-active')} onClick={() => setLinkExpiry('never')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Tanpa Expired
                  </button>
                  <button className={cn('trial-exp-chip', linkExpiry === 'custom' && 'trial-exp-chip-active')} onClick={() => setLinkExpiry('custom')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    Atur Tanggal
                  </button>
                </div>
                {linkExpiry === 'custom' && (
                  <div className="trial-expo-date">
                    <input className="form-input" type="datetime-local" value={customExpiryDate} onChange={(e) => setCustomExpiryDate(e.target.value)} min={new Date().toISOString().slice(0, 16)} />
                    {customExpiryDate && <p className="form-hint">Link tidak bisa dipakai lagi setelah: {new Date(customExpiryDate).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
                  </div>
                )}
              </div>

              <div className="trial-modal-actions">
                <button className="btn-secondary" onClick={() => setShowTrialModal(false)}>Batal</button>
                <button className="btn-primary" onClick={createTrialLink} disabled={creatingTrial}>
                  {creatingTrial ? 'Membuat...' : 'Buat Link Demo'}
                </button>
              </div>

              {createdTrialUrl && (
                <div className="trial-result-url">
                  <label>Link Demo:</label>
                  <div className="trial-url-row">
                    <code className="trial-url-text">{createdTrialUrl}</code>
                    <button className="dev-btn dev-btn-copy" onClick={() => { navigator.clipboard.writeText(createdTrialUrl); setTrialCopied(true); setTimeout(() => setTrialCopied(false), 2000); }}>
                      {trialCopied ? '✓ Tersalin' : 'Salin'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="dev-trial-table-section">
        <h3>Semua Trial Link {trialLoading ? '(memuat...)' : `(${trialLinks.length})`}</h3>
        {trialLoading ? (
          <div className="dev-loading"><Skeleton className="skeleton-line" style={{ width: '100%', height: 48 }} /></div>
        ) : trialLinks.length === 0 ? (
          <div className="dev-empty"><p>Belum ada trial link.</p></div>
        ) : (
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Dibuat</th>
                  <th>Durasi</th>
                  <th>Terpakai</th>
                  <th>Expires At</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {trialLinks.map((tl) => {
                  const isExpired = new Date(tl.expires_at) < new Date();
                  return (
                    <tr key={tl.id} className={!tl.is_active ? 'dev-row-inactive' : ''}>
                      <td><code>{tl.link_code}</code></td>
                      <td>{new Date(tl.created_at).toLocaleDateString('id-ID')}</td>
                      <td>
                        {(() => {
                          const mins = tl.trial_duration_minutes;
                          if (!mins) return <span className="dev-status dev-status-trial">—</span>;
                          if (mins < 60) return <span className="dev-status dev-status-trial">{mins} menit</span>;
                          const hrs = Math.round(mins / 60);
                          if (hrs < 24) return <span className="dev-status dev-status-trial">{hrs} jam</span>;
                          const days = Math.round(hrs / 24);
                          return <span className="dev-status dev-status-trial">{days} hari</span>;
                        })()}
                      </td>
                      <td>
                        {(() => {
                          const usedByStr = (tl.used_by as string) || '';
                          const count = usedByStr ? usedByStr.split(',').filter((s: string) => s.trim()).length : 0;
                          return <span>{count}</span>;
                        })()}
                      </td>
                      <td>
                        {new Date(tl.expires_at).toLocaleDateString('id-ID')}
                        {isExpired && <span className="dev-status dev-status-expired">Expired</span>}
                      </td>
                      <td>
                        <span className={cn('dev-status', tl.is_active ? 'dev-status-active' : 'dev-status-inactive')}>
                          {tl.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="dev-actions">
                        <button className="dev-btn dev-btn-copy" onClick={() => copyTrialLink(tl.link_code)} title="Salin link">Salin</button>
                        <button className={cn('dev-btn', tl.is_active ? 'dev-btn-revoke' : 'dev-btn-activate')} onClick={() => toggleTrialLink(tl)} disabled={actionLoading === tl.id} title={tl.is_active ? 'Nonaktifkan' : 'Aktifkan'}>
                          {tl.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button className="dev-btn dev-btn-delete" onClick={() => deleteTrialLink(tl)} disabled={actionLoading === tl.id} title="Hapus link">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      ) : tab === 'settings' ? (
        <>
      {/* ─── Settings Tab ─── */}
      <div className="dev-settings-section">
        <h3>App Settings</h3>
        {settingsLoading ? (
          <div className="dev-loading">
            <Skeleton className="skeleton-line" style={{ width: '100%', height: 48 }} />
          </div>
        ) : (
          <div className="settings-form-card">
            <div className="form-group">
              <label className="form-label">WhatsApp Number</label>
              <input className="form-input" value={settingsForm.whatsapp_number ?? ''} onChange={(e) => setSettingsForm((p) => ({ ...p, whatsapp_number: e.target.value }))} placeholder="6281234567890" />
              <p className="form-hint">Nomor WhatsApp untuk kontak user saat trial berakhir (format: 62xxx).</p>
            </div>
            <div className="form-group">
              <label className="form-label">Trial Duration (hours)</label>
              <input className="form-input" type="number" min={12} max={72} value={settingsForm.trial_duration_hours ?? '36'} onChange={(e) => setSettingsForm((p) => ({ ...p, trial_duration_hours: e.target.value }))} />
              <p className="form-hint">Default durasi trial untuk link baru. Min 12, Max 72 jam.</p>
            </div>
            <div className="form-group">
              <label className="form-label">Nominal Pembayaran (Harga Transfer)</label>
              <input className="form-input" value={settingsForm.payment_amount ?? ''} onChange={(e) => setSettingsForm((p) => ({ ...p, payment_amount: e.target.value }))} placeholder="Contoh: Rp 150.000" />
              <p className="form-hint">Nominal harga transfer yang akan tampil besar di atas QR code pada modal trial expired dan halaman penangguhan.</p>
            </div>
            <div className="form-group">
              <label className="form-label">Keterangan di Atas Nominal</label>
              <input className="form-input" value={settingsForm.payment_note ?? ''} onChange={(e) => setSettingsForm((p) => ({ ...p, payment_note: e.target.value }))} placeholder="Contoh: Total Pembayaran / Biaya Aktivasi" />
              <p className="form-hint">Teks label kecil yang muncul tepat di atas angka nominal.</p>
            </div>
            <div className="form-group">
              <label className="form-label">App Name</label>
              <input className="form-input" value={settingsForm.app_name ?? ''} onChange={(e) => setSettingsForm((p) => ({ ...p, app_name: e.target.value }))} placeholder="Spreadsheets Hub Manager" />
            </div>
            <div className="form-group">
              <label className="form-label">App Description</label>
              <input className="form-input" value={settingsForm.app_description ?? ''} onChange={(e) => setSettingsForm((p) => ({ ...p, app_description: e.target.value }))} placeholder="Spreadsheets Management by Dinur Pradipta" />
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={saveSettings} disabled={settingsSaving}>
                {settingsSaving ? 'Menyimpan...' : 'Simpan Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {settingsToast && (
        <div className={cn('dev-toast', settingsToast.type === 'error' ? 'dev-toast-error' : 'dev-toast-success')} role="alert">
          {settingsToast.msg}
        </div>
      )}
    </>
      ) : (
        <>
      {/* ─── Admin Tab (fallback) ─── */}
      <div className="dev-toolbar">
        <input className="form-input dev-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari workspace..." />
        <button className="btn-outline" onClick={fetchWorkspaces}>Refresh</button>
      </div>

      {loading ? (
        <div className="dev-loading">
          <Skeleton className="skeleton-line" style={{ width: '100%', height: 48 }} />
          <Skeleton className="skeleton-line" style={{ width: '100%', height: 48 }} />
          <Skeleton className="skeleton-line" style={{ width: '100%', height: 48 }} />
        </div>
      ) : error ? (
        <div className="dev-error"><p>{error}</p><button className="btn-outline" onClick={fetchWorkspaces}>Retry</button></div>
      ) : filtered.length === 0 ? (
        <div className="dev-empty"><p>Belum ada workspace.</p></div>
      ) : (
        <div className="dev-table-wrap">
          <table className="dev-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Slug</th>
                <th>Dibuat</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Sheets</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ws) => (
                <tr key={ws.id} className={!ws.is_active ? 'dev-row-inactive' : ''}>
                  <td><strong>{ws.owner_name}</strong></td>
                  <td><code>{ws.slug}</code></td>
                  <td>{new Date(ws.created_at).toLocaleDateString('id-ID')}</td>
                  <td>
                    <span className={cn('dev-status', ws.is_active ? 'dev-status-active' : 'dev-status-inactive')}>
                      {ws.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td>
                    <span className={cn('dev-status', ws.has_paid ? 'dev-status-paid' : 'dev-status-free')}>
                      {ws.has_paid ? 'Paid' : 'Free'}
                    </span>
                  </td>
                  <td className="dev-sheets-count">—</td>
                  <td className="dev-actions">
                    <a href={`/?w=${ws.slug}`} target="_blank" rel="noopener noreferrer" className="dev-btn dev-btn-view" title="Buka workspace">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                    <button className={cn('dev-btn', ws.is_active ? 'dev-btn-revoke' : 'dev-btn-activate')} onClick={() => toggleActive(ws)} disabled={actionLoading === ws.id} title={ws.is_active ? 'Nonaktifkan' : 'Aktifkan'}>
                      {ws.is_active ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </button>
                    <button className={cn('dev-btn', ws.has_paid ? 'dev-btn-free' : 'dev-btn-paid')} onClick={() => togglePaid(ws)} disabled={actionLoading === ws.id} title={ws.has_paid ? 'Set Free' : 'Set Paid'}>
                      {ws.has_paid ? '$' : '💳'}
                    </button>
                    <button className="dev-btn dev-btn-delete" onClick={() => deleteWorkspace(ws)} disabled={actionLoading === ws.id} title="Hapus">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      <div className="dev-summary">
        <div className="dev-stat-card"><span className="dev-stat-num">{workspaces.length}</span><span>Total Workspace</span></div>
        <div className="dev-stat-card"><span className="dev-stat-num">{workspaces.filter(w => w.is_active).length}</span><span>Active</span></div>
        <div className="dev-stat-card"><span className="dev-stat-num">{workspaces.filter(w => !w.is_active).length}</span><span>Revoked</span></div>
        <div className="dev-stat-card"><span className="dev-stat-num">{workspaces.filter(w => w.has_paid).length}</span><span>Paid</span></div>
      </div>

      {toast && (
        <div className={cn('dev-toast', toast.type === 'error' ? 'dev-toast-error' : 'dev-toast-success')} role="alert">
          {toast.msg}
        </div>
      )}

      {/* ─── Trial Users Section ─── */}
      <div className="dev-trial-users-section">
        <h3>Trial Users</h3>
        {(() => {
          const trialUsers = workspaces.filter((w) => w.is_trial);
          if (trialUsers.length === 0) {
            return <p className="dev-hint">Belum ada user trial.</p>;
          }
          return (
            <div className="dev-table-wrap">
              <table className="dev-table">
                <thead>
                  <tr>
                    <th>Workspace</th>
                    <th>Slug</th>
                    <th>Trial Status</th>
                    <th>Payment</th>
                    <th>Expires At</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {trialUsers.map((ws) => {
                    const trialLink = trialLinks.find((tl) => tl.id === ws.trial_link_id);
                    const perUserEndsAt = ws.trial_ends_at || (trialLink ? trialLink.expires_at : null);
                    const isExpired = ws.trial_expired || (perUserEndsAt ? new Date(perUserEndsAt) < new Date() : false);
                    const isActive = ws.is_active && !isExpired;

                    return (
                      <tr key={ws.id} className={!isActive ? 'dev-row-inactive' : ''}>
                        <td><strong>{ws.owner_name}</strong></td>
                        <td><code>{ws.slug}</code></td>
                        <td>
                          <span className={cn('dev-status', isActive ? 'dev-status-active' : 'dev-status-expired')}>
                            {isActive ? 'Active' : 'Expired'}
                          </span>
                        </td>
                        <td>
                          <span className={cn('dev-status', ws.has_paid ? 'dev-status-paid' : 'dev-status-free')}>
                            {ws.has_paid ? 'Paid' : 'Free'}
                          </span>
                        </td>
                        <td>
                          {perUserEndsAt ? (
                            <>
                              {new Date(perUserEndsAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              <br />
                              <TrialCountdown endTime={perUserEndsAt} />
                            </>
                          ) : '—'}
                        </td>
                        <td className="dev-actions">
                          {!isActive && (
                            <button className="dev-btn dev-btn-activate" onClick={() => activateTrialUser(ws)} disabled={actionLoading === ws.id} title="Activate setelah user bayar">
                              Activate
                            </button>
                          )}
                          <a href={`/?w=${ws.slug}`} target="_blank" rel="noopener noreferrer" className="dev-btn dev-btn-view" title="Buka workspace">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
        </>
  )}
</div>
);
}

// ─── Dev Sheets Hub (mini app inside dev panel) ────────────────────
function DevSheetsHub({ onExit, onBackToAdmin }: { onExit: () => void; onBackToAdmin: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sheets, setSheets] = useState<ContentPlanSheet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [viewportH, setViewportH] = useState(720);
  const [copied, setCopied] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [iframeError, setIframeError] = useState(false);

  const toast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  // Get or create dev workspace
  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from('workspaces').select(PUBLIC_WORKSPACE_FIELDS).eq('slug', 'dev-admin').single();
      if (!err && data) {
        const ws = data as Workspace;
        setWorkspace(ws);
        if (!ws.is_active) return;
        const { data: sheetsData } = await supabase.from('content_plan_sheets').select('*').eq('workspace_id', ws.id).eq('status', 'active').order('updated_at', { ascending: false });
        setSheets(sheetsData as ContentPlanSheet[]);
        if (sheetsData && sheetsData.length > 0 && !sheetsData.some((s: ContentPlanSheet) => s.id === selectedId)) {
          setSelectedId(sheetsData[0].id);
        }
      } else {
        // Create dev workspace
        const { data: newWs } = await supabase.from('workspaces').insert({ slug: 'dev-admin', owner_name: 'Developer' }).select().single();
        if (newWs) setWorkspace(newWs as Workspace);
      }
      setLoading(false);
    })();
  }, []);

  // Realtime
  useEffect(() => {
    if (!workspace) return;
    const channel = supabase.channel('dev-cps').on('postgres_changes', { event: '*', schema: 'public', table: 'content_plan_sheets' }, () => {
      if (!workspace) return;
      supabase.from('content_plan_sheets').select('*').eq('workspace_id', workspace.id).eq('status', 'active').order('updated_at', { ascending: false }).then(({ data }) => {
        if (data) setSheets(data as ContentPlanSheet[]);
      });
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspace]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sheets;
    const q = search.toLowerCase();
    return sheets.filter(s => s.client_name.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || (s.platform ?? '').toLowerCase().includes(q));
  }, [sheets, search]);

  const selected = sheets.find((s) => s.id === selectedId) ?? null;

  const handleCopyLink = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.sheet_url); setCopied(true); toast('success', 'Tersalin'); setTimeout(() => setCopied(false), 2000); }
    catch { toast('error', 'Gagal menyalin link.'); }
  };

  const handleAfterConnect = () => { setShowConnect(false); if (workspace) { supabase.from('content_plan_sheets').select('*').eq('workspace_id', workspace.id).eq('status', 'active').order('updated_at', { ascending: false }).then(({ data }) => { if (data) setSheets(data as ContentPlanSheet[]); }); } };
  const handleAfterEdit = () => { setShowEdit(false); if (workspace) { supabase.from('content_plan_sheets').select('*').eq('workspace_id', workspace.id).eq('status', 'active').order('updated_at', { ascending: false }).then(({ data }) => { if (data) setSheets(data as ContentPlanSheet[]); }); } };
  const handleAfterDelete = () => { setShowDelete(false); if (workspace) { supabase.from('content_plan_sheets').select('*').eq('workspace_id', workspace.id).eq('status', 'active').order('updated_at', { ascending: false }).then(({ data }) => { if (data) setSheets(data as ContentPlanSheet[]); }); if (!sheets.find((s) => s.id === selectedId)) { const r = sheets.filter((s) => s.id !== selectedId); setSelectedId(r.length > 0 ? r[0].id : null); } } };

  if (!workspace) return <div className="dev-loading"><Skeleton className="skeleton-line" style={{ width: '100%', height: 48 }} /></div>;
  if (!workspace.is_active) return <RevokedPage workspace={workspace} />;

  return (
    <div className="dev-sheets-hub">
      <div className="dev-sheets-banner">
        <span>Workspace: <strong>{workspace.owner_name}</strong></span>
        <button className="btn-outline-sm" onClick={onBackToAdmin}>← Kembali ke Admin</button>
      </div>

      <header className="app-header">
        <div className="app-header-left">
          <div className="app-header-icon"><img src={logoImg} alt="Logo" className="app-header-logo-img" /></div>
          <div className="app-header-text"><h1>Spreadsheets Hub Manager</h1><p>Developer Sheets — workspace pribadi</p></div>
        </div>
        <div className="app-header-right">
          <button className="btn-primary-lg" onClick={() => setShowConnect(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Hubungkan Sheet
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="client-panel">
          <div className="client-panel-header">
            <label className="client-panel-label">Klien / Brand</label>
            <div className="client-search-wrap">
              <svg className="client-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input className="client-search-input" placeholder="Cari..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="client-tabs-wrap">
            {loading ? (<div className="client-tabs"><ClientTabSkeleton /><ClientTabSkeleton /></div>) : filtered.length === 0 ? (
              <div className="client-empty"><p>Belum ada sheet.</p><button className="btn-outline" onClick={() => setShowConnect(true)}>Hubungkan Pertama</button></div>
            ) : (
              <div className="client-tabs" role="tablist">
                {filtered.map((s) => (<button key={s.id} className={cn('client-tab', s.id === selectedId && 'client-tab-active')} onClick={() => { setSelectedId(s.id); setIframeError(false); }}><ClientAvatar name={s.client_name} logoUrl={s.logo_url} size={28} /><span className="client-tab-name">{s.client_name}</span>{s.platform && <span className="client-tab-badge">{s.platform.split(' ')[0]}</span>}</button>))}
              </div>
            )}
          </div>
        </aside>

        <main className="sheet-panel">
          {!selected ? (<div className="sheet-panel-empty"><p>Pilih klien atau hubungkan sheet baru.</p></div>) : (
            <>
              <div className="sheet-header">
                <div className="sheet-header-left"><ClientAvatar name={selected.client_name} logoUrl={selected.logo_url} size={36} /><div className="sheet-header-info"><span className="sheet-client-badge">{selected.client_name}</span>{selected.platform && <span className="sheet-platform-badge">{selected.platform}</span>}<h2 className="sheet-title-text">{selected.title}</h2></div></div>
                <div className="sheet-header-actions">
                  <div className="zoom-controls">
                    <button className="zoom-btn" onClick={() => setZoom(Math.max(60, zoom - 15))} disabled={zoom <= 60} aria-label="Zoom out"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>
                    <button className="zoom-reset-btn" onClick={() => setZoom(100)}>{zoom}%</button>
                    <button className="zoom-btn" onClick={() => setZoom(Math.min(200, zoom + 15))} disabled={zoom >= 200} aria-label="Zoom in"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>
                  </div>
                  <select className="viewport-select" value={viewportH} onChange={(e) => setViewportH(Number(e.target.value))}><option value={500}>500px</option><option value={720}>720px</option><option value={900}>900px</option></select>
                  <button className="action-btn" onClick={handleCopyLink} aria-label="Salin Link">{copied ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F9D78" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}<span className="action-btn-label">{copied ? 'Tersalin' : 'Salin'}</span></button>
                  <a href={selected.sheet_url} target="_blank" rel="noopener noreferrer" className="action-btn" aria-label="Buka"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span className="action-btn-label">Buka</span></a>
                  <button className="action-btn" onClick={() => setShowEdit(true)} aria-label="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span className="action-btn-label">Edit</span></button>
                  <button className="action-btn action-btn-danger" onClick={() => setShowDelete(true)} aria-label="Hapus"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg><span className="action-btn-label">Hapus</span></button>
                  <button className="action-btn action-btn-focus" onClick={() => { setFocusMode(true); setIframeError(false); }} aria-label="Focus"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg><span className="action-btn-label">Focus</span></button>
                </div>
              </div>
              <div className="sheet-iframe-wrap" style={{ height: viewportH }}>
                {!iframeError ? (<iframe src={selected.embed_url || toEmbedUrl(selected.sheet_url)} className="sheet-iframe" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left', width: `${10000 / zoom}%`, height: `${10000 / zoom}%` }} allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" title={selected.title} />) : (<div className="iframe-fallback"><p>Tidak dapat memuat.</p><a href={selected.sheet_url} target="_blank" rel="noopener noreferrer" className="fallback-link">Buka di Google Sheets</a></div>)}
              </div>
            </>
          )}
        </main>
      </div>

      <ConnectModal open={showConnect} onClose={() => setShowConnect(false)} onSuccess={handleAfterConnect} workspaceId={workspace.id} toast={toast} />
      {selected && <EditModal open={showEdit} onClose={() => setShowEdit(false)} sheet={selected} onSuccess={handleAfterEdit} toast={toast} />}
      {selected && <DeleteModal open={showDelete} onClose={() => setShowDelete(false)} sheet={selected} onSuccess={handleAfterDelete} toast={toast} />}
      {focusMode && selected && <FocusModeOverlay sheet={selected} onClose={() => setFocusMode(false)} zoom={zoom} setZoom={setZoom} />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ─── Connect Modal ─────────────────────────────────────────────────
function ConnectModal({ open, onClose, onSuccess, workspaceId, toast }: {
  open: boolean; onClose: () => void; onSuccess: () => void; workspaceId: string;
  toast: (type: ToastMessage['type'], msg: string) => void;
}) {
  const handleSubmit = async (data: SheetFormData) => {
    let logoUrl = data.logoUrl;
    if (data.logoFile) {
      const fileName = `logos/${Date.now()}-${data.logoFile.name.replace(/\s+/g, '_')}`;
      const { data: uploadData, error: uploadError } = await supabase.storage.from('content-plan-logos').upload(fileName, data.logoFile, { contentType: data.logoFile.type });
      if (uploadError) { toast('error', 'Gagal mengupload logo.'); }
      else { const { data: urlData } = supabase.storage.from('content-plan-logos').getPublicUrl(uploadData.path); logoUrl = urlData.publicUrl; }
    }

    const { error } = await supabase.from('content_plan_sheets').insert({
      workspace_id: workspaceId, client_name: data.clientName, title: data.title || `Spreadsheet ${data.clientName}`,
      sheet_url: data.sheetUrl, embed_url: toEmbedUrl(data.sheetUrl), platform: data.platform, logo_url: logoUrl || null, status: 'active',
    });
    if (error) { toast('error', `Gagal menyimpan: ${error.message}`); return; }
    toast('success', `Sheet "${data.title}" berhasil dihubungkan.`);
    onSuccess();
  };

  return (
    <ModalBase open={open} onClose={onClose} title="Hubungkan Sheet Baru" size="lg">
      <SheetForm onSubmit={handleSubmit} onCancel={onClose} submitLabel="Hubungkan Sheet" />
    </ModalBase>
  );
}

// ─── Edit Modal ────────────────────────────────────────────────────
function EditModal({ open, onClose, sheet, onSuccess, toast }: {
  open: boolean; onClose: () => void; sheet: ContentPlanSheet;
  onSuccess: () => void; toast: (type: ToastMessage['type'], msg: string) => void;
}) {
  const initial: SheetFormData = {
    clientName: sheet.client_name, title: sheet.title, sheetUrl: sheet.sheet_url,
    platform: sheet.platform ?? PLATFORMS[0], logoUrl: sheet.logo_url ?? '', logoFile: null,
  };

  const handleSubmit = async (data: SheetFormData) => {
    let logoUrl = sheet.logo_url;
    if (data.logoFile) {
      const fileName = `logos/${Date.now()}-${data.logoFile.name.replace(/\s+/g, '_')}`;
      const { data: uploadData } = await supabase.storage.from('content-plan-logos').upload(fileName, data.logoFile, { contentType: data.logoFile.type });
      if (uploadData) { const { data: urlData } = supabase.storage.from('content-plan-logos').getPublicUrl(uploadData.path); logoUrl = urlData.publicUrl; }
    } else if (data.logoUrl) { logoUrl = data.logoUrl; }

    const { error } = await supabase.from('content_plan_sheets').update({
      client_name: data.clientName, title: data.title, sheet_url: data.sheetUrl,
      embed_url: toEmbedUrl(data.sheetUrl), platform: data.platform, logo_url: logoUrl, updated_at: new Date().toISOString(),
    }).eq('id', sheet.id);
    if (error) { toast('error', `Gagal memperbarui: ${error.message}`); return; }
    toast('success', `Sheet "${data.title}" berhasil diperbarui.`);
    onSuccess();
  };

  return (
    <ModalBase open={open} onClose={onClose} title="Edit Spreadsheet" size="lg">
      <SheetForm initial={initial} onSubmit={handleSubmit} onCancel={onClose} submitLabel="Simpan Perubahan" />
    </ModalBase>
  );
}

// ─── Delete Modal ──────────────────────────────────────────────────
function DeleteModal({ open, onClose, sheet, onSuccess, toast }: {
  open: boolean; onClose: () => void; sheet: ContentPlanSheet;
  onSuccess: () => void; toast: (type: ToastMessage['type'], msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    const { error } = await supabase.from('content_plan_sheets').delete().eq('id', sheet.id);
    setLoading(false);
    if (error) { toast('error', `Gagal menghapus: ${error.message}`); return; }
    toast('success', `Koneksi ke "${sheet.title}" berhasil dihapus.`);
    onSuccess();
  };

  return (
    <ModalBase open={open} onClose={onClose} title="Hapus Link Spreadsheet" size="sm">
      <div className="delete-modal-content">
        <div className="delete-info">
          <p>Anda akan menghapus koneksi untuk:</p>
          <div className="delete-target">
            <ClientAvatar name={sheet.client_name} logoUrl={sheet.logo_url} size={36} />
            <div><strong>{sheet.client_name}</strong><span>{sheet.title}</span></div>
          </div>
          <p className="delete-warning">Link ini akan hilang untuk seluruh anggota workspace. File Google Sheets asli <strong>tidak</strong> dihapus.</p>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>Batal</button>
          <button className="btn-danger" onClick={handleDelete} disabled={loading}>{loading ? 'Menghapus...' : 'Hapus Link'}</button>
        </div>
      </div>
    </ModalBase>
  );
}

// ─── Trial Locked Page (setelah acknowledge modal) ─────────────────
function TrialLockedPage({ workspace, trialExpiresAt }: { workspace: Workspace; trialExpiresAt?: string }) {
  const [waNumber, setWaNumber] = useState(WHATSAPP_NUMBER);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [reactivated, setReactivated] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await loadAppSettings();
      setSettings(s);
      setWaNumber(s.whatsapp_number || WHATSAPP_NUMBER);
    })();
  }, []);

  // Cek realtime — jika workspace sudah aktif lagi, redirect
  useEffect(() => {
    const channel = supabase.channel('locked-check')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspaces' }, (payload) => {
        const updated = payload.new as Workspace;
        if (updated.id === workspace.id && updated.is_active && !updated.is_trial) {
          setReactivated(true);
        }
      })
      .subscribe();
    if (reactivated) {
      clearWorkspaceFromStorage();
      window.location.reload();
    }
    return () => { supabase.removeChannel(channel); };
  }, [workspace, reactivated]);

  const paymentAmount = settings.payment_amount || DEFAULT_SETTINGS.payment_amount || 'Rp 150.000';
  const paymentNote = settings.payment_note || DEFAULT_SETTINGS.payment_note || 'Total Pembayaran';
  const waText = `Halo, saya ${workspace.owner_name}. Masa trial saya sudah berakhir dan saya ingin konfirmasi pembayaran ${paymentAmount} untuk mengaktifkan akun.`;
  const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`;
  const expiredDate = trialExpiresAt
    ? new Date(trialExpiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : workspace.trial_ends_at
      ? new Date(workspace.trial_ends_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

  return (
    <div className="trial-modal-backdrop">
      <div className="trial-modal-content trial-locked-modal trial-expired-2col">
        <div className="trial-expired-left">
          <div className="trial-locked-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>
          </div>
          <h2>Akun Terkunci</h2>
          <p className="trial-locked-subtitle">Masa trial workspace <strong>{workspace.owner_name}</strong> telah berakhir.</p>
          <div className="trial-locked-info">
            <div className="trial-locked-row">
              <span className="trial-locked-label">Status</span>
              <span className="trial-locked-status">Locked</span>
            </div>
            <div className="trial-locked-divider" />
            <div className="trial-locked-row">
              <span className="trial-locked-label">Trial berakhir</span>
              <span className="trial-locked-value">{expiredDate}</span>
            </div>
          </div>
          <p className="trial-locked-hint">Silakan scan QR di samping untuk pembayaran dan konfirmasi melalui WhatsApp.</p>
          <div className="trial-locked-actions">
            <a href={waUrl} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Hubungi via WhatsApp
            </a>
            <button className="btn-text-close" onClick={() => { clearWorkspaceFromStorage(); window.location.href = '/'; }}>Kembali ke Landing Page</button>
          </div>
        </div>
        <div className="trial-expired-right">
          <div className="trial-payment-header">
            <span className="trial-payment-keterangan">{paymentNote}</span>
            <div className="trial-payment-nominal">{paymentAmount}</div>
          </div>
          <img src={qrImg} alt="QR Pembayaran" className="trial-qr-img" />
        </div>
      </div>
    </div>
  );
}

// ─── Revoked Page (workspace dinonaktifkan) ────────────────────────
function RevokedPage({ workspace }: { workspace: Workspace }) {
  const [waNumber, setWaNumber] = useState(WHATSAPP_NUMBER);
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const s = await loadAppSettings();
      setSettings(s);
      setWaNumber(s.whatsapp_number || WHATSAPP_NUMBER);
    })();
  }, []);

  // Auto-refresh — cek apakah workspace sudah diaktifkan
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.from('workspaces').select(PUBLIC_WORKSPACE_FIELDS).eq('id', workspace.id).single();
      if (data && (data as Workspace).is_active) {
        window.location.reload();
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [workspace.id]);

  const isTrialExpired = workspace.is_trial || workspace.trial_expired;
  const paymentAmount = settings.payment_amount || DEFAULT_SETTINGS.payment_amount || 'Rp 150.000';
  const paymentNote = settings.payment_note || DEFAULT_SETTINGS.payment_note || 'Total Pembayaran';
  const waText = isTrialExpired 
    ? `Halo, saya pemilik workspace ${workspace.owner_name}. Masa limit trial saya sudah habis dan saya ingin melakukan pembayaran ${paymentAmount} untuk mengaktifkan akun.`
    : `Halo, saya pemilik workspace ${workspace.owner_name}. Akun saya dinonaktifkan dan saya ingin mengaktifkannya kembali.`;
  const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`;

  // Khusus akun yang limit trial habis — tampilkan layout 2 kolom dengan QR pembayaran & tombol WhatsApp
  if (isTrialExpired) {
    return (
      <div className="revoked-page">
        <div className="trial-modal-content trial-locked-modal trial-expired-2col">
          <div className="trial-expired-left">
            <div className="trial-locked-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>
            </div>
            <h2>Akses Ditangguhkan</h2>
            <p className="trial-locked-subtitle">Masa limit trial workspace <strong>{workspace.owner_name}</strong> telah habis.</p>
            <div className="trial-locked-info">
              <div className="trial-locked-row">
                <span className="trial-locked-label">Status</span>
                <span className="trial-locked-status">Trial Limit Habis</span>
              </div>
              <div className="trial-locked-divider" />
              <div className="trial-locked-row">
                <span className="trial-locked-label">Workspace</span>
                <span className="trial-locked-value">{workspace.owner_name}</span>
              </div>
            </div>
            <p className="trial-locked-hint">Silakan scan QR di samping untuk pembayaran dan kirimkan bukti ke WhatsApp agar akun langsung diaktifkan kembali.</p>
            <div className="trial-locked-actions">
              <a href={waUrl} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Konfirmasi Pembayaran via WhatsApp
              </a>
              <button className="btn-text-close" onClick={() => { clearWorkspaceFromStorage(); window.location.href = '/'; }}>Kembali ke Landing Page</button>
            </div>
          </div>
          <div className="trial-expired-right">
            <div className="trial-payment-header">
              <span className="trial-payment-keterangan">{paymentNote}</span>
              <div className="trial-payment-nominal">{paymentAmount}</div>
            </div>
            <img src={qrImg} alt="QR Pembayaran" className="trial-qr-img" />
          </div>
        </div>
      </div>
    );
  }

  // Non-trial / manual suspension:
  return (
    <div className="revoked-page">
      <div className="revoked-card">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <h2>Akses Ditangguhkan</h2>
        <p>Workspace <strong>{workspace.owner_name}</strong> telah dinonaktifkan.</p>
        {workspace.revoke_reason && <p className="revoked-reason">{workspace.revoke_reason}</p>}
        <p className="revoked-hint">Silakan hubungi developer untuk mengaktifkan kembali.</p>
        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="btn-whatsapp" style={{ width: '100%', maxWidth: '320px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Hubungi via WhatsApp
          </a>
          <button className="btn-text-close" onClick={() => { clearWorkspaceFromStorage(); window.location.href = '/'; }}>Kembali ke Landing Page</button>
        </div>
      </div>
    </div>
  );
}

// ─── Trial Locked Page (trial expired) ─────────────────────────────
function TrialExpiredModal({ workspace, trialExpiresAt, onAcknowledge }: { workspace: Workspace; trialExpiresAt?: string; onAcknowledge: () => void }) {
  const [waNumber, setWaNumber] = useState(WHATSAPP_NUMBER);
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const s = await loadAppSettings();
      setSettings(s);
      setWaNumber(s.whatsapp_number || WHATSAPP_NUMBER);
    })();
  }, []);

  const paymentAmount = settings.payment_amount || DEFAULT_SETTINGS.payment_amount || 'Rp 150.000';
  const paymentNote = settings.payment_note || DEFAULT_SETTINGS.payment_note || 'Total Pembayaran';
  const waText = `Halo, saya ${workspace.owner_name}. Masa trial saya sudah berakhir dan saya ingin konfirmasi pembayaran ${paymentAmount} untuk mengaktifkan akun.`;
  const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`;
  const expiredDate = trialExpiresAt
    ? new Date(trialExpiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : workspace.trial_ends_at
      ? new Date(workspace.trial_ends_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

  return (
    <div className="trial-modal-backdrop">
      <div className="trial-modal-content trial-expired-modal trial-expired-2col">
        <div className="trial-expired-left">
          <div className="trial-expired-icon-wrap">
            <svg className="trial-expired-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <h2>Masa Trial Telah Berakhir</h2>
          <p className="trial-expired-subtitle">
            Workspace <strong>{workspace.owner_name}</strong> telah mencapai batas masa trial.
          </p>
          <div className="trial-expired-card">
            <div className="trial-expired-row">
              <span className="trial-expired-label">Status</span>
              <span className="trial-expired-status">Expired</span>
            </div>
            <div className="trial-expired-divider" />
            <div className="trial-expired-row">
              <span className="trial-expired-label">Berakhir pada</span>
              <span className="trial-expired-value">{expiredDate}</span>
            </div>
          </div>
          <p className="trial-expired-hint">Silakan scan QR di samping untuk pembayaran dan konfirmasi melalui WhatsApp.</p>
          <div className="trial-expired-actions">
            <a href={waUrl} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Hubungi via WhatsApp
            </a>
            <button className="btn-text-close" onClick={onAcknowledge}>Mengerti, tutup</button>
          </div>
        </div>
        <div className="trial-expired-right">
          <div className="trial-payment-header">
            <span className="trial-payment-keterangan">{paymentNote}</span>
            <div className="trial-payment-nominal">{paymentAmount}</div>
          </div>
          <img src={qrImg} alt="QR Pembayaran" className="trial-qr-img" />
        </div>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [wsLoading, setWsLoading] = useState(true);
  const [wsError, setWsError] = useState<string | null>(null);
  const [workspaceChecked, setWorkspaceChecked] = useState(false);
  const [devMode] = useState(getDevMode());
  const [trialCode, setTrialCode] = useState<string | null>(null);
  const [trialExpired, setTrialExpired] = useState(false);
  const [trialExpiresAt, setTrialExpiresAt] = useState<string | null>(null);

  const [sheets, setSheets] = useState<ContentPlanSheet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [viewportH, setViewportH] = useState(720);
  const [copied, setCopied] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [iframeError, setIframeError] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('theme') === 'dark'; } catch { return false; } });

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  const toast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  // Resolve workspace from URL
  useEffect(() => {
    if (devMode) { setWorkspaceChecked(true); return; }

    // Cek trial link dari URL
    const urlTrialCode = getTrialCodeFromUrl();
    if (urlTrialCode) {
      setTrialCode(urlTrialCode);
      // Trial link: jangan resolve workspace, tampilkan landing page dengan trial mode
      setWorkspaceChecked(true);
      return;
    }

    const slug = getWorkspaceSlug();
    if (!slug) { setWorkspaceChecked(true); return; }

    (async () => {
      setWsLoading(true);
      const { data, error: err } = await supabase.from('workspaces').select(PUBLIC_WORKSPACE_FIELDS).eq('slug', slug).single();
      if (err || !data) { setWsError('Workspace tidak ditemukan.'); setWsLoading(false); setWorkspaceChecked(true); return; }
      const ws = data as Workspace;

      // Cek trial status — per-user expiry based on trial_ends_at
      if (ws.is_trial && ws.trial_ends_at) {
        const now = new Date();
        const trialEndsAt = new Date(ws.trial_ends_at);
        if (trialEndsAt < now) {
          // Trial expired — update workspace flag dan tampilkan locked page
          setTrialExpired(true);
          setTrialExpiresAt(ws.trial_ends_at);
          await supabase.rpc('mark_trial_expired', { p_workspace_id: ws.id });
          setWorkspace(ws);
          setWsLoading(false);
          setWorkspaceChecked(true);
          return;
        }
        setTrialExpiresAt(ws.trial_ends_at);
      } else if (ws.is_trial && ws.trial_link_id) {
        // Legacy: fallback ke trial_link expires_at jika trial_ends_at belum diset
        const { data: trialData } = await supabase.from('trial_links').select('*').eq('id', ws.trial_link_id).single();
        if (trialData) {
          const tl = trialData as TrialLink;
          const now = new Date();
          const expiresAt = new Date(tl.expires_at);
          if (!tl.is_active || expiresAt < now) {
            setTrialExpired(true);
            setTrialExpiresAt(tl.expires_at);
            await supabase.rpc('mark_trial_expired', { p_workspace_id: ws.id });
            setWorkspace(ws);
            setWsLoading(false);
            setWorkspaceChecked(true);
            return;
          }
          setTrialExpiresAt(tl.expires_at);
        }
      }

      if (!ws.is_active) { setWorkspace(ws); setWsLoading(false); setWorkspaceChecked(true); return; }
      setWorkspace(ws);
      setWsLoading(false);
      setWorkspaceChecked(true);
    })();
  }, [devMode]);

  // Fetch sheets
  const fetchSheets = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setFetchError(null);
    const { data, error: err } = await supabase.from('content_plan_sheets').select('*').eq('workspace_id', workspace.id).eq('status', 'active').order('updated_at', { ascending: false });
    if (err) { setFetchError(err.message); setLoading(false); return; }
    setSheets(data as ContentPlanSheet[]);
    setLoading(false);
    if (data.length > 0) {
      const exists = data.some((s) => s.id === selectedId);
      if (!exists || !selectedId) setSelectedId(data[0].id);
    } else { setSelectedId(null); }
  }, [workspace, selectedId]);

  useEffect(() => {
    if (workspace && workspace.is_active) fetchSheets();
  }, [workspace, fetchSheets]);

  // Realtime
  useEffect(() => {
    if (!workspace) return;
    const channel = supabase.channel('cps-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'content_plan_sheets' }, () => { fetchSheets(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspace, fetchSheets]);

  const handleCreateWorkspace = async (name: string, password: string, trialCodeParam?: string) => {
    const { data: slug, error: slugErr } = await supabase.rpc('generate_workspace_slug', { name });
    if (slugErr || !slug) throw new Error(slugErr?.message || 'Gagal generate slug');

    // Jika ada trial code, validasi dulu
    let trialLinkId: string | null = null;
    let isTrial = false;
    let trialDurationHours = 0;
    if (trialCodeParam) {
      const { data: tl, error: tlErr } = await supabase.from('trial_links')
        .select('*')
        .eq('link_code', trialCodeParam)
        .eq('is_active', true)
        .single();

      if (tlErr || !tl) {
        throw new Error('Trial link tidak valid atau sudah tidak aktif. Hubungi developer untuk link baru.');
      }

      const trialLink = tl as TrialLink;
      const now = new Date();
      const expiresAt = new Date(trialLink.expires_at);
      if (expiresAt < now) {
        throw new Error('Masa trial telah berakhir. Hubungi developer untuk link baru.');
      }

      // Cek apakah user ini sudah pernah pakai link ini sebelumnya
      // Gunakan nama owner sebagai identifikasi user
      const usedByStr = (trialLink.used_by as string) || '';
      const normalizedName = name.toLowerCase().trim();
      if (usedByStr.split(',').map((s: string) => s.trim()).includes(normalizedName)) {
        throw new Error(`Workspace "${name}" sudah pernah mendaftar dengan link ini. Gunakan nama lain atau link baru.`);
      }

      // Tambahkan nama ke used_by (comma-separated string)
      const newUsedBy = usedByStr ? `${usedByStr},${normalizedName}` : normalizedName;
      await supabase.from('trial_links')
        .update({ used_by: newUsedBy })
        .eq('id', trialLink.id);

      trialLinkId = trialLink.id;
      isTrial = true;
      // Gunakan trial_duration_minutes (akurat), fallback ke hours jika belum ada
      const durationMinutes = (trialLink as TrialLink).trial_duration_minutes;
      trialDurationHours = durationMinutes ? durationMinutes / 60 : (trialLink.trial_duration_hours ?? 36);
    }

    const now = new Date();
    const insertData: any = { slug, owner_name: name, is_trial: isTrial };
    if (trialLinkId) {
      insertData.trial_link_id = trialLinkId;
      insertData.trial_started_at = now.toISOString();
      insertData.trial_ends_at = new Date(now.getTime() + trialDurationHours * 60 * 60 * 1000).toISOString();
    }
    if (password) insertData.password = password;

    const { data: ws, error: insertErr } = await supabase.from('workspaces').insert(insertData).select(PUBLIC_WORKSPACE_FIELDS).single();
    if (insertErr || !ws) throw new Error(insertErr?.message || 'Gagal membuat workspace');
    saveWorkspaceToStorage(ws.slug, name);
    window.location.href = `/?w=${ws.slug}`;
  };

  const handleEnterWorkspace = async (namePrefix: string, password: string): Promise<boolean> => {
    // Autentikasi workspace via Database RPC (tanpa membocorkan kolom password ke Network JSON response)
    const { data, error: err } = await supabase.rpc('authenticate_workspace', {
      p_name: namePrefix.trim(),
      p_password: password.trim()
    });
    if (err || !data || (data as any[]).length === 0) return false;
    const ws = (data as Workspace[])[0];
    if (!ws.is_active) { setWorkspace(ws); setWsLoading(false); setWorkspaceChecked(true); return true; }
    setWorkspace(ws);
    saveWorkspaceToStorage(ws.slug, ws.owner_name);
    setWsLoading(false);
    setWorkspaceChecked(true);
    return true;
  };

  const selected = sheets.find((s) => s.id === selectedId) ?? null;
  const filteredSheets = useMemo(() => {
    if (!search.trim()) return sheets;
    const q = search.toLowerCase();
    return sheets.filter(s => s.client_name.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || (s.platform ?? '').toLowerCase().includes(q));
  }, [sheets, search]);

  const handleCopyLink = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.sheet_url); setCopied(true); toast('success', 'Tersalin'); setTimeout(() => setCopied(false), 2000); }
    catch { toast('error', 'Gagal menyalin link.'); }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setIframeError(false);
  };
  const handleAfterConnect = () => { setShowConnect(false); fetchSheets(); };
  const handleAfterEdit = () => { setShowEdit(false); fetchSheets(); };
  const handleAfterDelete = () => {
    setShowDelete(false);
    fetchSheets();
    if (!sheets.find((s) => s.id === selectedId)) {
      const remaining = sheets.filter((s) => s.id !== selectedId);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const [showTrialExpiredModal, setShowTrialExpiredModal] = useState(false);
  const [showDeactivatedModal, setShowDeactivatedModal] = useState(false);

  // Realtime untuk workspace — detect deactivate & reactivate
  useEffect(() => {
    if (!workspace) return;
    const wsChannel = supabase.channel('ws-deactivate-check')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspaces' }, (payload) => {
        const updated = payload.new as Workspace;
        if (updated.id === workspace.id) {
          if (!updated.is_active && workspace.is_active) {
            // Workspace baru saja dinonaktifkan
            setWorkspace(updated);
            setShowDeactivatedModal(true);
          } else if (updated.is_active && !workspace.is_active) {
            // Workspace baru saja diaktifkan kembali — tutup modal, reload
            setWorkspace(updated);
            setShowDeactivatedModal(false);
            setShowTrialExpiredModal(false);
            setTrialExpired(false);
            // Reload sheets karena workspace sudah aktif lagi
            fetchSheets();
          } else {
            // Update data workspace (misal: has_paid berubah)
            setWorkspace(updated);
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(wsChannel); };
  }, [workspace]);

  // Cek trial expired secara realtime — interval setiap 10 detik
  useEffect(() => {
    if (!workspace || !workspace.is_trial || !workspace.trial_ends_at) return;
    const checkExpired = () => {
      if (new Date(workspace.trial_ends_at!) < new Date()) {
        setTrialExpired(true);
        setTrialExpiresAt(workspace.trial_ends_at);
      }
    };
    checkExpired();
    const interval = setInterval(checkExpired, 10000);
    return () => clearInterval(interval);
  }, [workspace]);

  // Developer panel
  if (devMode) {
    return <DeveloperPanel onExit={() => { clearWorkspaceFromStorage(); window.location.href = '/'; }} />;
  }

  // Revoked workspace — tapi cek dulu apakah sudah diaktifkan
  if (workspace && !workspace.is_active) {
    return <RevokedPage workspace={workspace} />;
  }

  // No workspace — show landing (with trial mode if URL has ?trial=xxx)
  if (workspaceChecked && !workspace) {
    return <LandingPage onCreateWorkspace={handleCreateWorkspace} onEnterWorkspace={handleEnterWorkspace} dark={dark} setDark={setDark} trialCode={trialCode} />;
  }

  // Workspace loading
  if (wsLoading) {
    return (
      <div className="app-shell">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%' }} />
        </div>
      </div>
    );
  }

  // Workspace error
  if (wsError) {
    return (
      <div className="app-shell">
        <div className="fetch-error">
          <p>{wsError}</p>
          <button className="btn-outline" onClick={() => window.location.href = '/'}>Kembali ke Landing</button>
        </div>
      </div>
    );
  }

  // Main content
  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-header-icon">
            <img src={logoImg} alt="Sheets Logo" className="app-header-logo-img" />
          </div>
          <div className="app-header-text">
            <div className="header-top-bar">
              <span className="header-workspace-badge">{workspace!.owner_name}</span>
              {workspace!.is_trial ? (
                <>
                  <span className="header-status-badge header-status-trial">Trial</span>
                  {workspace!.trial_ends_at && <TrialCountdown endTime={workspace!.trial_ends_at} />}
                </>
              ) : (
                <span className="header-status-badge header-status-paid">Paid</span>
              )}
            </div>
            <h1>Spreadsheets Hub Manager</h1>
            <p className="header-desc">Spreadsheets Management by Dinur Pradipta</p>
          </div>
        </div>
        <div className="app-header-right">
          <button className="btn-dark-toggle" onClick={() => setDark(!dark)} aria-label={dark ? 'Mode terang' : 'Mode gelap'}>
            {dark ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
          <button className="btn-primary-lg" onClick={() => setShowConnect(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Hubungkan Sheet Baru
          </button>
        </div>
      </header>

      <div className="app-body">
        {/* Client Panel */}
        <aside className="client-panel">
          <div className="client-panel-header">
            <label className="client-panel-label">Pilih Spreadsheet Klien / Brand</label>
            <div className="client-search-wrap">
              <svg className="client-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input className="client-search-input" placeholder="Cari klien, judul, platform..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari spreadsheet" />
            </div>
          </div>

          <div className="client-tabs-wrap">
            {loading ? (
              <div className="client-tabs"><ClientTabSkeleton /><ClientTabSkeleton /><ClientTabSkeleton /></div>
            ) : filteredSheets.length === 0 ? (
              <div className="client-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.3 }}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                <p>{search ? 'Tidak ditemukan hasil untuk pencarian ini.' : 'Belum ada spreadsheet yang dihubungkan.'}</p>
                {!search && <button className="btn-outline" onClick={() => setShowConnect(true)}>Hubungkan Sheet Pertama</button>}
              </div>
            ) : (
              <div className="client-tabs" role="tablist" aria-label="Daftar klien">
                {filteredSheets.map((s) => (
                  <button key={s.id} className={cn('client-tab', s.id === selectedId && 'client-tab-active')} role="tab" aria-selected={s.id === selectedId} onClick={() => handleSelect(s.id)}>
                    <ClientAvatar name={s.client_name} logoUrl={s.logo_url} size={28} />
                    <span className="client-tab-name">{s.client_name}</span>
                    {s.platform && <span className="client-tab-badge">{s.platform.split(' ')[0]}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {fetchError && <div className="fetch-error"><p>Gagal memuat data: {fetchError}</p><button className="btn-outline" onClick={fetchSheets}>Coba Lagi</button></div>}
        </aside>

        {/* Spreadsheet Panel */}
        <main className="sheet-panel">
          {!selected ? (
            <div className="sheet-panel-empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.2 }}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              <p>Pilih klien dari panel kiri atau hubungkan sheet baru.</p>
            </div>
          ) : (
            <>
              <div className="sheet-header">
                <div className="sheet-header-left">
                  <ClientAvatar name={selected.client_name} logoUrl={selected.logo_url} size={36} />
                  <div className="sheet-header-info">
                    <span className="sheet-client-badge">{selected.client_name}</span>
                    {selected.platform && <span className="sheet-platform-badge">{selected.platform}</span>}
                    <h2 className="sheet-title-text">{selected.title}</h2>
                  </div>
                </div>
                <div className="sheet-header-actions">
                  <div className="zoom-controls">
                    <button className="zoom-btn" onClick={() => setZoom(Math.max(60, zoom - 15))} disabled={zoom <= 60} aria-label="Zoom out">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </button>
                    <button className="zoom-reset-btn" onClick={() => setZoom(100)} aria-label={`Reset zoom ke 100%, saat ini ${zoom}%`}>{zoom}%</button>
                    <button className="zoom-btn" onClick={() => setZoom(Math.min(200, zoom + 15))} disabled={zoom >= 200} aria-label="Zoom in">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </button>
                  </div>
                  <select className="viewport-select" value={viewportH} onChange={(e) => setViewportH(Number(e.target.value))} aria-label="Tinggi viewport spreadsheet">
                    <option value={500}>500px</option><option value={720}>720px</option><option value={900}>900px</option>
                  </select>
                  <button className="action-btn" onClick={handleCopyLink} aria-label="Salin link spreadsheet" title="Salin Link">
                    {copied ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F9D78" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
                    <span className="action-btn-label">{copied ? 'Tersalin' : 'Salin'}</span>
                  </button>
                  <a href={selected.sheet_url} target="_blank" rel="noopener noreferrer" className="action-btn" aria-label="Buka di Google Sheets" title="Buka di Google Sheets">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    <span className="action-btn-label">Buka</span>
                  </a>
                  <button className="action-btn" onClick={() => setShowEdit(true)} aria-label="Edit link spreadsheet" title="Edit Link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <span className="action-btn-label">Edit</span>
                  </button>
                  <button className="action-btn action-btn-danger" onClick={() => setShowDelete(true)} aria-label="Hapus link spreadsheet" title="Hapus Link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                    <span className="action-btn-label">Hapus</span>
                  </button>
                  <button className="action-btn action-btn-focus" onClick={() => { setFocusMode(true); setIframeError(false); }} aria-label="Focus Mode" title="Focus Mode">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    <span className="action-btn-label">Focus</span>
                  </button>
                </div>
              </div>

              <div className="sheet-iframe-wrap" style={{ height: viewportH }}>
                {!iframeError ? (
                  <iframe src={selected.embed_url || toEmbedUrl(selected.sheet_url)} className="sheet-iframe" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left', width: `${10000 / zoom}%`, height: `${10000 / zoom}%` }} allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" title={selected.title} />
                ) : (
                  <div className="iframe-fallback">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <p>Tidak dapat memuat spreadsheet.</p>
                    <p className="iframe-fallback-hint">Pastikan file memiliki akses <strong>"Anyone with the link can view/edit"</strong>.</p>
                    <a href={selected.sheet_url} target="_blank" rel="noopener noreferrer" className="fallback-link">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      Buka di Google Sheets
                    </a>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Modals */}
      {workspace && <ConnectModal open={showConnect} onClose={() => setShowConnect(false)} onSuccess={handleAfterConnect} workspaceId={workspace.id} toast={toast} />}
      {selected && <EditModal open={showEdit} onClose={() => setShowEdit(false)} sheet={selected} onSuccess={handleAfterEdit} toast={toast} />}
      {selected && <DeleteModal open={showDelete} onClose={() => setShowDelete(false)} sheet={selected} onSuccess={handleAfterDelete} toast={toast} />}

      {/* Focus Mode */}
      {focusMode && selected && <FocusModeOverlay sheet={selected} onClose={() => setFocusMode(false)} zoom={zoom} setZoom={setZoom} />}

      {/* Trial Expired Modal — muncul otomatis saat trial habis */}
      {workspace && workspace.is_trial && trialExpired && !showTrialExpiredModal && (
        <TrialExpiredModal
          workspace={workspace}
          trialExpiresAt={trialExpiresAt ?? undefined}
          onAcknowledge={() => { setShowTrialExpiredModal(true); clearWorkspaceFromStorage(); }}
        />
      )}

      {/* Trial Locked — setelah modal ditutup, tampilkan halaman terkunci */}
      {workspace && workspace.is_trial && trialExpired && showTrialExpiredModal && (
        <TrialLockedPage workspace={workspace} trialExpiresAt={trialExpiresAt ?? undefined} />
      )}

      {/* Deactivated Modal — muncul otomatis saat workspace dinonaktifkan */}
      {showDeactivatedModal && (
        <div className="trial-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) {} }}>
          <div className="trial-modal-content trial-deactivated-modal">
            <div className="trial-expired-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </div>
            <h2>Akun Dinonaktifkan</h2>
            <p>Workspace <strong>{workspace!.owner_name}</strong> telah dinonaktifkan oleh developer.</p>
            <div className="trial-expired-detail">
              <p>Hubungi kami melalui WhatsApp jika ingin mengaktifkan kembali.</p>
            </div>
            <div className="trial-expired-actions">
              <a href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Halo, workspace ${workspace!.owner_name} saya dinonaktifkan. Saya ingin mengaktifkan kembali.`)}`} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Hubungi via WhatsApp
              </a>
              <button className="btn-secondary" onClick={() => { clearWorkspaceFromStorage(); window.location.href = '/'; }}>
                Kembali ke Landing Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
