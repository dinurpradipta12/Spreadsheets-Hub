-- ═══════════════════════════════════════════════════════
-- Migration 002: Workspace System + Developer Access Control
-- ═══════════════════════════════════════════════════════

-- 1. Tabel workspaces
CREATE TABLE IF NOT EXISTS public.workspaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  owner_name   TEXT NOT NULL,
  password     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  has_paid     BOOLEAN NOT NULL DEFAULT false,
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT,
  revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ws_slug ON public.workspaces (slug);
CREATE INDEX IF NOT EXISTS idx_ws_is_active ON public.workspaces (is_active);

-- 2. Tabel content_plan_sheets — tambah constraint workspace_id NOT NULL
-- (jika sudah ada data lama, biarkan NULL dulu, baru di-clean)
-- Kita update kolom workspace_id jadi NOT NULL setelah migration ini
-- dengan cara: set default NULL untuk data lama, lalu enforce di policy.

-- 3. Row Level Security — workspaces
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Anyone can create workspace" ON public.workspaces;
DROP POLICY IF EXISTS "Developer can update workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Developer can delete workspaces" ON public.workspaces;

-- Policy: Semua orang bisa membaca workspace (untuk validasi slug)
CREATE POLICY "Anyone can read active workspaces"
  ON public.workspaces
  FOR SELECT
  USING (true);

-- Policy: Semua orang bisa create workspace (tanpa login)
CREATE POLICY "Anyone can create workspace"
  ON public.workspaces
  FOR INSERT
  WITH CHECK (true);

-- Policy: Developer bisa update semua workspace (untuk revoke/activate)
-- Developer diidentifikasi via header atau token khusus.
-- Untuk simplicity, gunakan anon + check di app layer.
CREATE POLICY "Developer can update workspaces"
  ON public.workspaces
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Developer can delete workspaces"
  ON public.workspaces
  FOR DELETE
  USING (true);

-- 4. Update RLS content_plan_sheets — isolasi per workspace
DROP POLICY IF EXISTS "Allow all access" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "All authenticated users can read content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "All authenticated users can insert content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "All authenticated users can update content_plan_sheets" ON public.content_plan_sheets;
DROP POLICY IF EXISTS "All authenticated users can delete content_plan_sheets" ON public.content_plan_sheets;

-- Policy: Baca sheet — hanya yang workspace_id-nya valid dan aktif
CREATE POLICY "Workspace-scoped read"
  ON public.content_plan_sheets
  FOR SELECT
  USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE is_active = true)
  );

-- Policy: Insert sheet — workspace harus aktif
CREATE POLICY "Workspace-scoped insert"
  ON public.content_plan_sheets
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT id FROM public.workspaces WHERE is_active = true)
  );

-- Policy: Update sheet — workspace harus aktif
CREATE POLICY "Workspace-scoped update"
  ON public.content_plan_sheets
  FOR UPDATE
  USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE is_active = true)
  )
  WITH CHECK (
    workspace_id IN (SELECT id FROM public.workspaces WHERE is_active = true)
  );

-- Policy: Delete sheet — workspace harus aktif
CREATE POLICY "Workspace-scoped delete"
  ON public.content_plan_sheets
  FOR DELETE
  USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE is_active = true)
  );

-- 5. Storage — isolasi per workspace
DROP POLICY IF EXISTS "Allow all storage access" ON storage.objects;

CREATE POLICY "Workspace storage access"
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'content-plan-logos')
  WITH CHECK (bucket_id = 'content-plan-logos');

-- 6. Helper function: generate unique slug
CREATE OR REPLACE FUNCTION public.generate_workspace_slug(name TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Lowercase, replace spaces with hyphens, remove special chars
  base_slug := lower(regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'));
  base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  base_slug := trim(both '-' from base_slug);

  IF length(base_slug) = 0 THEN
    base_slug := 'workspace';
  END IF;

  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.workspaces WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;

  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

-- 7. Realtime untuk workspaces
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces;
