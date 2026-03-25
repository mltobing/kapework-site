/**
 * src/supabase.js
 *
 * Creates and exports the single Supabase client for the Ma app.
 *
 * Credentials come from window.KapeworkConfig, which is written at Netlify
 * build time by scripts/generate-config.js using SUPABASE_URL and
 * SUPABASE_ANON_KEY environment variables.  These are public/anon keys —
 * safe to expose in the browser.  Real access control lives in Supabase RLS.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.KapeworkConfig ?? {};
const supabaseUrl     = cfg.supabaseUrl     ?? '';
const supabaseAnonKey = cfg.supabaseAnonKey ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[ma/supabase] Supabase credentials not found in window.KapeworkConfig. ' +
    'Check that SUPABASE_URL and SUPABASE_ANON_KEY are set as Netlify env vars ' +
    'and that /shared/config.js loaded correctly.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
