-- ═══════════════════════════════════════════════════════
-- Migration 009: RPC to get sheet counts per workspace
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_workspace_sheet_counts()
RETURNS TABLE (
  workspace_id UUID,
  sheet_count BIGINT
) AS $func$
BEGIN
  RETURN QUERY
  SELECT cps.workspace_id, COUNT(*)::BIGINT AS sheet_count
  FROM public.content_plan_sheets cps
  WHERE cps.status = 'active'
  GROUP BY cps.workspace_id;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
