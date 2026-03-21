#!/usr/bin/env node
/**
 * scripts/generate-config.js
 *
 * Runs at Netlify build time (see [build] command in netlify.toml).
 * Reads GA_MEASUREMENT_ID from the build environment and writes
 * shared/config.js so all static apps can read it without any
 * runtime access to environment variables.
 *
 * The committed shared/config.js is a placeholder with an empty ID.
 * This script overwrites it with the real value during every deploy.
 *
 * Local dev: GA_MEASUREMENT_ID is not set → empty string → GA silent.
 */

const fs   = require('fs');
const path = require('path');

const id   = process.env.GA_MEASUREMENT_ID || '';
const dest = path.join(__dirname, '..', 'shared', 'config.js');

const content = [
  '/* shared/config.js — generated at build time by scripts/generate-config.js */',
  '/* Do not edit manually; changes will be overwritten on the next deploy.      */',
  'window.KapeworkConfig = { gaMeasurementId: ' + JSON.stringify(id) + ' };',
  '',
].join('\n');

fs.writeFileSync(dest, content, 'utf8');

if (id) {
  console.log('[generate-config] GA_MEASUREMENT_ID =', id);
} else {
  console.log('[generate-config] GA_MEASUREMENT_ID not set — GA will be silent on this deploy.');
}
