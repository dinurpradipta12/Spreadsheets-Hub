-- ═══════════════════════════════════════════════════════════════════
-- Migration 011: Invoice Studio, Quotation Studio, and Fee Calculator
-- Standalone and safe to run repeatedly in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Optional Supabase Auth membership records. The current app also uses
-- app_workspace_sessions through the Edge Function for its custom workspace login.
CREATE TABLE IF NOT EXISTS public.app_workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_email TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'finance', 'pricing', 'member')),
  page_access TEXT[] NOT NULL DEFAULT ARRAY['sheets']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_workspace_members_user
  ON public.app_workspace_members (user_id, workspace_id);

CREATE TABLE IF NOT EXISTS public.app_workspace_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  actor_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'finance', 'pricing', 'member')),
  page_access TEXT[] NOT NULL DEFAULT ARRAY['sheets', 'fee-calculator', 'invoices', 'quotes']::TEXT[],
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_workspace_sessions_lookup
  ON public.app_workspace_sessions (workspace_id, expires_at DESC);

-- Fee Calculator tables
CREATE TABLE IF NOT EXISTS public.fee_calculator_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  hours_per_day NUMERIC NOT NULL DEFAULT 7 CHECK (hours_per_day >= 0),
  days_per_week NUMERIC NOT NULL DEFAULT 5 CHECK (days_per_week >= 0),
  profit_margin_percent NUMERIC NOT NULL DEFAULT 40 CHECK (profit_margin_percent >= 0),
  custom_quote JSONB NOT NULL DEFAULT '{"items":[],"discountPercent":0,"taxPercent":0,"notes":""}'::JSONB,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_calculator_settings
  ADD COLUMN IF NOT EXISTS custom_quote JSONB NOT NULL
  DEFAULT '{"items":[],"discountPercent":0,"taxPercent":0,"notes":""}'::JSONB;

CREATE TABLE IF NOT EXISTS public.fee_living_cost_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_production_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  hours_per_item NUMERIC NOT NULL DEFAULT 0 CHECK (hours_per_item >= 0),
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_addon_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0 CHECK (price >= 0),
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_operational_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  markup_percent NUMERIC NOT NULL DEFAULT 0 CHECK (markup_percent >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sort_order)
);

CREATE TABLE IF NOT EXISTS public.fee_unit_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('production', 'addon', 'operational', 'other')),
  unit TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0 CHECK (price >= 0),
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_quote_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by TEXT,
  discount_percent NUMERIC NOT NULL DEFAULT 0 CHECK (discount_percent >= 0),
  tax_percent NUMERIC NOT NULL DEFAULT 0 CHECK (tax_percent >= 0),
  notes TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount NUMERIC NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total NUMERIC NOT NULL DEFAULT 0 CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'consumed', 'converted', 'expired')),
  quote_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_quote_draft_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.fee_quote_drafts(id) ON DELETE CASCADE,
  unit_price_id UUID REFERENCES public.fee_unit_prices(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_price NUMERIC NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

-- Document tables keep a JSONB snapshot so historical prices never follow catalog edits.
CREATE TABLE IF NOT EXISTS public.app_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  quote_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  source_fee_calculation_id UUID REFERENCES public.fee_quote_drafts(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, quote_number)
);

ALTER TABLE public.fee_quote_drafts
  DROP CONSTRAINT IF EXISTS fee_quote_drafts_quote_id_fkey;
ALTER TABLE public.fee_quote_drafts
  ADD CONSTRAINT fee_quote_drafts_quote_id_fkey
  FOREIGN KEY (quote_id) REFERENCES public.app_quotes(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.app_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  source_quote_id UUID REFERENCES public.app_quotes(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, invoice_number)
);

