import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * PLCC's own Supabase project, from Vercel env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 * No built-in fallback: PLCC must never fall back to another church's database.
 * Never put a service-role key here.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || '';

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
