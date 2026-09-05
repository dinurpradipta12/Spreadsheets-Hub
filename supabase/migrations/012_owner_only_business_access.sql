-- ═══════════════════════════════════════════════════════════════════
-- Migration 012: Owner-only business data access
--
-- Business records are served only by business-studio-api after a
-- workspace-owner session is validated.  Direct anon/authenticated
-- PostgREST access is intentionally removed from the business tables.
-- The public workspace directory keeps only non-secret columns; the
-- workspace password is never selectable through the client API.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A session created by the owner-login RPC is the only session accepted by
-- the business API.  Existing sessions are invalidated once, so old tokens
-- cannot retain access after this hardening migration.
ALTER TABLE public.app_workspace_sessions
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_app_workspace_sessions_owner
  ON public.app_workspace_sessions (workspace_id, is_owner, expires_at DESC);

DELETE FROM public.app_workspace_sessions
WHERE is_owner IS DISTINCT FROM true;

-- Require a real workspace password and reject ambiguous prefix matches.  The
-- UI still accepts the first words of a workspace name, but a password must
-- identify exactly one workspace.
CREATE OR REPLACE FUNCTION public.authenticate_business_workspace(p_name TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  owner_name TEXT,
  created_at TIMESTAMPTZ,
  is_active BOOLEAN,
  has_paid BOOLEAN,
  is_trial BOOLEAN,
  trial_link_id UUID,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  trial_expired BOOLEAN,
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  force_sub_warning TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT,
  session_token TEXT,
  business_role TEXT,
  page_access TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  target public.workspaces%ROWTYPE;
  raw_token TEXT;
  matching_workspaces INTEGER;
  normalized_name TEXT := lower(trim(coalesce(p_name, '')));
  normalized_password TEXT := trim(coalesce(p_password, ''));
BEGIN
  IF normalized_name = '' OR normalized_password = '' THEN
    RETURN;
  END IF;

  SELECT count(*)::INTEGER INTO matching_workspaces
  FROM public.workspaces workspace
  WHERE lower(trim(workspace.owner_name)) LIKE normalized_name || '%'
    AND nullif(trim(workspace.password), '') IS NOT NULL
    AND workspace.password = normalized_password;

  IF matching_workspaces <> 1 THEN
    RETURN;
  END IF;

  SELECT workspace.* INTO target
  FROM public.workspaces workspace
  WHERE lower(trim(workspace.owner_name)) LIKE normalized_name || '%'
    AND nullif(trim(workspace.password), '') IS NOT NULL
    AND workspace.password = normalized_password
  LIMIT 1;

  DELETE FROM public.app_workspace_sessions WHERE expires_at <= now();
  raw_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.app_workspace_sessions (
    workspace_id, token_hash, actor_email, role, page_access, is_owner, expires_at
  ) VALUES (
    target.id,
    encode(digest(raw_token, 'sha256'), 'hex'),
    COALESCE(NULLIF(trim(target.owner_name), ''), 'workspace-owner'),
    'admin',
    ARRAY['sheets', 'fee-calculator', 'invoices', 'quotes', 'pricing', 'finance'],
    true,
    now() + interval '30 days'
  );

  RETURN QUERY SELECT
    target.id, target.slug, target.owner_name, target.created_at,
    target.is_active, target.has_paid, target.is_trial, target.trial_link_id,
    target.trial_started_at, target.trial_ends_at, target.trial_expired,
    target.subscription_started_at, target.subscription_ends_at,
    target.force_sub_warning, target.revoked_at, target.revoked_by,
    target.revoke_reason, raw_token, 'admin'::TEXT,
    ARRAY['sheets', 'fee-calculator', 'invoices', 'quotes', 'pricing', 'finance']::TEXT[];
END;
$function$;

REVOKE ALL ON FUNCTION public.authenticate_business_workspace(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticate_business_workspace(TEXT, TEXT) TO anon, authenticated;

-- Keep the legacy Sheets-login RPC from accepting a blank password as a
-- backdoor.  Business pages still require the owner session above, but the
-- fallback must not silently authenticate an unprotected workspace.
CREATE OR REPLACE FUNCTION public.authenticate_workspace(p_name TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  owner_name TEXT,
  created_at TIMESTAMPTZ,
  is_active BOOLEAN,
  has_paid BOOLEAN,
  is_trial BOOLEAN,
  trial_link_id UUID,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  trial_expired BOOLEAN,
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  force_sub_warning TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  normalized_name TEXT := lower(trim(coalesce(p_name, '')));
  normalized_password TEXT := trim(coalesce(p_password, ''));
BEGIN
  IF normalized_name = '' OR normalized_password = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    workspace.id, workspace.slug, workspace.owner_name, workspace.created_at,
    workspace.is_active, workspace.has_paid, workspace.is_trial,
    workspace.trial_link_id, workspace.trial_started_at, workspace.trial_ends_at,
    workspace.trial_expired, workspace.subscription_started_at,
    workspace.subscription_ends_at, workspace.force_sub_warning,
    workspace.revoked_at, workspace.revoked_by, workspace.revoke_reason
  FROM public.workspaces workspace
  WHERE lower(trim(workspace.owner_name)) LIKE normalized_name || '%'
    AND nullif(trim(workspace.password), '') IS NOT NULL
    AND workspace.password = normalized_password
  ORDER BY workspace.created_at DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.authenticate_workspace(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticate_workspace(TEXT, TEXT) TO anon, authenticated;

-- The browser never queries these records directly.  Keeping RLS enabled with
-- no anon/authenticated policies prevents a future direct Supabase client from
-- bypassing the workspace-session boundary.  service_role remains available
-- to the Edge Function and is not exposed to the browser.
DO $block$
DECLARE
  table_name TEXT;
  policy_row RECORD;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fee_calculator_settings', 'fee_living_cost_items', 'fee_production_items',
    'fee_addon_items', 'fee_operational_items', 'fee_packages',
    'fee_unit_prices', 'fee_quote_drafts', 'fee_quote_draft_items',
    'app_quotes', 'app_invoices'
  ] LOOP
    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_row.policyname, table_name);
    END LOOP;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END;
$block$;

-- Direct workspace reads expose only the public directory fields.  In
-- particular, password is deliberately omitted even when a client asks for
-- select=*; the application uses PUBLIC_WORKSPACE_FIELDS instead.
REVOKE ALL ON TABLE public.workspaces FROM anon, authenticated;
GRANT SELECT (
  id, slug, owner_name, created_at, is_active, has_paid,
  is_trial, trial_link_id, trial_expired, trial_started_at, trial_ends_at,
  subscription_started_at, subscription_ends_at, force_sub_warning,
  revoked_at, revoked_by, revoke_reason
) ON TABLE public.workspaces TO anon, authenticated;

GRANT INSERT (
  slug, owner_name, password, is_trial, trial_link_id,
  trial_started_at, trial_ends_at
) ON TABLE public.workspaces TO anon, authenticated;

-- Status changes must go through controlled SECURITY DEFINER functions rather
-- than an anonymous UPDATE on the workspace row.
REVOKE UPDATE, DELETE ON TABLE public.workspaces FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_workspace_subscription_expired(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.workspaces
  SET is_active = false,
      revoked_at = now(),
      revoke_reason = 'Masa langganan habis. Silakan selesaikan pembayaran untuk membuka kembali akses.'
  WHERE id = p_workspace_id
    AND is_active = true
    AND subscription_ends_at IS NOT NULL
    AND subscription_ends_at < now();
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_workspace_subscription_expired(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_workspace_subscription_expired(UUID) TO anon, authenticated;

-- Uploaded invoice/quote images are owner-session data too.  Make the bucket
-- private; the Edge Function returns short-lived signed URLs after validating
-- the workspace-owner session.
UPDATE storage.buckets
SET public = false
WHERE id = 'business-documents';

DROP POLICY IF EXISTS "Workspace members read business document images" ON storage.objects;

-- Realtime is not used for custom sessions (the client polls the scoped API).
-- Removing workspaces from the publication also prevents password-column
-- payloads from being broadcast to anonymous realtime clients.
DO $block$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workspaces'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workspaces;
  END IF;
END;
$block$;

COMMIT;
