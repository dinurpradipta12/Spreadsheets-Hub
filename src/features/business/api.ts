import { supabase } from '../../lib/supabase';
import { createDocument, createDefaultFeeCalculator, createId } from './defaults';
import type {
  BusinessAccess,
  BusinessDocument,
  DocumentKind,
  FeeCalculatorState,
  FeeQuoteDraft,
  PersistenceResult,
  StoredDocument,
} from './types';

const API_FUNCTION = 'business-studio-api';

export class BusinessApiError extends Error {
  code: string;

  constructor(message: string, code = 'business_api_error') {
    super(message);
    this.name = 'BusinessApiError';
    this.code = code;
  }
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function documentsKey(workspaceId: string, kind: DocumentKind): string {
  return `business-documents:${workspaceId}:${kind}`;
}

function pricingKey(workspaceId: string): string {
  return `fee-calculator:${workspaceId}`;
}

export function recoveryDraftKey(workspaceId: string, kind: DocumentKind): string {
  return `business-document-draft:${workspaceId}:${kind}`;
}

function feeDraftKey(workspaceId: string, draftId: string): string {
  return `fee-quote-draft:${workspaceId}:${draftId}`;
}

export function saveBusinessAccess(workspaceId: string, access: BusinessAccess): void {
  if (!storageAvailable()) return;
  localStorage.setItem(`business-access:${workspaceId}`, JSON.stringify(access));
}

export function getBusinessAccess(workspaceId: string): BusinessAccess | null {
  if (!storageAvailable()) return null;
  return parseJson<BusinessAccess>(localStorage.getItem(`business-access:${workspaceId}`));
}

export function clearBusinessAccess(workspaceId?: string): void {
  if (!storageAvailable()) return;
  if (workspaceId) localStorage.removeItem(`business-access:${workspaceId}`);
}

export function hasPageAccess(workspaceId: string, page: string): boolean {
  if (page === 'sheets') return true;
  const access = getBusinessAccess(workspaceId);
  // Every authenticated workspace owner can use all business studios. The
  // server still validates the owner session and scopes every query by the
  // session workspace, so this UI helper must not turn page_access into a
  // second, role-based product restriction.
  return Boolean(access?.token);
}

const TERMINAL_SESSION_CODES = new Set([
  'session_missing',
  'session_expired',
  'owner_only',
  'access_denied',
  'workspace_inactive',
  'subscription_expired',
  'trial_expired',
]);

function canUseRecovery(workspaceId: string, error: unknown): boolean {
  const access = getBusinessAccess(workspaceId);
  if (!access?.token) return false;
  if (error instanceof BusinessApiError && TERMINAL_SESSION_CODES.has(error.code)) {
    clearBusinessAccess(workspaceId);
    return false;
  }
  return true;
}

async function invokeBusinessApi<T>(workspaceId: string, action: string, payload: unknown = {}): Promise<T> {
  const access = getBusinessAccess(workspaceId);
  if (!access?.token) {
    throw new BusinessApiError('Sesi server belum tersedia. Masuk ulang setelah migration diterapkan.', 'session_missing');
  }

  const { data, error } = await supabase.functions.invoke(API_FUNCTION, {
    body: { action, payload },
    headers: { 'x-workspace-session': access.token },
  });

  if (error) {
    throw new BusinessApiError(error.message || 'Business API tidak dapat dihubungi.', 'api_unavailable');
  }

  const response = data as { ok?: boolean; data?: T; error?: string; code?: string } | null;
  if (!response?.ok) {
    throw new BusinessApiError(response?.error || 'Business API menolak permintaan.', response?.code || 'api_rejected');
  }
  return response.data as T;
}

function getLocalDocuments(workspaceId: string, kind: DocumentKind): StoredDocument[] {
  if (!storageAvailable()) return [];
  return parseJson<StoredDocument[]>(localStorage.getItem(documentsKey(workspaceId, kind))) ?? [];
}

function cacheDocuments(workspaceId: string, kind: DocumentKind, documents: StoredDocument[]): void {
  if (!storageAvailable()) return;
  localStorage.setItem(documentsKey(workspaceId, kind), JSON.stringify(documents));
}

function toStoredDocument(
  workspaceId: string,
  document: BusinessDocument,
  existing?: StoredDocument,
): StoredDocument {
  const timestamp = new Date().toISOString();
  return {
    id: document.id,
    workspace_id: workspaceId,
    document_number: document.number,
    status: document.status,
    data: document,
    created_by_email: existing?.created_by_email ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
    source_fee_calculation_id: document.sourceFeeCalculationId ?? null,
    source_quote_id: document.sourceQuoteId ?? null,
  };
}

function hydrateDocument(kind: DocumentKind, workspaceName: string, input: Partial<BusinessDocument>): BusinessDocument {
  const fallback = createDocument(kind, workspaceName);
  return {
    ...fallback,
    ...input,
    id: input.id || fallback.id,
    kind,
    appearance: { ...fallback.appearance, ...(input.appearance ?? {}) },
    business: { ...fallback.business, ...(input.business ?? {}) },
    recipient: { ...fallback.recipient, ...(input.recipient ?? {}) },
    payment: { ...fallback.payment, ...(input.payment ?? {}) },
    items: input.items?.length ? input.items : fallback.items,
    additionalPages: input.additionalPages ?? [],
  };
}

export async function loadDocuments(
  workspaceId: string,
  workspaceName: string,
  kind: DocumentKind,
): Promise<PersistenceResult<StoredDocument[]>> {
  try {
    const rows = await invokeBusinessApi<StoredDocument[]>(workspaceId, 'list_documents', { kind });
    const hydrated = rows.map((row) => ({ ...row, data: hydrateDocument(kind, workspaceName, row.data) }));
    cacheDocuments(workspaceId, kind, hydrated);
    return { data: hydrated, source: 'server' };
  } catch (error) {
    const local = canUseRecovery(workspaceId, error)
      ? getLocalDocuments(workspaceId, kind).map((row) => ({
      ...row,
      data: hydrateDocument(kind, workspaceName, row.data),
      }))
      : [];
    return {
      data: local,
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

export async function loadDocumentById(
  workspaceId: string,
  workspaceName: string,
  kind: DocumentKind,
  id: string,
): Promise<PersistenceResult<StoredDocument | null>> {
  try {
    const row = await invokeBusinessApi<StoredDocument | null>(workspaceId, 'get_document', { kind, id });
    return { data: row ? { ...row, data: hydrateDocument(kind, workspaceName, row.data) } : null, source: 'server' };
  } catch (error) {
    const row = canUseRecovery(workspaceId, error)
      ? getLocalDocuments(workspaceId, kind).find((candidate) => candidate.id === id) ?? null
      : null;
    return {
      data: row ? { ...row, data: hydrateDocument(kind, workspaceName, row.data) } : null,
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

export async function saveDocument(
  workspaceId: string,
  document: BusinessDocument,
): Promise<PersistenceResult<StoredDocument>> {
  try {
    const row = await invokeBusinessApi<StoredDocument>(workspaceId, 'save_document', {
      kind: document.kind,
      document,
    });
    const localRows = getLocalDocuments(workspaceId, document.kind);
    const nextRows = [row, ...localRows.filter((item) => item.id !== row.id)]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    cacheDocuments(workspaceId, document.kind, nextRows);
    return { data: row, source: 'server' };
  } catch (error) {
    if (error instanceof BusinessApiError && error.code === 'number_conflict') throw error;
    // A local draft may still be created before the owner signs in, but it is
    // never returned by loadDocuments/loadDocumentById without an owner token.
    // Once a token exists, terminal session errors must not fall back to data.
    if (getBusinessAccess(workspaceId)?.token && !canUseRecovery(workspaceId, error)) throw error;
    const localRows = getLocalDocuments(workspaceId, document.kind);
    const existing = localRows.find((row) => row.id === document.id);
    const duplicate = localRows.find((row) => row.document_number === document.number && row.id !== document.id);
    if (duplicate) throw new BusinessApiError('Nomor dokumen sudah dipakai pada workspace ini.', 'number_conflict');
    const row = toStoredDocument(workspaceId, document, existing);
    cacheDocuments(
      workspaceId,
      document.kind,
      [row, ...localRows.filter((item) => item.id !== document.id)]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
    return {
      data: row,
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

export async function deleteDocument(
  workspaceId: string,
  kind: DocumentKind,
  id: string,
): Promise<PersistenceResult<boolean>> {
  try {
    await invokeBusinessApi<boolean>(workspaceId, 'delete_document', { kind, id });
    cacheDocuments(workspaceId, kind, getLocalDocuments(workspaceId, kind).filter((row) => row.id !== id));
    return { data: true, source: 'server' };
  } catch (error) {
    cacheDocuments(workspaceId, kind, getLocalDocuments(workspaceId, kind).filter((row) => row.id !== id));
    return {
      data: true,
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

export function saveRecoveryDraft(workspaceId: string, document: BusinessDocument): void {
  if (!storageAvailable() || !getBusinessAccess(workspaceId)?.token) return;
  localStorage.setItem(recoveryDraftKey(workspaceId, document.kind), JSON.stringify({ document, savedAt: new Date().toISOString() }));
}

export function loadRecoveryDraft(workspaceId: string, kind: DocumentKind): BusinessDocument | null {
  if (!storageAvailable() || !getBusinessAccess(workspaceId)?.token) return null;
  const value = parseJson<{ document: BusinessDocument }>(localStorage.getItem(recoveryDraftKey(workspaceId, kind)));
  return value?.document ?? null;
}

export function clearRecoveryDraft(workspaceId: string, kind: DocumentKind): void {
  if (!storageAvailable()) return;
  localStorage.removeItem(recoveryDraftKey(workspaceId, kind));
}

export async function loadFeeCalculator(
  workspaceId: string,
): Promise<PersistenceResult<FeeCalculatorState>> {
  try {
    const state = await invokeBusinessApi<FeeCalculatorState | null>(workspaceId, 'get_fee_calculator');
    const hydrated = state ?? createDefaultFeeCalculator();
    if (storageAvailable()) localStorage.setItem(pricingKey(workspaceId), JSON.stringify(hydrated));
    return { data: hydrated, source: 'server' };
  } catch (error) {
    const canRecover = canUseRecovery(workspaceId, error);
    const cached = canRecover && storageAvailable()
      ? parseJson<FeeCalculatorState>(localStorage.getItem(pricingKey(workspaceId)))
      : null;
    return {
      data: cached ?? createDefaultFeeCalculator(),
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

export async function saveFeeCalculator(
  workspaceId: string,
  state: FeeCalculatorState,
): Promise<PersistenceResult<FeeCalculatorState>> {
  if (getBusinessAccess(workspaceId)?.token && storageAvailable()) localStorage.setItem(pricingKey(workspaceId), JSON.stringify(state));
  try {
    const saved = await invokeBusinessApi<FeeCalculatorState>(workspaceId, 'save_fee_calculator', { state });
    if (storageAvailable()) localStorage.setItem(pricingKey(workspaceId), JSON.stringify(saved));
    return { data: saved, source: 'server' };
  } catch (error) {
    const canRecover = canUseRecovery(workspaceId, error);
    return {
      data: state,
      source: 'recovery',
      warning: canRecover
        ? (error instanceof Error ? error.message : 'Server tidak tersedia.')
        : 'Sesi pemilik workspace belum tersedia. Data hanya dapat disimpan setelah masuk ulang.',
    };
  }
}

export async function saveFeeCustomQuote(
  workspaceId: string,
  state: FeeCalculatorState,
): Promise<PersistenceResult<FeeCalculatorState>> {
  if (getBusinessAccess(workspaceId)?.token && storageAvailable()) localStorage.setItem(pricingKey(workspaceId), JSON.stringify(state));
  try {
    const customQuote = await invokeBusinessApi<FeeCalculatorState['customQuote']>(
      workspaceId,
      'save_fee_custom_quote',
      { customQuote: state.customQuote },
    );
    const saved = { ...state, customQuote };
    if (storageAvailable()) localStorage.setItem(pricingKey(workspaceId), JSON.stringify(saved));
    return { data: saved, source: 'server' };
  } catch (error) {
    const canRecover = canUseRecovery(workspaceId, error);
    return {
      data: state,
      source: 'recovery',
      warning: canRecover
        ? (error instanceof Error ? error.message : 'Server tidak tersedia.')
        : 'Sesi pemilik workspace belum tersedia. Data hanya dapat disimpan setelah masuk ulang.',
    };
  }
}

export async function createFeeQuoteDraft(
  workspaceId: string,
  input: Omit<FeeQuoteDraft, 'id' | 'createdAt' | 'source'>,
): Promise<PersistenceResult<FeeQuoteDraft>> {
  const localDraft: FeeQuoteDraft = {
    ...input,
    id: createId(),
    source: 'fee-calculator',
    createdAt: new Date().toISOString(),
  };
  try {
    const saved = await invokeBusinessApi<FeeQuoteDraft>(workspaceId, 'create_fee_quote_draft', { draft: localDraft });
    if (storageAvailable()) sessionStorage.setItem(feeDraftKey(workspaceId, saved.id), JSON.stringify(saved));
    return { data: saved, source: 'server' };
  } catch (error) {
    if (canUseRecovery(workspaceId, error) && storageAvailable()) sessionStorage.setItem(feeDraftKey(workspaceId, localDraft.id), JSON.stringify(localDraft));
    return {
      data: localDraft,
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

export async function loadFeeQuoteDraft(
  workspaceId: string,
  draftId: string,
): Promise<PersistenceResult<FeeQuoteDraft | null>> {
  try {
    const draft = await invokeBusinessApi<FeeQuoteDraft | null>(workspaceId, 'get_fee_quote_draft', { id: draftId });
    return { data: draft, source: 'server' };
  } catch (error) {
    const cached = canUseRecovery(workspaceId, error) && storageAvailable()
      ? parseJson<FeeQuoteDraft>(sessionStorage.getItem(feeDraftKey(workspaceId, draftId)))
      : null;
    return {
      data: cached,
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

export function consumeFeeQuoteDraft(workspaceId: string, draftId: string): void {
  if (!storageAvailable()) return;
  sessionStorage.removeItem(feeDraftKey(workspaceId, draftId));
}

export async function uploadBusinessImage(
  workspaceId: string,
  documentKind: DocumentKind,
  imageKind: 'logo' | 'background',
  blob: Blob,
  extension: string,
): Promise<PersistenceResult<{ url: string; path: string }>> {
  const dataUrl = await blobToDataUrl(blob);
  try {
    const uploaded = await invokeBusinessApi<{ url: string; path: string }>(workspaceId, 'upload_image', {
      documentKind,
      imageKind,
      mimeType: blob.type,
      extension,
      base64: dataUrl.split(',')[1],
    });
    return { data: uploaded, source: 'server' };
  } catch (error) {
    return {
      data: { url: dataUrl, path: '' },
      source: 'recovery',
      warning: error instanceof Error ? error.message : 'Server tidak tersedia.',
    };
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Gagal membaca gambar.'));
    reader.readAsDataURL(blob);
  });
}
