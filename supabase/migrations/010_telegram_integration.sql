-- ═══════════════════════════════════════════════════════
-- Migration 010: Telegram Integration & Remote RPC Actions
-- ═══════════════════════════════════════════════════════

-- Insert default telegram bot token into app_settings
INSERT INTO public.app_settings (key, value)
VALUES ('telegram_bot_token', '8710369828:AAFbBonPYcXjp8-w0zQwEPV7n8DTHYV9S2o')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- RPC untuk mengeksekusi aksi dari Telegram Bot secara aman
CREATE OR REPLACE FUNCTION public.process_telegram_action(
  p_action TEXT,
  p_workspace_id UUID DEFAULT NULL,
  p_slug TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  workspace_name TEXT
) AS $func$
DECLARE
  v_target_id UUID := p_workspace_id;
  v_owner_name TEXT;
BEGIN
  -- Resolve workspace ID via slug jika p_workspace_id NULL
  IF v_target_id IS NULL AND p_slug IS NOT NULL THEN
    SELECT id, owner_name INTO v_target_id, v_owner_name
    FROM public.workspaces
    WHERE lower(slug) = lower(p_slug) OR lower(owner_name) LIKE lower(p_slug) || '%';
  ELSIF v_target_id IS NOT NULL THEN
    SELECT owner_name INTO v_owner_name FROM public.workspaces WHERE id = v_target_id;
  END IF;

  IF v_target_id IS NULL THEN
    RETURN QUERY SELECT false, 'Workspace tidak ditemukan.'::TEXT, ''::TEXT;
    RETURN;
  END IF;

  IF p_action = 'activate' OR p_action = 'extend' THEN
    PERFORM public.activate_trial_user(v_target_id);
    RETURN QUERY SELECT true, ('Workspace "' || v_owner_name || '" berhasil diaktifkan (+1 bulan langganan).')::TEXT, v_owner_name;

  ELSIF p_action = 'toggle_active' THEN
    PERFORM public.toggle_workspace_active(v_target_id);
    RETURN QUERY SELECT true, ('Status aktif workspace "' || v_owner_name || '" berhasil diubah.')::TEXT, v_owner_name;

  ELSIF p_action = 'toggle_paid' THEN
    PERFORM public.toggle_workspace_paid(v_target_id);
    RETURN QUERY SELECT true, ('Status payment workspace "' || v_owner_name || '" berhasil diubah.')::TEXT, v_owner_name;

  ELSIF p_action = 'delete' THEN
    PERFORM public.delete_workspace(v_target_id);
    RETURN QUERY SELECT true, ('Workspace "' || v_owner_name || '" telah dihapus.')::TEXT, v_owner_name;

  ELSE
    RETURN QUERY SELECT false, 'Aksi tidak dikenal.'::TEXT, v_owner_name;
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
