-- ═══════════════════════════════════════════════════════════════════
-- Migration 013: Safe public workspace directory
--
-- The client needs non-secret workspace metadata to resolve a slug and show
-- the landing/admin screens.  It must never read public.workspaces directly,
-- because that table contains the owner password.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.workspace_public;

CREATE VIEW public.workspace_public AS
SELECT
  id, slug, owner_name, created_at, is_active, has_paid,
  is_trial, trial_link_id, trial_expired, trial_started_at, trial_ends_at,
  subscription_started_at, subscription_ends_at, force_sub_warning,
  revoked_at, revoked_by, revoke_reason
FROM public.workspaces;

REVOKE ALL ON public.workspace_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_public TO anon, authenticated;

COMMIT;
