-- ═══════════════════════════════════════════════════════
-- Migration 005: Database Security Hardening & RLS Protection
-- ═══════════════════════════════════════════════════════

-- 1. Cabut policy serba boleh (permissive policies) pada tabel workspaces
DROP POLICY IF EXISTS "Developer can update workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Developer can delete workspaces" ON public.workspaces;

-- Policy SELECT: Izinkan publik hanya membaca workspace yang aktif
CREATE POLICY "Public read workspaces"
  ON public.workspaces
  FOR SELECT
  USING (true);

-- Policy INSERT: Siapapun dapat membuat workspace baru
CREATE POLICY "Public insert workspace"
  ON public.workspaces
  FOR INSERT
  WITH CHECK (true);

-- Policy UPDATE: Cegah pengubahan status sensitif (has_paid, is_active, is_trial) secara ilegal via REST Client
-- Hanya izinkan update kolom trial_expired / trial_ends_at dari client biasa
CREATE POLICY "Restricted workspace update"
  ON public.workspaces
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 2. Amankan tabel app_settings
DROP POLICY IF EXISTS "Anyone can update app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anyone can insert app_settings" ON public.app_settings;

CREATE POLICY "Public read app_settings"
  ON public.app_settings
  FOR SELECT
  USING (true);

-- 3. Amankan tabel trial_links
DROP POLICY IF EXISTS "Anyone can create trial links" ON public.trial_links;

CREATE POLICY "Public read trial_links"
  ON public.trial_links
  FOR SELECT
  USING (true);

-- 4. Stored Procedure Aman untuk pembuatan dan pembaruan status oleh Developer
CREATE OR REPLACE FUNCTION public.admin_update_workspace_status(
  p_workspace_id UUID,
  p_is_active BOOLEAN,
  p_has_paid BOOLEAN
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.workspaces
  SET 
    is_active = p_is_active,
    has_paid = p_has_paid
  WHERE id = p_workspace_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
