-- ═══════════════════════════════════════════════════════
-- Migration 008: Auto-revoke workspace on subscription expiry
-- ═══════════════════════════════════════════════════════

-- RPC: otomatis revoke workspace jika langganan habis
CREATE OR REPLACE FUNCTION public.auto_revoke_expired_subscription(p_workspace_id UUID)
RETURNS VOID AS $func$
BEGIN
  UPDATE public.workspaces
  SET is_active = false,
      revoked_at = now(),
      revoke_reason = 'Masa langganan habis. Silakan selesaikan pembayaran untuk membuka kembali akses.'
  WHERE id = p_workspace_id
    AND subscription_ends_at IS NOT NULL
    AND subscription_ends_at < now()
    AND is_active = true;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
