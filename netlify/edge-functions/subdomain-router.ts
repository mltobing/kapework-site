/**
 * subdomain-router.ts — Kapework subdomain edge router
 *
 * Routes <slug>.kapework.com requests to the matching app under /apps/
 * while keeping the subdomain hostname visible in the browser.
 *
 * Two app conventions are supported:
 *
 *   Folder app  /apps/<slug>/index.html  (default — works automatically for
 *               any new slug; no changes needed here)
 *
 *   Single-file /apps/<slug>.html        (listed explicitly in SINGLE_FILE
 *               below; add new entries here if you add a new .html-only app)
 *
 * To add a future folder app:
 *   1. Create /apps/<name>/index.html
 *   2. Add <name>.kapework.com as a Netlify domain alias
 *   → Done. No changes to this file needed.
 *
 * To add a future single-file app:
 *   1. Create /apps/<name>.html
 *   2. Add <name>.kapework.com as a Netlify domain alias
 *   3. Add one line to SINGLE_FILE below
 */

import type { Context } from "https://edge.netlify.com";

// ─── Single-file app exceptions ───────────────────────────────────────────────
// Maps slug → root-relative path to the HTML file.
// Every other slug defaults to folder-app convention: /apps/<slug>/...
const SINGLE_FILE: Record<string, string> = {
  blinkgrid:    "/apps/blinkgrid.html",   // redirect → blinkgrid4
  blinkgrid4:   "/apps/blinkgrid4.html",
  cvcbuilder:   "/apps/cvcbuilder.html",
  // longshot: now a folder app at /apps/longshot/ — no entry needed here
  // rainbowrules: now a folder app at /apps/rainbowrules/ — no entry needed here
  tapsum:       "/apps/tapsum.html",
  tiltrix:      "/apps/tiltrix.html",
  tiltgarden:   "/apps/tiltgarden.html",
};

// ─── Pass-through: prefixes already inside /apps or /shared ──────────────────
// After a rewrite these paths will start with /apps/ or /shared/.
// Matching here prevents the edge function from rewriting them a second time
// (defence-in-depth; edge functions do not re-run on rewritten requests anyway).
const PASS_PREFIXES = ["/apps/", "/shared/", "/.netlify/"];

// ─── Pass-through: global static files that live at the site root ─────────────
const PASS_EXACT = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.json",
  "/sw.js",
]);

export default async function handler(
  request: Request,
  context: Context,
): Promise<Response> {
  const url = new URL(request.url);
  const { hostname, pathname } = url;

  // ── A. Non-subdomain hosts — pass through unchanged ──────────────────────
  if (
    hostname === "kapework.com" ||
    hostname === "www.kapework.com" ||
    hostname.endsWith(".netlify.app") ||
    !hostname.endsWith(".kapework.com")
  ) {
    return context.next();
  }

  // ── B. Already-routed or global static paths — pass through unchanged ────
  if (PASS_EXACT.has(pathname)) return context.next();
  for (const prefix of PASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return context.next();
  }

  // ── C. Extract slug from subdomain ───────────────────────────────────────
  // e.g. "create.kapework.com" → "create"
  const slug = hostname.slice(0, -".kapework.com".length);

  // ── D. Single-file app — serve the HTML for every path ───────────────────
  if (SINGLE_FILE[slug]) {
    return context.rewrite(new URL(SINGLE_FILE[slug], request.url));
  }

  // ── E. Folder app (default) ───────────────────────────────────────────────
  // https://<slug>.kapework.com/         → /apps/<slug>/
  // https://<slug>.kapework.com/foo/bar  → /apps/<slug>/foo/bar
  // Netlify's static file server resolves /apps/<slug>/ → index.html
  // automatically, so no need to append "index.html" explicitly.
  const target = `/apps/${slug}${pathname}`;
  return context.rewrite(new URL(target, request.url));
}
