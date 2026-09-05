-- ═══════════════════════════════════════════════════════════════════
-- Migration 014: global document template catalog
--
-- Templates are intentionally global and non-sensitive: every workspace can
-- read the active catalog, while writes go through controlled RPCs used by the
-- developer panel. Documents store a template snapshot in their JSON payload,
-- so changing the catalog never changes an existing saved document.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_document_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'file-text',
  kind TEXT NOT NULL DEFAULT 'both' CHECK (kind IN ('invoice', 'quote', 'both')),
  variant TEXT NOT NULL DEFAULT 'classic' CHECK (variant IN ('classic', 'project', 'corporate', 'soft')),
  font TEXT NOT NULL DEFAULT 'Inter/Sans' CHECK (font IN ('Inter/Sans', 'Arial', 'Georgia', 'Times New Roman', 'Courier New')),
  accent_color TEXT NOT NULL DEFAULT '#24324A',
  background_color TEXT NOT NULL DEFAULT '#FFFFFF',
  text_color TEXT NOT NULL DEFAULT '#1F2937',
  surface_color TEXT NOT NULL DEFAULT '#F3F4F6',
  border_color TEXT NOT NULL DEFAULT '#D7DCE4',
  muted_color TEXT NOT NULL DEFAULT '#667085',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_document_templates_active_order_idx
  ON public.app_document_templates (is_active, sort_order, name);

DROP TRIGGER IF EXISTS set_app_document_templates_updated_at ON public.app_document_templates;
CREATE TRIGGER set_app_document_templates_updated_at
  BEFORE UPDATE ON public.app_document_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.app_document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read document templates" ON public.app_document_templates;
CREATE POLICY "Public read document templates"
  ON public.app_document_templates
  FOR SELECT
  USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_document_templates FROM anon, authenticated;
GRANT SELECT ON public.app_document_templates TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_document_template(p_template JSONB)
RETURNS public.app_document_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  result public.app_document_templates;
  template_id TEXT := trim(coalesce(p_template->>'id', ''));
  template_name TEXT := left(trim(coalesce(p_template->>'name', '')), 180);
  template_description TEXT := left(coalesce(p_template->>'description', ''), 1000);
  template_icon TEXT := left(coalesce(nullif(trim(p_template->>'icon'), ''), 'file-text'), 80);
  template_kind TEXT := coalesce(nullif(trim(p_template->>'kind'), ''), 'both');
  template_variant TEXT := coalesce(nullif(trim(p_template->>'variant'), ''), 'classic');
  template_font TEXT := coalesce(nullif(trim(p_template->>'font'), ''), 'Inter/Sans');
  template_sort_order INTEGER := coalesce(nullif(trim(p_template->>'sortOrder'), '')::INTEGER, 0);
  template_is_active BOOLEAN := coalesce(nullif(trim(p_template->>'isActive'), '')::BOOLEAN, TRUE);
  template_version INTEGER := greatest(coalesce(nullif(trim(p_template->>'version'), '')::INTEGER, 1), 1);
BEGIN
  IF template_id = '' THEN
    RAISE EXCEPTION 'Template ID wajib diisi';
  END IF;
  IF template_name = '' THEN
    RAISE EXCEPTION 'Nama template wajib diisi';
  END IF;
  IF template_sort_order < 0 THEN
    RAISE EXCEPTION 'Urutan template tidak boleh negatif';
  END IF;

  INSERT INTO public.app_document_templates (
    id,
    name,
    description,
    icon,
    kind,
    variant,
    font,
    accent_color,
    background_color,
    text_color,
    surface_color,
    border_color,
    muted_color,
    sort_order,
    is_active,
    version
  )
  VALUES (
    template_id,
    template_name,
    template_description,
    template_icon,
    template_kind,
    template_variant,
    template_font,
    left(coalesce(p_template->>'accentColor', '#24324A'), 32),
    left(coalesce(p_template->>'backgroundColor', '#FFFFFF'), 32),
    left(coalesce(p_template->>'textColor', '#1F2937'), 32),
    left(coalesce(p_template->>'surfaceColor', '#F3F4F6'), 32),
    left(coalesce(p_template->>'borderColor', '#D7DCE4'), 32),
    left(coalesce(p_template->>'mutedColor', '#667085'), 32),
    template_sort_order,
    template_is_active,
    template_version
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    kind = EXCLUDED.kind,
    variant = EXCLUDED.variant,
    font = EXCLUDED.font,
    accent_color = EXCLUDED.accent_color,
    background_color = EXCLUDED.background_color,
    text_color = EXCLUDED.text_color,
    surface_color = EXCLUDED.surface_color,
    border_color = EXCLUDED.border_color,
    muted_color = EXCLUDED.muted_color,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    version = public.app_document_templates.version + 1,
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_document_template(p_template_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.app_document_templates WHERE id = trim(p_template_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_document_template(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_document_template(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_document_template(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_document_template(TEXT) TO anon, authenticated;

INSERT INTO public.app_document_templates (
  id, name, description, icon, kind, variant, font,
  accent_color, background_color, text_color, surface_color, border_color, muted_color, sort_order
)
VALUES
  ('classic-ledger', 'Klasik Ledger', 'Header tegas, blok penerima lembut, dan tabel yang rapi.', 'file-text', 'both', 'classic', 'Inter/Sans', '#24324A', '#FFFFFF', '#1F2937', '#F3F4F6', '#D7DCE4', '#667085', 0),
  ('project-minimal', 'Minimal Proyek', 'Ruang putih luas dengan komposisi editorial yang ringan.', 'layout-list', 'both', 'project', 'Inter/Sans', '#111827', '#FFFFFF', '#1F2937', '#F8FAFC', '#D1D5DB', '#6B7280', 1),
  ('corporate-grid', 'Corporate Grid', 'Kontras satu warna dengan tabel dan total yang kuat.', 'building-2', 'both', 'corporate', 'Arial', '#374151', '#FFFFFF', '#111827', '#E5E7EB', '#CBD5E1', '#64748B', 2),
  ('soft-editorial', 'Soft Editorial', 'Latar abu lembut dengan detail yang tenang dan modern.', 'sparkles', 'both', 'soft', 'Inter/Sans', '#56687A', '#F8FAFC', '#24324A', '#E8EEF2', '#D6E0E6', '#718096', 3)
ON CONFLICT (id) DO NOTHING;

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'app_document_templates'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_document_templates;
  END IF;
END;
$block$;

COMMIT;