-- Workspace + updated_at indexes
CREATE INDEX IF NOT EXISTS idx_app_invoices_workspace_updated
  ON public.app_invoices (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_quotes_workspace_updated
  ON public.app_quotes (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_quotes_source_fee_calculation
  ON public.app_quotes (source_fee_calculation_id)
  WHERE source_fee_calculation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_invoices_source_quote
  ON public.app_invoices (source_quote_id)
  WHERE source_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_settings_workspace_updated
  ON public.fee_calculator_settings (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_living_workspace_order
  ON public.fee_living_cost_items (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_fee_production_workspace_order
  ON public.fee_production_items (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_fee_addon_workspace_order
  ON public.fee_addon_items (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_fee_operational_workspace_order
  ON public.fee_operational_items (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_fee_packages_workspace_order
  ON public.fee_packages (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_fee_unit_prices_workspace_order
  ON public.fee_unit_prices (workspace_id, category, sort_order);
CREATE INDEX IF NOT EXISTS idx_fee_quote_drafts_workspace_updated
  ON public.fee_quote_drafts (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_quote_drafts_quote
  ON public.fee_quote_drafts (quote_id)
  WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_quote_draft_items_draft_order
  ON public.fee_quote_draft_items (draft_id, sort_order);

-- Updated-at triggers
DO $block$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'app_workspace_members', 'fee_calculator_settings', 'fee_living_cost_items',
    'fee_production_items', 'fee_addon_items', 'fee_operational_items',
    'fee_packages', 'fee_unit_prices', 'fee_quote_drafts', 'app_quotes', 'app_invoices'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || table_name || '_updated_at', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at()',
      'trg_' || table_name || '_updated_at',
      table_name
    );
  END LOOP;
END;
$block$;

-- Supabase Auth helpers. SECURITY DEFINER avoids policy recursion while still
-- binding the check to auth.uid(). The custom-workspace app uses the Edge API.
CREATE OR REPLACE FUNCTION public.app_has_workspace_access(p_workspace_id UUID, p_page TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_workspace_members member
    WHERE member.workspace_id = p_workspace_id
      AND member.user_id = auth.uid()
      AND (member.role = 'admin' OR p_page = ANY(member.page_access))
  );
$function$;

CREATE OR REPLACE FUNCTION public.app_can_manage_pricing(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_workspace_members member
    WHERE member.workspace_id = p_workspace_id
      AND member.user_id = auth.uid()
      AND member.role IN ('admin', 'finance', 'pricing')
  );
$function$;

-- Storage object names may contain arbitrary first segments. Convert only valid
-- workspace UUID folders so a malformed path cannot make a read policy error.
CREATE OR REPLACE FUNCTION public.app_business_path_workspace(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
BEGIN
  RETURN split_part(p_name, '/', 1)::UUID;
EXCEPTION
  WHEN invalid_text_representation THEN RETURN NULL;
END;
$function$;

-- RLS is enabled everywhere. No policy uses USING (true).
ALTER TABLE public.app_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_workspace_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_calculator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_living_cost_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_production_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_addon_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_operational_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_unit_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_quote_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_quote_draft_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own membership" ON public.app_workspace_members;
CREATE POLICY "Members read own membership" ON public.app_workspace_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage workspace membership" ON public.app_workspace_members;
CREATE POLICY "Admins manage workspace membership" ON public.app_workspace_members
  FOR ALL TO authenticated
  USING (public.app_has_workspace_access(workspace_id, 'members'))
  WITH CHECK (public.app_has_workspace_access(workspace_id, 'members'));

-- Reusable, explicit policies for document records.
DROP POLICY IF EXISTS "Workspace members read invoices" ON public.app_invoices;
CREATE POLICY "Workspace members read invoices" ON public.app_invoices
  FOR SELECT TO authenticated USING (public.app_has_workspace_access(workspace_id, 'invoices'));
DROP POLICY IF EXISTS "Workspace members insert invoices" ON public.app_invoices;
CREATE POLICY "Workspace members insert invoices" ON public.app_invoices
  FOR INSERT TO authenticated WITH CHECK (public.app_has_workspace_access(workspace_id, 'invoices'));
DROP POLICY IF EXISTS "Workspace members update invoices" ON public.app_invoices;
CREATE POLICY "Workspace members update invoices" ON public.app_invoices
  FOR UPDATE TO authenticated USING (public.app_has_workspace_access(workspace_id, 'invoices'))
  WITH CHECK (public.app_has_workspace_access(workspace_id, 'invoices'));
DROP POLICY IF EXISTS "Workspace members delete invoices" ON public.app_invoices;
CREATE POLICY "Workspace members delete invoices" ON public.app_invoices
  FOR DELETE TO authenticated USING (public.app_has_workspace_access(workspace_id, 'invoices'));

DROP POLICY IF EXISTS "Workspace members read quotes" ON public.app_quotes;
CREATE POLICY "Workspace members read quotes" ON public.app_quotes
  FOR SELECT TO authenticated USING (public.app_has_workspace_access(workspace_id, 'quotes'));
DROP POLICY IF EXISTS "Workspace members insert quotes" ON public.app_quotes;
CREATE POLICY "Workspace members insert quotes" ON public.app_quotes
  FOR INSERT TO authenticated WITH CHECK (public.app_has_workspace_access(workspace_id, 'quotes'));
DROP POLICY IF EXISTS "Workspace members update quotes" ON public.app_quotes;
CREATE POLICY "Workspace members update quotes" ON public.app_quotes
  FOR UPDATE TO authenticated USING (public.app_has_workspace_access(workspace_id, 'quotes'))
  WITH CHECK (public.app_has_workspace_access(workspace_id, 'quotes'));
DROP POLICY IF EXISTS "Workspace members delete quotes" ON public.app_quotes;
CREATE POLICY "Workspace members delete quotes" ON public.app_quotes
  FOR DELETE TO authenticated USING (public.app_has_workspace_access(workspace_id, 'quotes'));

-- Pricing/settings are readable by Fee Calculator users and writable by pricing roles.
DO $block$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fee_calculator_settings', 'fee_living_cost_items', 'fee_production_items',
    'fee_addon_items', 'fee_operational_items', 'fee_packages', 'fee_unit_prices'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Workspace members read ' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_has_workspace_access(workspace_id, ''fee-calculator''))',
      'Workspace members read ' || table_name,
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Pricing roles manage ' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.app_can_manage_pricing(workspace_id)) WITH CHECK (public.app_can_manage_pricing(workspace_id))',
      'Pricing roles manage ' || table_name,
      table_name
    );
  END LOOP;
END;
$block$;

DROP POLICY IF EXISTS "Quote users read fee drafts" ON public.fee_quote_drafts;
CREATE POLICY "Quote users read fee drafts" ON public.fee_quote_drafts
  FOR SELECT TO authenticated USING (
    public.app_has_workspace_access(workspace_id, 'quotes') OR
    public.app_has_workspace_access(workspace_id, 'fee-calculator')
  );
DROP POLICY IF EXISTS "Quote users create fee drafts" ON public.fee_quote_drafts;
CREATE POLICY "Quote users create fee drafts" ON public.fee_quote_drafts
  FOR INSERT TO authenticated WITH CHECK (
    public.app_has_workspace_access(workspace_id, 'quotes') OR
    public.app_has_workspace_access(workspace_id, 'fee-calculator')
  );
DROP POLICY IF EXISTS "Quote users update fee drafts" ON public.fee_quote_drafts;
CREATE POLICY "Quote users update fee drafts" ON public.fee_quote_drafts
  FOR UPDATE TO authenticated USING (
    public.app_has_workspace_access(workspace_id, 'quotes') OR
    public.app_has_workspace_access(workspace_id, 'fee-calculator')
  ) WITH CHECK (
    public.app_has_workspace_access(workspace_id, 'quotes') OR
    public.app_has_workspace_access(workspace_id, 'fee-calculator')
  );

DROP POLICY IF EXISTS "Quote users read fee draft items" ON public.fee_quote_draft_items;
CREATE POLICY "Quote users read fee draft items" ON public.fee_quote_draft_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.fee_quote_drafts draft
      WHERE draft.id = draft_id
        AND (
          public.app_has_workspace_access(draft.workspace_id, 'quotes') OR
          public.app_has_workspace_access(draft.workspace_id, 'fee-calculator')
        )
    )
  );

-- Secure custom-workspace login. The returned raw token is never stored in Postgres;
-- only its SHA-256 digest is persisted. The Edge Function validates every request.
CREATE OR REPLACE FUNCTION public.authenticate_business_workspace(p_name TEXT, p_password TEXT)
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
  revoke_reason TEXT,
  session_token TEXT,
  business_role TEXT,
  page_access TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  target public.workspaces%ROWTYPE;
  raw_token TEXT;
BEGIN
  SELECT workspace.* INTO target
  FROM public.workspaces workspace
  WHERE lower(trim(workspace.owner_name)) LIKE lower(trim(p_name)) || '%'
    AND (workspace.password IS NULL OR workspace.password = '' OR workspace.password = p_password)
  ORDER BY workspace.created_at DESC
  LIMIT 1;

  IF target.id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.app_workspace_sessions WHERE expires_at <= now();
  raw_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.app_workspace_sessions (
    workspace_id, token_hash, actor_email, role, page_access, expires_at
  ) VALUES (
    target.id,
    encode(digest(raw_token, 'sha256'), 'hex'),
    COALESCE(NULLIF(trim(target.owner_name), ''), 'workspace-owner'),
    'admin',
    ARRAY['sheets', 'fee-calculator', 'invoices', 'quotes', 'pricing', 'finance'],
    now() + interval '30 days'
  );

  RETURN QUERY SELECT
    target.id, target.slug, target.owner_name, target.created_at,
    target.is_active, target.has_paid, target.is_trial, target.trial_link_id,
    target.trial_started_at, target.trial_ends_at, target.trial_expired,
    target.subscription_started_at, target.subscription_ends_at,
    target.force_sub_warning, target.revoked_at, target.revoked_by,
    target.revoke_reason, raw_token, 'admin'::TEXT,
    ARRAY['sheets', 'fee-calculator', 'invoices', 'quotes', 'pricing', 'finance']::TEXT[];
END;
$function$;

REVOKE ALL ON TABLE public.app_workspace_sessions FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.authenticate_business_workspace(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticate_business_workspace(TEXT, TEXT) TO anon, authenticated;

-- Atomic Fee Calculator snapshot write, callable only by the server-side service role.
CREATE OR REPLACE FUNCTION public.save_fee_calculator_state(
  p_workspace_id UUID,
  p_actor TEXT,
  p_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  item JSONB;
BEGIN
  INSERT INTO public.fee_calculator_settings (
    workspace_id, hours_per_day, days_per_week, profit_margin_percent,
    custom_quote, created_by, updated_by
  ) VALUES (
    p_workspace_id,
    GREATEST(0, COALESCE((p_state->>'hoursPerDay')::NUMERIC, 0)),
    GREATEST(0, COALESCE((p_state->>'daysPerWeek')::NUMERIC, 0)),
    GREATEST(0, COALESCE((p_state->>'profitMarginPercent')::NUMERIC, 0)),
    COALESCE(p_state->'customQuote', '{"items":[],"discountPercent":0,"taxPercent":0,"notes":""}'::JSONB),
    p_actor,
    p_actor
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    hours_per_day = EXCLUDED.hours_per_day,
    days_per_week = EXCLUDED.days_per_week,
    profit_margin_percent = EXCLUDED.profit_margin_percent,
    custom_quote = EXCLUDED.custom_quote,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  DELETE FROM public.fee_living_cost_items WHERE workspace_id = p_workspace_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_state->'livingCosts', '[]'::JSONB)) LOOP
    INSERT INTO public.fee_living_cost_items (id, workspace_id, label, description, amount, sort_order)
    VALUES (
      (item->>'id')::UUID, p_workspace_id, COALESCE(item->>'label', ''),
      COALESCE(item->>'description', ''), GREATEST(0, COALESCE((item->>'amount')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'sortOrder')::INTEGER, 0))
    );
  END LOOP;

  DELETE FROM public.fee_production_items WHERE workspace_id = p_workspace_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_state->'productionItems', '[]'::JSONB)) LOOP
    INSERT INTO public.fee_production_items (id, workspace_id, label, hours_per_item, quantity, sort_order)
    VALUES (
      (item->>'id')::UUID, p_workspace_id, COALESCE(item->>'label', ''),
      GREATEST(0, COALESCE((item->>'hoursPerItem')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'quantity')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'sortOrder')::INTEGER, 0))
    );
  END LOOP;

  DELETE FROM public.fee_addon_items WHERE workspace_id = p_workspace_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_state->'addOns', '[]'::JSONB)) LOOP
    INSERT INTO public.fee_addon_items (id, workspace_id, label, price, quantity, sort_order)
    VALUES (
      (item->>'id')::UUID, p_workspace_id, COALESCE(item->>'label', ''),
      GREATEST(0, COALESCE((item->>'price')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'quantity')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'sortOrder')::INTEGER, 0))
    );
  END LOOP;

  DELETE FROM public.fee_operational_items WHERE workspace_id = p_workspace_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_state->'operationalItems', '[]'::JSONB)) LOOP
    INSERT INTO public.fee_operational_items (id, workspace_id, label, description, amount, sort_order)
    VALUES (
      (item->>'id')::UUID, p_workspace_id, COALESCE(item->>'label', ''),
      COALESCE(item->>'description', ''), GREATEST(0, COALESCE((item->>'amount')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'sortOrder')::INTEGER, 0))
    );
  END LOOP;

  DELETE FROM public.fee_packages WHERE workspace_id = p_workspace_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_state->'packages', '[]'::JSONB)) LOOP
    INSERT INTO public.fee_packages (id, workspace_id, name, markup_percent, sort_order)
    VALUES (
      (item->>'id')::UUID, p_workspace_id, COALESCE(item->>'name', 'Paket'),
      GREATEST(0, COALESCE((item->>'markupPercent')::NUMERIC, 0)),
      LEAST(2, GREATEST(0, COALESCE((item->>'sortOrder')::INTEGER, 0)))
    );
  END LOOP;

  DELETE FROM public.fee_unit_prices WHERE workspace_id = p_workspace_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_state->'unitPrices', '[]'::JSONB)) LOOP
    INSERT INTO public.fee_unit_prices (
      id, workspace_id, label, category, unit, price, description,
      is_active, sort_order, created_by, updated_by
    ) VALUES (
      (item->>'id')::UUID, p_workspace_id, COALESCE(item->>'label', ''),
      COALESCE(item->>'category', 'other'), COALESCE(item->>'unit', ''),
      GREATEST(0, COALESCE((item->>'price')::NUMERIC, 0)),
      COALESCE(item->>'description', ''), COALESCE((item->>'isActive')::BOOLEAN, true),
      GREATEST(0, COALESCE((item->>'sortOrder')::INTEGER, 0)), p_actor, p_actor
    );
  END LOOP;

  RETURN p_state;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_fee_quote_draft_snapshot(
  p_workspace_id UUID,
  p_actor TEXT,
  p_draft JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  draft_id UUID := COALESCE((p_draft->>'id')::UUID, gen_random_uuid());
  item JSONB;
  item_index INTEGER := 0;
BEGIN
  INSERT INTO public.fee_quote_drafts (
    id, workspace_id, created_by, discount_percent, tax_percent, notes,
    subtotal, discount_amount, tax_amount, total, status
  ) VALUES (
    draft_id, p_workspace_id, p_actor,
    GREATEST(0, COALESCE((p_draft->>'discountPercent')::NUMERIC, 0)),
    GREATEST(0, COALESCE((p_draft->>'taxPercent')::NUMERIC, 0)),
    COALESCE(p_draft->>'notes', ''),
    GREATEST(0, COALESCE((p_draft#>>'{totals,subtotal}')::NUMERIC, 0)),
    GREATEST(0, COALESCE((p_draft#>>'{totals,discountAmount}')::NUMERIC, 0)),
    GREATEST(0, COALESCE((p_draft#>>'{totals,taxAmount}')::NUMERIC, 0)),
    GREATEST(0, COALESCE((p_draft#>>'{totals,grandTotal}')::NUMERIC, 0)),
    'draft'
  );

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_draft->'items', '[]'::JSONB)) LOOP
    INSERT INTO public.fee_quote_draft_items (
      id, draft_id, description, quantity, unit_price, subtotal, sort_order
    ) VALUES (
      COALESCE((item->>'id')::UUID, gen_random_uuid()), draft_id,
      COALESCE(item->>'description', ''),
      GREATEST(0, COALESCE((item->>'quantity')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'unitPrice')::NUMERIC, 0)),
      GREATEST(0, COALESCE((item->>'quantity')::NUMERIC, 0)) *
        GREATEST(0, COALESCE((item->>'unitPrice')::NUMERIC, 0)),
      item_index
    );
    item_index := item_index + 1;
  END LOOP;
  RETURN draft_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_fee_calculator_state(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_fee_quote_draft_snapshot(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_fee_calculator_state(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_fee_quote_draft_snapshot(UUID, TEXT, JSONB) TO service_role;

-- Storage: uploads are made by the Edge Function using service role. Public reads
-- keep logo/background URLs CORS-safe for html2canvas; writes are never public.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-documents',
  'business-documents',
  true,
  8388608,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Workspace members read business document images" ON storage.objects;
CREATE POLICY "Workspace members read business document images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'business-documents' AND (
      public.app_has_workspace_access(public.app_business_path_workspace(name), 'invoices')
      OR public.app_has_workspace_access(public.app_business_path_workspace(name), 'quotes')
    )
  );

-- Add tables to Realtime publication without failing on repeated runs.
DO $block$
DECLARE
  table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'app_invoices', 'app_quotes', 'fee_calculator_settings', 'fee_living_cost_items',
      'fee_production_items', 'fee_addon_items', 'fee_operational_items',
      'fee_packages', 'fee_unit_prices', 'fee_quote_drafts'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = table_name
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
      END IF;
    END LOOP;
  END IF;
END;
$block$;

COMMIT;
