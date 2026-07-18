# Trusted devices — verification checklist

Automated coverage (run `npm test`) covers the deterministic engine and the
security primitives:

- `apps/ma/src/lib/today-state.test.mjs` — the current-state engine across empty /
  before / during / after / all-day / downstairs-boundary / contact-window /
  cancelled / stale / CET+CEST / midnight cases. Runs green under UTC,
  America/New_York, Europe/Amsterdam and Asia/Jakarta (`npm run test:today-state`).
- `netlify/functions/_ma-crypto.test.js` — hash determinism + pepper dependence,
  token/code shape, cookie flags (HttpOnly / Secure / SameSite=Strict / Max-Age).
- `netlify/functions/_ma-today-derive.test.js` — Amsterdam bucketing + conservative
  downstairs/contact-window parsing + payload allowlist (notes/URLs dropped).

The end-to-end flows below need a running deploy (functions + DB + a browser), so
they are verified manually against the Netlify deploy preview.

## Security checks

- [ ] The raw device token never appears in the DB (`ma_trusted_devices.token_hash`
      is a 64-char hex), nor in any JSON body, HTML, log line, or browser storage
      (`localStorage`/`sessionStorage`/IndexedDB empty of it). Only the HttpOnly
      cookie carries it, and `document.cookie` cannot read it.
- [ ] `Set-Cookie` on activation includes `HttpOnly`, `Secure`, `SameSite=Strict`,
      `Path=/`, `Max-Age=31536000`.
- [ ] `ma-today` with no cookie / an expired, revoked, or random cookie → 401, no data.
- [ ] A pairing cannot be consumed twice (second activate with the same token/code → 401).
- [ ] Repeated wrong codes are rate-limited (429 after 6/min per IP).
- [ ] A non-member (valid Supabase session, different family) cannot create/list/revoke
      for a family they don't belong to → 403.
- [ ] `ma-today` payload contains only: `dateKey`, `calendarLastSyncedAt`,
      `briefingText`, `events[]{uid,title,startsAt,endsAt,allDay,location,downstairsAt,contactWindow}`.
      No notes, external URLs, posts, profiles, emails, or briefing metadata.
- [ ] `/vandaag` renders no top bar, no bottom nav, no links into the full app, and
      no family-only data.
- [ ] Revoking a device blocks its next 60-second refresh (falls back to setup).
- [ ] After a build, `shared/config.js` contains no service-role key and no pepper.

## Manual acceptance flow

1. [ ] On a signed-in phone: **Apparaten → Nieuw apparaat instellen**, label it,
       get a link + six-digit code.
2. [ ] Pair a desktop browser by typing the code at `ma.kapework.com/vandaag`.
3. [ ] Pair a second device by opening the shared link (`/vandaag/koppelen#token=…`);
       confirm the fragment is stripped from history immediately.
4. [ ] Each device shows a distinct row in **Apparaten** with its own label.
5. [ ] Neither device shows any family navigation or data — only today.
6. [ ] Revoke one device from the family app; within one refresh it returns to the
       setup screen.
7. [ ] Turn the network off on an open display: it shows the last-known day behind a
       clear stale/offline badge and suppresses any "U kunt nu naar beneden" cue.
8. [ ] Clear the device's browser data → re-pairing is a fresh link/code (the old
       token is neither revealed nor recoverable).
9. [ ] Full refresh and installed-PWA launch both return directly to `/vandaag`.
