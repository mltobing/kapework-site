#!/usr/bin/env node
/**
 * scripts/generate-config.js
 *
 * Runs at Netlify build time (see [build] command in netlify.toml).
 * Reads environment variables and writes shared/config.js so all static
 * apps can access them without any runtime access to process.env.
 *
 * The committed shared/config.js is a placeholder with empty values.
 * This script overwrites it with the real values during every deploy.
 *
 * Environment variables consumed:
 *   GA_MEASUREMENT_ID   — Google Analytics (optional; GA silent if absent)
 *   SUPABASE_URL        — Supabase project URL (public anon client)
 *   SUPABASE_ANON_KEY   — Supabase anon key (public anon client)
 *
 * Local dev: variables not set → empty strings → features silently inactive.
 */

const fs   = require('fs');
const path = require('path');

const gaId        = process.env.GA_MEASUREMENT_ID || '';
const supabaseUrl = process.env.SUPABASE_URL       || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY  || '';
const dest        = path.join(__dirname, '..', 'shared', 'config.js');

const content = [
  '/* shared/config.js — generated at build time by scripts/generate-config.js */',
  '/* Do not edit manually; changes will be overwritten on the next deploy.      */',
  'window.KapeworkConfig = {',
  '  gaMeasurementId: ' + JSON.stringify(gaId)        + ',',
  '  supabaseUrl:     ' + JSON.stringify(supabaseUrl) + ',',
  '  supabaseAnonKey: ' + JSON.stringify(supabaseKey) + ',',
  '};',
  '',
].join('\n');

fs.writeFileSync(dest, content, 'utf8');

if (gaId)        console.log('[generate-config] GA_MEASUREMENT_ID =', gaId);
else             console.log('[generate-config] GA_MEASUREMENT_ID not set — GA will be silent on this deploy.');

if (supabaseUrl) console.log('[generate-config] SUPABASE_URL =', supabaseUrl);
else             console.log('[generate-config] SUPABASE_URL not set — Supabase client will be inactive.');

if (supabaseKey) console.log('[generate-config] SUPABASE_ANON_KEY present.');
else             console.log('[generate-config] SUPABASE_ANON_KEY not set — Supabase client will be inactive.');
