-- ═══════════════════════════════════════════════════════
-- Migration 006: Monthly Subscription System
-- ═══════════════════════════════════════════════════════

-- 1. Tambah kolom subscription di workspaces
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ws_subscription_ends ON public.workspaces (subscription_ends_at);

-- 2. Update activate_trial_user — sekarang set subscription 1 bulan otomatis
CREATE OR REPLACE FUNCTION public.activate_trial_user(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET is_trial = false, trial_expired = false, is_active = true, has_paid = true,
      revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
      subscription_started_at = now(),
      subscription_ends_at = now() + INTERVAL '1 month'
  WHERE id = p_workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RPC: Perpanjang subscription 1 bulan (dari tanggal expired sebelumnya atau sekarang)
CREATE OR REPLACE FUNCTION public.extend_subscription(p_workspace_id UUID)
RETURNS VOID AS $func$
DECLARE
  current_end TIMESTAMPTZ;
BEGIN
  SELECT subscription_ends_at INTO current_end
  FROM public.workspaces WHERE id = p_workspace_id;

  -- Jika subscription masih aktif, perpanjang dari tanggal berakhir
  -- Jika sudah expired atau belum ada, mulai dari sekarang
  IF current_end IS NOT NULL AND current_end > now() THEN
    UPDATE public.workspaces
    SET has_paid = true, is_active = true,
        subscription_ends_at = current_end + INTERVAL '1 month',
        revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
    WHERE id = p_workspace_id;
  ELSE
    UPDATE public.workspaces
    SET has_paid = true, is_active = true,
        subscription_started_at = now(),
        subscription_ends_at = now() + INTERVAL '1 month',
        revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL
    WHERE id = p_workspace_id;
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: Cek dan tandai subscription yang sudah expired
CREATE OR REPLACE FUNCTION public.check_expired_subscriptions()
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET is_active = false,
      revoke_reason = 'Masa langganan bulanan telah habis'
  WHERE subscription_ends_at IS NOT NULL
    AND subscription_ends_at < now()
    AND is_active = true
    AND is_trial = false;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Update authenticate_workspace agar return subscription fields
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
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT
) AS $func$
BEGIN
  RETURN QUERY
  SELECT 
    w.id, w.slug, w.owner_name, w.created_at, w.is_active, w.has_paid, 
    w.is_trial, w.trial_link_id, w.trial_started_at, w.trial_ends_at, 
    w.trial_expired, w.subscription_started_at, w.subscription_ends_at,
    w.revoked_at, w.revoked_by, w.revoke_reason
  FROM public.workspaces w
  WHERE lower(trim(w.owner_name)) LIKE lower(trim(p_name)) || '%'
    AND (w.password IS NULL OR w.password = '' OR w.password = p_password)
  ORDER BY w.created_at DESC
  LIMIT 1;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update default payment settings
INSERT INTO public.app_settings (key, value) VALUES
  ('payment_amount', 'Rp 150.000 / bulan'),
  ('payment_note', 'Biaya Langganan 1 Bulan')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
