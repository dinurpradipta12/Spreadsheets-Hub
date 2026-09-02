-- ═══════════════════════════════════════════════════════
-- Migration 003: Trial / Demo System
-- ═══════════════════════════════════════════════════════

-- 1. Tabel trial_links — link demo dengan masa berlaku
CREATE TABLE IF NOT EXISTS public.trial_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_code   TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_trial_code ON public.trial_links (link_code);
CREATE INDEX IF NOT EXISTS idx_trial_expires ON public.trial_links (expires_at);

-- 2. Tambah kolom trial di workspaces
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS trial_link_id UUID REFERENCES public.trial_links(id);
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS trial_expired BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ws_is_trial ON public.workspaces (is_trial);
CREATE INDEX IF NOT EXISTS idx_ws_trial_expired ON public.workspaces (trial_expired);

-- 3. Helper function: generate trial link code
CREATE OR REPLACE FUNCTION public.generate_trial_link_code()
RETURNS TEXT AS $$
DECLARE
  code TEXT;
BEGIN
  code := 'demo-' || lower(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
  WHILE EXISTS (SELECT 1 FROM public.trial_links WHERE link_code = code) LOOP
    code := 'demo-' || lower(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- 4. Realtime untuk trial_links
ALTER PUBLICATION supabase_realtime ADD TABLE public.trial_links;

-- 5. RLS untuk trial_links
ALTER TABLE public.trial_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active trial links" ON public.trial_links;
DROP POLICY IF EXISTS "Anyone can create trial links" ON public.trial_links;

CREATE POLICY "Anyone can read trial links"
  ON public.trial_links
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create trial links"
  ON public.trial_links
  FOR INSERT
  WITH CHECK (true);
