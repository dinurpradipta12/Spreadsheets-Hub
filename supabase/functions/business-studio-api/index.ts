import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { z } from 'npm:zod@4.5.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-workspace-session, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const idSchema = z.string().min(1).max(100);
const nonNegativeNumber = z.number().finite().min(0);
const lineItemSchema = z.object({
  id: idSchema,
  description: z.string().max(5000),
  quantity: nonNegativeNumber,
  unitPrice: nonNegativeNumber,
});

const customQuoteSchema = z.object({
  items: z.array(lineItemSchema).min(1).max(1000),
  discountPercent: nonNegativeNumber,
  taxPercent: nonNegativeNumber,
  notes: z.string().max(20_000),
});

const documentSchema = z.object({
  id: idSchema,
  kind: z.enum(['invoice', 'quote']),
  number: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(180),
  issueDate: z.string().max(20),
  dueDate: z.string().max(20),
  currency: z.enum(['IDR', 'USD', 'SGD', 'MYR']),
  status: z.enum(['draft', 'sent', 'paid', 'void', 'accepted', 'rejected']),
  appearance: z.object({
    font: z.enum(['Inter/Sans', 'Arial', 'Georgia', 'Times New Roman', 'Courier New']),
    backgroundColor: z.string().max(32),
    accentColor: z.string().max(32),
    textColor: z.string().max(32),
    backgroundImageUrl: z.string().max(2_000_000),
    backgroundImagePath: z.string().max(1000),
  }),
  business: z.object({
    logoUrl: z.string().max(2_000_000),
    logoPath: z.string().max(1000),
    name: z.string().max(500),
    address: z.string().max(5000),
    email: z.string().max(500),
    phone: z.string().max(200),
  }),
  recipient: z.object({
    companyName: z.string().max(500),
    contactName: z.string().max(500),
    address: z.string().max(5000),
    email: z.string().max(500),
    phone: z.string().max(200),
  }),
  items: z.array(lineItemSchema).min(1).max(1000),
  discountPercent: nonNegativeNumber,
  taxPercent: nonNegativeNumber,
  payment: z.object({
    title: z.string().max(500),
    bankName: z.string().max(500),
    accountName: z.string().max(500),
    accountNumber: z.string().max(500),
    instructions: z.string().max(5000),
  }),
  notes: z.string().max(20_000),
  terms: z.string().max(20_000),
  footer: z.string().max(2000),
  introduction: z.string().max(20_000),
  additionalPages: z.array(z.object({
    id: idSchema,
    title: z.string().max(500),
    content: z.string().max(40_000),
    sortOrder: nonNegativeNumber,
  })).max(50),
  sourceFeeCalculationId: z.string().nullable().optional(),
  sourceQuoteId: z.string().nullable().optional(),
}).superRefine((document, context) => {
  const validStatuses = document.kind === 'invoice'
    ? ['draft', 'sent', 'paid', 'void']
    : ['draft', 'sent', 'accepted', 'rejected'];
  if (!validStatuses.includes(document.status)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Status tidak sesuai jenis dokumen.' });
  }
});

const feeStateSchema = z.object({
  hoursPerDay: nonNegativeNumber,
  daysPerWeek: nonNegativeNumber,
  profitMarginPercent: nonNegativeNumber,
  livingCosts: z.array(z.object({ id: idSchema, label: z.string().max(500), description: z.string().max(2000), amount: nonNegativeNumber, sortOrder: nonNegativeNumber })).max(250),
  productionItems: z.array(z.object({ id: idSchema, label: z.string().max(500), hoursPerItem: nonNegativeNumber, quantity: nonNegativeNumber, sortOrder: nonNegativeNumber })).max(250),
  addOns: z.array(z.object({ id: idSchema, label: z.string().max(500), price: nonNegativeNumber, quantity: nonNegativeNumber, sortOrder: nonNegativeNumber })).max(250),
  operationalItems: z.array(z.object({ id: idSchema, label: z.string().max(500), description: z.string().max(2000), amount: nonNegativeNumber, sortOrder: nonNegativeNumber })).max(250),
  packages: z.array(z.object({ id: idSchema, name: z.string().max(200), markupPercent: nonNegativeNumber, sortOrder: nonNegativeNumber })).length(3),
  unitPrices: z.array(z.object({
    id: idSchema,
    label: z.string().max(500),
    category: z.enum(['production', 'addon', 'operational', 'other']),
    unit: z.string().max(100),
    price: nonNegativeNumber,
    description: z.string().max(2000),
    isActive: z.boolean(),
    sortOrder: nonNegativeNumber,
  })).max(1000),
  customQuote: customQuoteSchema,
});

