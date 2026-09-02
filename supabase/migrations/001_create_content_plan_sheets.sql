-- ═══════════════════════════════════════════════════════
-- Migration: Create content_plan_sheets table
-- ═══════════════════════════════════════════════════════

-- 1. Tabel utama
CREATE TABLE IF NOT EXISTS public.content_plan_sheets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  client_id   UUID,
  client_name TEXT NOT NULL,
  title       TEXT NOT NULL,
  sheet_url   TEXT NOT NULL,
  embed_url   TEXT,
  platform    TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  logo_url    TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index
CREATE INDEX IF NOT EXISTS idx_cps_workspace_id ON public.content_plan_sheets (workspace_id);
CREATE INDEX IF NOT EXISTS idx_cps_updated_at ON public.content_plan_sheets (updated_at DESC);

-- 3. Trigger otomatis updated_at
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_plan_sheets_updated_at ON public.content_plan_sheets;
CREATE TRIGGER trg_content_plan_sheets_updated_at
  BEFORE UPDATE ON public.content_plan_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_updated_at();

-- 4. Row Level Security (RLS)
ALTER TABLE public.content_plan_sheets ENABLE ROW LEVEL SECURITY;

-- Hapus semua policy lama
DROP POLICY IF EXISTS "All authenticated users can read content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "All authenticated users can insert content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "All authenticated users can update content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "All authenticated users can delete content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Workspace members can read content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Authenticated users can insert content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Workspace members can update content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Workspace members can delete content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "Allow all access" ON public.content_plan_sheets;

-- Policy: Izinkan semua (anon + authenticated) — untuk development
-- Nanti bisa diganti dengan auth-based policy setelah ada login.
CREATE POLICY "Allow all access"
  ON public.content_plan_sheets
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Supabase Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.content_plan_sheets;

-- 6. Storage bucket untuk logo klien
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-plan-logos',
  'content-plan-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
) ON CONFLICT (id) DO NOTHING;

-- Hapus policy storage lama
DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow all storage access" ON storage.objects;

-- Policy: Izinkan semua akses storage (untuk development)
CREATE POLICY "Allow all storage access"
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'content-plan-logos')
  WITH CHECK (bucket_id = 'content-plan-logos');
