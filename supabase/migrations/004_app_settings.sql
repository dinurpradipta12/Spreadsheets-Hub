-- ═══════════════════════════════════════════════════════
-- Migration 004: App Settings + Per-User Trial Duration
-- ═══════════════════════════════════════════════════════

-- 1. Tabel app_settings — konfigurasi global
CREATE TABLE IF NOT EXISTS public.app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default settings
INSERT INTO public.app_settings (key, value) VALUES
  ('whatsapp_number', '6281234567890'),
  ('trial_duration_hours', '36'),
  ('app_name', 'Spreadsheets Hub Manager'),
  ('app_description', 'Spreadsheets Management by Dinur Pradipta')
ON CONFLICT (key) DO NOTHING;

-- 2. Tambah kolom trial_duration_hours di trial_links
ALTER TABLE public.trial_links ADD COLUMN IF NOT EXISTS trial_duration_hours INTEGER NOT NULL DEFAULT 36;
-- Kolom expires_at tetap ada tapi akan dihitung saat user register, bukan saat link dibuat
ALTER TABLE public.trial_links ADD COLUMN IF NOT EXISTS per_user_expiry BOOLEAN NOT NULL DEFAULT true;

-- 3. Tambah kolom trial_started_at di workspaces — waktu user mulai trial
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ws_trial_ends ON public.workspaces (trial_ends_at);

-- 4. Helper: get setting value
CREATE OR REPLACE FUNCTION public.get_setting(p_key TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT value FROM public.app_settings WHERE key = p_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RLS untuk app_settings
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anyone can update app_settings" ON public.app_settings;

CREATE POLICY "Anyone can read app_settings"
  ON public.app_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update app_settings"
  ON public.app_settings
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can insert app_settings"
  ON public.app_settings
  FOR INSERT
  WITH CHECK (true);

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
