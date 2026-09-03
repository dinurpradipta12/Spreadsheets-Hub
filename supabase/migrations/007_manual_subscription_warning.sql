-- ═══════════════════════════════════════════════════════
-- Migration 007: Manual Subscription Warning Trigger
-- ═══════════════════════════════════════════════════════

-- 1. Tambah kolom force_sub_warning
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS force_sub_warning TIMESTAMPTZ;

-- 2. RPC untuk developer mengirim peringatan langganan secara manual
CREATE OR REPLACE FUNCTION public.send_subscription_warning(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET force_sub_warning = now()
  WHERE id = p_workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update authenticate_workspace agar mengembalikan force_sub_warning
DROP FUNCTION IF EXISTS public.authenticate_workspace(text, text);

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
) AS $func$
BEGIN
  RETURN QUERY
  SELECT 
    w.id, w.slug, w.owner_name, w.created_at, w.is_active, w.has_paid, 
    w.is_trial, w.trial_link_id, w.trial_started_at, w.trial_ends_at, 
    w.trial_expired, w.subscription_started_at, w.subscription_ends_at,
    w.force_sub_warning, w.revoked_at, w.revoked_by, w.revoke_reason
  FROM public.workspaces w
  WHERE lower(trim(w.owner_name)) LIKE lower(trim(p_name)) || '%'
    AND (w.password IS NULL OR w.password = '' OR w.password = p_password)
  ORDER BY w.created_at DESC
  LIMIT 1;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
