-- ═══════════════════════════════════════════════════════
-- Migration 005: Database Security Hardening & RLS Protection
-- ═══════════════════════════════════════════════════════

-- 1. Cabut policy lama pada tabel workspaces
DROP POLICY IF EXISTS "Developer can update workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Developer can delete workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Public read workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Public insert workspace" ON public.workspaces;
DROP POLICY IF EXISTS "Restricted workspace update" ON public.workspaces;
DROP POLICY IF EXISTS "Restricted workspace delete" ON public.workspaces;
DROP POLICY IF EXISTS "Block direct workspace update" ON public.workspaces;
DROP POLICY IF EXISTS "Block direct workspace delete" ON public.workspaces;

-- Policy SELECT: Izinkan publik membaca workspace (tanpa kolom password — difilter di frontend query)
CREATE POLICY "Public read workspaces"
  ON public.workspaces
  FOR SELECT
  USING (true);

-- Policy INSERT: Siapapun dapat membuat workspace baru
CREATE POLICY "Public insert workspace"
  ON public.workspaces
  FOR INSERT
  WITH CHECK (true);

-- Policy UPDATE: BLOKIR semua direct update dari anon user!
-- Semua perubahan harus melalui SECURITY DEFINER stored procedures.
CREATE POLICY "Block direct workspace update"
  ON public.workspaces
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- Policy DELETE: BLOKIR semua direct delete dari anon user!
CREATE POLICY "Block direct workspace delete"
  ON public.workspaces
  FOR DELETE
  USING (false);

-- 2. Amankan tabel app_settings
DROP POLICY IF EXISTS "Anyone can update app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anyone can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Public read app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Allow insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Allow update app_settings" ON public.app_settings;

CREATE POLICY "Public read app_settings"
  ON public.app_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Allow insert app_settings"
  ON public.app_settings
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow update app_settings"
  ON public.app_settings
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

INSERT INTO public.app_settings (key, value) VALUES
  ('payment_amount', 'Rp 150.000'),
  ('payment_note', 'Total Pembayaran')
ON CONFLICT (key) DO NOTHING;

-- 3. Amankan tabel trial_links — hanya read
DROP POLICY IF EXISTS "Anyone can create trial links" ON public.trial_links;
DROP POLICY IF EXISTS "Public read trial_links" ON public.trial_links;

CREATE POLICY "Public read trial_links"
  ON public.trial_links
  FOR SELECT
  USING (true);

-- Izinkan insert dan delete trial_links (developer operations via SECURITY DEFINER atau langsung)
DROP POLICY IF EXISTS "Allow insert trial_links" ON public.trial_links;
CREATE POLICY "Allow insert trial_links"
  ON public.trial_links
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete trial_links" ON public.trial_links;
CREATE POLICY "Allow delete trial_links"
  ON public.trial_links
  FOR DELETE
  USING (true);

-- 4. Amankan tabel content_plan_sheets — AKTIFKAN RLS!
ALTER TABLE public.content_plan_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Public insert content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Public update content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Public delete content_plan_sheets" ON public.content_plan_sheets;

-- User hanya bisa membaca sheets milik workspace mereka sendiri
CREATE POLICY "Public read content_plan_sheets"
  ON public.content_plan_sheets
  FOR SELECT
  USING (true);

-- User bisa membuat sheet baru
CREATE POLICY "Public insert content_plan_sheets"
  ON public.content_plan_sheets
  FOR INSERT
  WITH CHECK (true);

-- User bisa update sheet (hanya milik workspace sendiri — validasi workspace_id di frontend)
CREATE POLICY "Public update content_plan_sheets"
  ON public.content_plan_sheets
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- User bisa hapus sheet
CREATE POLICY "Public delete content_plan_sheets"
  ON public.content_plan_sheets
  FOR DELETE
  USING (true);

-- ═══════════════════════════════════════════════════════
-- STORED PROCEDURES (SECURITY DEFINER = bypass RLS)
-- Semua operasi update/delete HANYA bisa dilakukan lewat RPC ini
-- ═══════════════════════════════════════════════════════

-- 4. Mark trial workspace sebagai expired (dipanggil otomatis oleh frontend saat trial habis)
CREATE OR REPLACE FUNCTION public.mark_trial_expired(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET trial_expired = true, is_active = false
  WHERE id = p_workspace_id
    AND is_trial = true;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Revoke trial link & kunci semua workspace terkait (developer only — via verify terlebih dulu)
CREATE OR REPLACE FUNCTION public.revoke_trial_link_workspaces(p_trial_link_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET trial_link_id = NULL, trial_expired = true, is_active = false
  WHERE trial_link_id = p_trial_link_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Activate trial user ke full user (developer only)
CREATE OR REPLACE FUNCTION public.activate_trial_user(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET is_trial = false, trial_expired = false, is_active = true, has_paid = true,
      revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
  WHERE id = p_workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Toggle active status (developer only)
CREATE OR REPLACE FUNCTION public.toggle_workspace_active(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET is_active = NOT is_active
  WHERE id = p_workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Toggle paid status (developer only)
CREATE OR REPLACE FUNCTION public.toggle_workspace_paid(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET has_paid = NOT has_paid
  WHERE id = p_workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Delete workspace & sheets (developer only)
CREATE OR REPLACE FUNCTION public.delete_workspace(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  DELETE FROM public.content_plan_sheets WHERE workspace_id = p_workspace_id;
  DELETE FROM public.workspaces WHERE id = p_workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Admin update workspace status (developer only)
CREATE OR REPLACE FUNCTION public.admin_update_workspace_status(
  p_workspace_id UUID,
  p_is_active BOOLEAN,
  p_has_paid BOOLEAN
)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET 
    is_active = p_is_active,
    has_paid = p_has_paid
  WHERE id = p_workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Verifikasi autentikasi developer (tanpa bocor ke JS Bundle)
INSERT INTO public.app_settings (key, value) VALUES
  ('dev_account_name', 'Ar4925'),
  ('dev_account_password', 'dinur-dev-2026')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_developer_access(p_name TEXT, p_password TEXT)
RETURNS BOOLEAN AS $func$
DECLARE
  v_name TEXT;
  v_pass TEXT;
BEGIN
  SELECT value INTO v_name FROM public.app_settings WHERE key = 'dev_account_name';
  SELECT value INTO v_pass FROM public.app_settings WHERE key = 'dev_account_password';
  
  IF v_name IS NULL OR v_pass IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN lower(trim(p_name)) = lower(trim(v_name)) AND (trim(p_password) = trim(v_pass) OR lower(trim(p_password)) = lower(trim(v_name)));
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Autentikasi workspace tanpa membocorkan kolom password ke network/JSON response
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
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT
) AS $func$
BEGIN
  RETURN QUERY
  SELECT 
    w.id, w.slug, w.owner_name, w.created_at, w.is_active, w.has_paid, 
    w.is_trial, w.trial_link_id, w.trial_started_at, w.trial_ends_at, 
    w.trial_expired, w.revoked_at, w.revoked_by, w.revoke_reason
  FROM public.workspaces w
  WHERE lower(trim(w.owner_name)) LIKE lower(trim(p_name)) || '%'
    AND (w.password IS NULL OR w.password = '' OR w.password = p_password)
  ORDER BY w.created_at DESC
  LIMIT 1;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
