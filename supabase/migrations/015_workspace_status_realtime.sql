-- ═══════════════════════════════════════════════════════════════════
-- Migration 015: sanitized realtime workspace status
--
-- The source workspaces table contains the owner password and therefore is
-- intentionally excluded from Supabase Realtime. This mirror contains only
-- the non-secret status fields needed by the header and developer panel.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_status_realtime (
  id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL,
  has_paid BOOLEAN NOT NULL,
  is_trial BOOLEAN NOT NULL,
  trial_link_id UUID,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  trial_expired BOOLEAN NOT NULL,
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  force_sub_warning TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_status_realtime_slug_idx
  ON public.workspace_status_realtime (slug);

ALTER TABLE public.workspace_status_realtime ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read workspace status" ON public.workspace_status_realtime;
CREATE POLICY "Public read workspace status"
  ON public.workspace_status_realtime
  FOR SELECT
  USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.workspace_status_realtime
  FROM anon, authenticated;

GRANT SELECT
  ON public.workspace_status_realtime
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_workspace_status_realtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.workspace_status_realtime
    WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.workspace_status_realtime (
    id,
    slug,
    owner_name,
    created_at,
    is_active,
    has_paid,
    is_trial,
    trial_link_id,
    trial_started_at,
    trial_ends_at,
    trial_expired,
    subscription_started_at,
    subscription_ends_at,
    force_sub_warning,
    revoked_at,
    revoked_by,
    revoke_reason,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.slug,
    NEW.owner_name,
    NEW.created_at,
    NEW.is_active,
    NEW.has_paid,
    NEW.is_trial,
    NEW.trial_link_id,
    NEW.trial_started_at,
    NEW.trial_ends_at,
    NEW.trial_expired,
    NEW.subscription_started_at,
    NEW.subscription_ends_at,
    NEW.force_sub_warning,
    NEW.revoked_at,
    NEW.revoked_by,
    NEW.revoke_reason,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    owner_name = EXCLUDED.owner_name,
    created_at = EXCLUDED.created_at,
    is_active = EXCLUDED.is_active,
    has_paid = EXCLUDED.has_paid,
    is_trial = EXCLUDED.is_trial,
    trial_link_id = EXCLUDED.trial_link_id,
    trial_started_at = EXCLUDED.trial_started_at,
    trial_ends_at = EXCLUDED.trial_ends_at,
    trial_expired = EXCLUDED.trial_expired,
    subscription_started_at = EXCLUDED.subscription_started_at,
    subscription_ends_at = EXCLUDED.subscription_ends_at,
    force_sub_warning = EXCLUDED.force_sub_warning,
    revoked_at = EXCLUDED.revoked_at,
    revoked_by = EXCLUDED.revoked_by,
    revoke_reason = EXCLUDED.revoke_reason,
    updated_at = now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_workspace_status_realtime
  ON public.workspaces;

CREATE TRIGGER sync_workspace_status_realtime
  AFTER INSERT OR UPDATE OR DELETE
  ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_workspace_status_realtime();

INSERT INTO public.workspace_status_realtime (
  id,
  slug,
  owner_name,
  created_at,
  is_active,
  has_paid,
  is_trial,
  trial_link_id,
  trial_started_at,
  trial_ends_at,
  trial_expired,
  subscription_started_at,
  subscription_ends_at,
  force_sub_warning,
  revoked_at,
  revoked_by,
  revoke_reason
)
SELECT
  id,
  slug,
  owner_name,
  created_at,
  is_active,
  has_paid,
  is_trial,
  trial_link_id,
  trial_started_at,
  trial_ends_at,
  trial_expired,
  subscription_started_at,
  subscription_ends_at,
  force_sub_warning,
  revoked_at,
  revoked_by,
  revoke_reason
FROM public.workspaces
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  owner_name = EXCLUDED.owner_name,
  created_at = EXCLUDED.created_at,
  is_active = EXCLUDED.is_active,
  has_paid = EXCLUDED.has_paid,
  is_trial = EXCLUDED.is_trial,
  trial_link_id = EXCLUDED.trial_link_id,
  trial_started_at = EXCLUDED.trial_started_at,
  trial_ends_at = EXCLUDED.trial_ends_at,
  trial_expired = EXCLUDED.trial_expired,
  subscription_started_at = EXCLUDED.subscription_started_at,
  subscription_ends_at = EXCLUDED.subscription_ends_at,
  force_sub_warning = EXCLUDED.force_sub_warning,
  revoked_at = EXCLUDED.revoked_at,
  revoked_by = EXCLUDED.revoked_by,
  revoke_reason = EXCLUDED.revoke_reason,
  updated_at = now();

ALTER TABLE public.workspace_status_realtime REPLICA IDENTITY FULL;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workspace_status_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.workspace_status_realtime;
  END IF;
END;
$block$;

COMMIT;
