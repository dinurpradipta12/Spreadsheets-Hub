export type Workspace = {
  id: string;
  slug: string;
  owner_name: string;
  password: string | null;
  created_at: string;
  is_active: boolean;
  has_paid: boolean;
  is_trial: boolean;
  trial_link_id: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_expired: boolean;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
};

export type TrialLink = {
  id: string;
  link_code: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  created_by: string | null;
  trial_duration_hours: number;
  trial_duration_minutes: number;
  per_user_expiry: boolean;
  used_by?: string | null;
};

export type AppSetting = {
  key: string;
  value: string;
  updated_at: string;
};

export const DEFAULT_SETTINGS: Record<string, string> = {
  whatsapp_number: '6281234567890',
  trial_duration_hours: '36',
  app_name: 'Spreadsheets Hub Manager',
  app_description: 'Spreadsheets Management by Dinur Pradipta',
};

export type ContentPlanSheet = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  sheet_url: string;
  embed_url: string | null;
  platform: string | null;
  status: string;
  logo_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SheetFormData = {
  clientName: string;
  title: string;
  sheetUrl: string;
  platform: string;
  logoUrl: string;
  logoFile: File | null;
};

export type ToastMessage = {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
};

export const PLATFORMS = [
  'Instagram & TikTok',
  'Instagram Reels',
  'LinkedIn & Article',
  'All Social Channels',
] as const;

export const WHATSAPP_NUMBER = '6281234567890'; // Ganti dengan nomor WhatsApp developer
