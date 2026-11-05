import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The church's Supabase project (awc-vault). These are PUBLIC values — the same
 * ones every visitor's browser already receives from Connect and the Vault — so
 * they're built in. Vercel env vars only override them. Never put a
 * service-role key here.
 */
const AWC_SUPABASE_URL = 'https://yrpwdrioomdihjlmcfnu.supabase.co';
const AWC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycHdkcmlvb21kaWhqbG1jZm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjk2ODgsImV4cCI6MjA4NTgwNTY4OH0.Ohv1ko8QcMhdkwI_pBJ-HmyNqzV3XcmSsxX40Eb5reE';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || AWC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || AWC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.error(
    'Missing Supabase env vars. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

/**
 * Single browser Supabase client for PLCC Chat.
 * Uses the anon key only — never a service-role key.
 * Session persistence and refresh are handled by the Auth client.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  }
);
