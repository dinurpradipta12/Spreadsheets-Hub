import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://uhjnikyabigoiqsgdvcg.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoam5pa3lhYmlnb2lxc2dkdmNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDc5MTEsImV4cCI6MjEwMzkyMzkxMX0.KJBOhLUaMNTWkHygJOZm2N4pwwyJWeGhLIBrY4aHVu0';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);