const feeDraftSchema = z.object({
  id: idSchema,
  source: z.literal('fee-calculator'),
  createdAt: z.string(),
  items: z.array(lineItemSchema).min(1).max(1000),
  discountPercent: nonNegativeNumber,
  taxPercent: nonNegativeNumber,
  notes: z.string().max(20_000),
  totals: z.object({
    subtotal: nonNegativeNumber,
    discountAmount: nonNegativeNumber,
    taxableAmount: nonNegativeNumber,
    taxAmount: nonNegativeNumber,
    grandTotal: nonNegativeNumber,
  }),
});

type Session = {
  id: string;
  workspace_id: string;
  actor_email: string;
  role: 'admin' | 'finance' | 'pricing' | 'member';
  page_access: string[];
  is_owner: boolean;
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(error: string, code = 'request_failed'): Response {
  return response({ ok: false, error, code });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireAccess(session: Session, page: string): void {
  if (!session.is_owner) {
    throw new Error(`access_denied:${page}`);
  }
}

function requirePricingRole(session: Session): void {
  if (!session.is_owner) {
    throw new Error('access_denied:pricing');
  }
}

async function signStorageAsset(service: any, workspaceId: string, path: unknown): Promise<string | null> {
  if (typeof path !== 'string' || !path) return null;
  if (!path.startsWith(`${workspaceId}/`)) return null;
  const { data, error } = await service.storage.from('business-documents').createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function mapDocumentRow(service: any, row: Record<string, unknown>, kind: 'invoice' | 'quote', workspaceId: string) {
  const mapped: Record<string, unknown> = {
    ...row,
    document_number: row[kind === 'invoice' ? 'invoice_number' : 'quote_number'],
  };
  const storedDocument = row.data;
  if (!storedDocument || typeof storedDocument !== 'object') return mapped;

  const source = storedDocument as Record<string, any>;
  const [logoUrl, backgroundImageUrl] = await Promise.all([
    signStorageAsset(service, workspaceId, source.business?.logoPath),
    signStorageAsset(service, workspaceId, source.appearance?.backgroundImagePath),
  ]);
  mapped.data = {
    ...source,
    business: {
      ...(source.business ?? {}),
      ...(source.business?.logoPath ? { logoUrl: logoUrl ?? '' } : {}),
    },
    appearance: {
      ...(source.appearance ?? {}),
      ...(source.appearance?.backgroundImagePath ? { backgroundImageUrl: backgroundImageUrl ?? '' } : {}),
    },
  };
  return mapped;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertDocumentAssetPaths(document: z.infer<typeof documentSchema>, workspaceId: string): void {
  const paths = [document.business.logoPath, document.appearance.backgroundImagePath]
    .filter((path): path is string => Boolean(path));
  if (paths.some((path) => !path.startsWith(`${workspaceId}/`))) {
    throw new Error('access_denied:asset');
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return fail('Metode tidak didukung.', 'method_not_allowed');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return fail('Konfigurasi server belum lengkap.', 'server_misconfigured');
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const rawToken = request.headers.get('x-workspace-session')?.trim();
    if (!rawToken || rawToken.length < 32) return fail('Sesi workspace tidak valid. Silakan masuk ulang.', 'session_missing');
    const tokenHash = await sha256Hex(rawToken);
    const { data: sessionData, error: sessionError } = await service
      .from('app_workspace_sessions')
      .select('id, workspace_id, actor_email, role, page_access, is_owner, expires_at')
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (sessionError || !sessionData) return fail('Sesi workspace kedaluwarsa. Silakan masuk ulang.', 'session_expired');
    const session = sessionData as Session;
    if (!session.is_owner) return fail('Sesi ini bukan sesi pemilik workspace.', 'owner_only');

    const { data: workspace, error: workspaceError } = await service
      .from('workspaces')
      .select('id, owner_name, is_active, subscription_ends_at, trial_ends_at')
      .eq('id', session.workspace_id)
      .maybeSingle();
    if (workspaceError || !workspace || !workspace.is_active) return fail('Workspace tidak aktif.', 'workspace_inactive');
    if (session.actor_email.trim().toLowerCase() !== String(workspace.owner_name ?? '').trim().toLowerCase()) {
      return fail('Sesi tidak cocok dengan pemilik workspace.', 'owner_only');
    }
    if (workspace.subscription_ends_at && new Date(workspace.subscription_ends_at) < new Date()) return fail('Langganan workspace telah berakhir.', 'subscription_expired');
    if (workspace.trial_ends_at && new Date(workspace.trial_ends_at) < new Date()) return fail('Masa trial workspace telah berakhir.', 'trial_expired');

    const { error: lastSeenError } = await service
      .from('app_workspace_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.id);
    if (lastSeenError) console.warn('[business-studio-api] last_seen update failed', lastSeenError.message);

    const body = await request.json();
    const action = z.string().min(1).parse(body?.action);
    const payload = body?.payload ?? {};

    if (action === 'list_documents') {
      const kind = z.enum(['invoice', 'quote']).parse(payload.kind);
      requireAccess(session, kind === 'invoice' ? 'invoices' : 'quotes');
      const table = kind === 'invoice' ? 'app_invoices' : 'app_quotes';
      const { data, error } = await service.from(table).select('*').eq('workspace_id', session.workspace_id).order('updated_at', { ascending: false });
      if (error) throw error;
      return response({ ok: true, data: await Promise.all((data ?? []).map((row) => mapDocumentRow(service, row, kind, session.workspace_id))) });
    }

    if (action === 'get_document') {
      const kind = z.enum(['invoice', 'quote']).parse(payload.kind);
      const id = idSchema.parse(payload.id);
      requireAccess(session, kind === 'invoice' ? 'invoices' : 'quotes');
      const table = kind === 'invoice' ? 'app_invoices' : 'app_quotes';
      const { data, error } = await service.from(table).select('*').eq('workspace_id', session.workspace_id).eq('id', id).maybeSingle();
      if (error) throw error;
      return response({ ok: true, data: data ? await mapDocumentRow(service, data, kind, session.workspace_id) : null });
    }

    if (action === 'save_document') {
      const kind = z.enum(['invoice', 'quote']).parse(payload.kind);
      const document = documentSchema.parse(payload.document);
      if (kind !== document.kind) return fail('Jenis dokumen tidak konsisten.', 'invalid_document_kind');
      requireAccess(session, kind === 'invoice' ? 'invoices' : 'quotes');
      assertDocumentAssetPaths(document, session.workspace_id);
      const table = kind === 'invoice' ? 'app_invoices' : 'app_quotes';
      const numberColumn = kind === 'invoice' ? 'invoice_number' : 'quote_number';
      const { data: existing } = await service.from(table).select('id, workspace_id').eq('id', document.id).maybeSingle();
      if (existing && existing.workspace_id !== session.workspace_id) return fail('Dokumen bukan milik workspace aktif.', 'access_denied');

      const values: Record<string, unknown> = {
        id: document.id,
        workspace_id: session.workspace_id,
        [numberColumn]: document.number,
        status: document.status,
        data: document,
        created_by_email: session.actor_email,
      };
      if (kind === 'invoice') values.source_quote_id = document.sourceQuoteId ?? null;
      else values.source_fee_calculation_id = document.sourceFeeCalculationId ?? null;

      const query = existing
        ? service.from(table).update(values).eq('id', document.id).eq('workspace_id', session.workspace_id)
        : service.from(table).insert(values);
      const { data, error } = await query.select('*').single();
      if (error?.code === '23505') return fail('Nomor dokumen sudah digunakan pada workspace ini.', 'number_conflict');
      if (error) throw error;

      if (kind === 'quote' && document.sourceFeeCalculationId) {
        await service.from('fee_quote_drafts').update({ status: 'converted', quote_id: document.id })
          .eq('workspace_id', session.workspace_id).eq('id', document.sourceFeeCalculationId);
      }
      return response({ ok: true, data: await mapDocumentRow(service, data, kind, session.workspace_id) });
    }

    if (action === 'delete_document') {
      const kind = z.enum(['invoice', 'quote']).parse(payload.kind);
      const id = idSchema.parse(payload.id);
      requireAccess(session, kind === 'invoice' ? 'invoices' : 'quotes');
      const table = kind === 'invoice' ? 'app_invoices' : 'app_quotes';
      const { error } = await service.from(table).delete().eq('workspace_id', session.workspace_id).eq('id', id);
      if (error) throw error;
      return response({ ok: true, data: true });
    }

    if (action === 'get_fee_calculator') {
      requireAccess(session, 'fee-calculator');
      const [settings, living, production, addons, operational, packages, unitPrices] = await Promise.all([
        service.from('fee_calculator_settings').select('*').eq('workspace_id', session.workspace_id).maybeSingle(),
        service.from('fee_living_cost_items').select('*').eq('workspace_id', session.workspace_id).order('sort_order'),
        service.from('fee_production_items').select('*').eq('workspace_id', session.workspace_id).order('sort_order'),
        service.from('fee_addon_items').select('*').eq('workspace_id', session.workspace_id).order('sort_order'),
        service.from('fee_operational_items').select('*').eq('workspace_id', session.workspace_id).order('sort_order'),
        service.from('fee_packages').select('*').eq('workspace_id', session.workspace_id).order('sort_order'),
        service.from('fee_unit_prices').select('*').eq('workspace_id', session.workspace_id).order('sort_order'),
      ]);
      const firstError = [settings, living, production, addons, operational, packages, unitPrices].find((result) => result.error)?.error;
      if (firstError) throw firstError;
      if (!settings.data) return response({ ok: true, data: null });
      return response({
        ok: true,
        data: {
          hoursPerDay: numberValue(settings.data.hours_per_day),
          daysPerWeek: numberValue(settings.data.days_per_week),
          profitMarginPercent: numberValue(settings.data.profit_margin_percent),
          livingCosts: (living.data ?? []).map((item) => ({ id: item.id, label: item.label, description: item.description, amount: numberValue(item.amount), sortOrder: item.sort_order })),
          productionItems: (production.data ?? []).map((item) => ({ id: item.id, label: item.label, hoursPerItem: numberValue(item.hours_per_item), quantity: numberValue(item.quantity), sortOrder: item.sort_order })),
          addOns: (addons.data ?? []).map((item) => ({ id: item.id, label: item.label, price: numberValue(item.price), quantity: numberValue(item.quantity), sortOrder: item.sort_order })),
          operationalItems: (operational.data ?? []).map((item) => ({ id: item.id, label: item.label, description: item.description, amount: numberValue(item.amount), sortOrder: item.sort_order })),
          packages: (packages.data ?? []).map((item) => ({ id: item.id, name: item.name, markupPercent: numberValue(item.markup_percent), sortOrder: item.sort_order })),
          unitPrices: (unitPrices.data ?? []).map((item) => ({ id: item.id, label: item.label, category: item.category, unit: item.unit, price: numberValue(item.price), description: item.description, isActive: item.is_active, sortOrder: item.sort_order })),
          customQuote: settings.data.custom_quote,
        },
      });
    }

    if (action === 'save_fee_calculator') {
      requireAccess(session, 'fee-calculator');
      requirePricingRole(session);
      const state = feeStateSchema.parse(payload.state);
      const { error } = await service.rpc('save_fee_calculator_state', {
        p_workspace_id: session.workspace_id,
        p_actor: session.actor_email,
        p_state: state,
      });
      if (error) throw error;
      return response({ ok: true, data: state });
    }

    if (action === 'save_fee_custom_quote') {
      requireAccess(session, 'fee-calculator');
      const customQuote = customQuoteSchema.parse(payload.customQuote);
      const { data, error } = await service
        .from('fee_calculator_settings')
        .upsert({
          workspace_id: session.workspace_id,
          custom_quote: customQuote,
          updated_by: session.actor_email,
        }, { onConflict: 'workspace_id' })
        .select('custom_quote')
        .single();
      if (error) throw error;
      return response({ ok: true, data: data.custom_quote });
    }

    if (action === 'create_fee_quote_draft') {
      if (!session.is_owner) {
        throw new Error('access_denied:quotes');
      }
      const draft = feeDraftSchema.parse(payload.draft);
      const { data: draftId, error } = await service.rpc('create_fee_quote_draft_snapshot', {
        p_workspace_id: session.workspace_id,
        p_actor: session.actor_email,
        p_draft: draft,
      });
      if (error) throw error;
      return response({ ok: true, data: { ...draft, id: draftId } });
    }

    if (action === 'get_fee_quote_draft') {
      requireAccess(session, 'quotes');
      const id = idSchema.parse(payload.id);
      const { data: draft, error } = await service.from('fee_quote_drafts').select('*').eq('workspace_id', session.workspace_id).eq('id', id).maybeSingle();
      if (error) throw error;
      if (!draft) return response({ ok: true, data: null });
      const { data: items, error: itemsError } = await service.from('fee_quote_draft_items').select('*').eq('draft_id', id).order('sort_order');
      if (itemsError) throw itemsError;
      await service.from('fee_quote_drafts').update({ status: 'consumed' }).eq('id', id).eq('workspace_id', session.workspace_id);
      const discountAmount = numberValue(draft.discount_amount);
      const subtotal = numberValue(draft.subtotal);
      return response({
        ok: true,
        data: {
          id: draft.id,
          source: 'fee-calculator',
          createdAt: draft.created_at,
          items: (items ?? []).map((item) => ({ id: item.id, description: item.description, quantity: numberValue(item.quantity), unitPrice: numberValue(item.unit_price) })),
          discountPercent: numberValue(draft.discount_percent),
          taxPercent: numberValue(draft.tax_percent),
          notes: draft.notes,
          totals: {
            subtotal,
            discountAmount,
            taxableAmount: Math.max(0, subtotal - discountAmount),
            taxAmount: numberValue(draft.tax_amount),
            grandTotal: numberValue(draft.total),
          },
        },
      });
    }

    if (action === 'upload_image') {
      const upload = z.object({
        documentKind: z.enum(['invoice', 'quote']),
        imageKind: z.enum(['logo', 'background']),
        mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        extension: z.enum(['png', 'jpg', 'webp']),
        base64: z.string().min(1).max(12_000_000),
      }).parse(payload);
      requireAccess(session, upload.documentKind === 'invoice' ? 'invoices' : 'quotes');
      const binary = Uint8Array.from(atob(upload.base64), (character) => character.charCodeAt(0));
      if (binary.byteLength > 8 * 1024 * 1024) return fail('Gambar hasil kompresi melebihi 8 MB.', 'image_too_large');
      const path = `${session.workspace_id}/${upload.documentKind}/${upload.imageKind}/${crypto.randomUUID()}.${upload.extension}`;
      const { error } = await service.storage.from('business-documents').upload(path, binary, { contentType: upload.mimeType, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      const { data, error: signedUrlError } = await service.storage.from('business-documents').createSignedUrl(path, 60 * 60);
      if (signedUrlError || !data?.signedUrl) throw signedUrlError ?? new Error('Gagal membuat URL gambar privat.');
      return response({ ok: true, data: { path, url: data.signedUrl } });
    }

    return fail('Aksi tidak dikenal.', 'unknown_action');
  } catch (error) {
    if (error instanceof z.ZodError) return fail(error.issues.map((issue) => issue.message).join('; '), 'validation_error');
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server.';
    if (message.startsWith('access_denied:')) return fail('Role Anda tidak memiliki izin untuk aksi ini.', 'access_denied');
    console.error('[business-studio-api]', message);
    return fail(message, 'server_error');
  }
});
