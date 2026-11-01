# My Plan

Reusable, private visual routine sheets for families. Buildless ES modules, following the Create apps and Ma's Supabase account conventions.

- Production path: `https://create.kapework.com/myplan/`
- Repository / PR preview path: `/apps/create/myplan/`
- Existing subdomain router already maps this path; no new domain alias or router is needed.

## Run and test

Serve the repository root with any static HTTP server, then open `/apps/create/myplan/`. For account saving, use Netlify Dev with the configured environment; empty `shared/config.js` intentionally runs in device-only mode.

```sh
npm ci
npm run test:myplan
npm test
```

Netlify's normal Git-connected pipeline runs the full tests before generating public browser configuration. Push a short-lived feature branch, open a PR, check its Netlify deploy preview, then merge via PR. Do not deploy from a local `netlify deploy` command. `main` remains the production branch.

## Modules

- `model.js`: validated portable schedule shape, starters, independent copies.
- `illustrations.js`: 23 original, embedded SVG illustrations.
- `images.js`: orientation-aware decode, max 2,000-pixel JPEG compression, metadata stripping, crop geometry.
- `print.js`: shared page geometry, local font metrics, SVG page preview and actual embedded single-page PDF.
- `storage.js`: schedule/photo persistence, durable local saves, account isolation, upload ordering, retries, optimistic concurrency and editable backups. Authentication uses the suite client in `/shared/auth.js`.
- `main.js`: editor, schedule library, native pickers, crop dialog, mobile preview, authentication and output actions.
- `sw.js`: caches only public application assets. No authenticated response, schedule or photo enters Cache Storage.

## Configuration and authentication

Netlify build variables:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Existing Supabase project endpoint. |
| `SUPABASE_ANON_KEY` | Public anonymous/publishable client key. Never a service-role credential. |
| `MYPLAN_MAGIC_LINK_ENABLED` | Optional; exactly `true` enables email links **only after** the app redirect is verified in Supabase. Default off. |

Google sign-in uses the shared Kapework account service and a same-origin PKCE callback at `/shared/auth/callback.html`. New self-registration is Google-only once the provider and migration 016's Before User Created hook are configured. Existing-account password sign-in remains available; email OTP requests use `shouldCreateUser: false`. This source implementation does not establish that production activation is complete. See the [shared Google sign-in runbook](../../../docs/google-sign-in.md) for activation order, exact callbacks, the signup hook, and validation.

The shared client uses Supabase's default auth storage key. A previous `kapework-myplan-auth` session is adopted only if no shared session already exists, then consumed so it cannot return after sign-out. Sessions remain separate by browser origin: a Ma sign-in on its subdomain does not automatically sign in here. Guest drafts are added to an account only by the explicit account-dialog action, including after Google returns.

Before enabling magic links, verify the exact production email redirect `https://create.kapework.com/myplan/` and any exact approved preview URL in Supabase Authentication URL Configuration. PKCE links must open in the same browser that requested them; request a separate sign-in on another device. The Google callback allowlist does not replace the email-return entry. Keep `MYPLAN_MAGIC_LINK_ENABLED` off until that journey is tested; do not add broad redirect wildcards.

Use separate staging Supabase configuration in the Netlify preview context when it is available. No separate staging database or authenticated Netlify settings session was available during this implementation. The additive production migration was explicitly approved by the owner and verified using rolled-back synthetic fixtures; that is not a claim of a separate database staging deployment.

## Migration and server security

Apply `supabase-migrations/015_myplan.sql` as a versioned migration, then run the whole `supabase-migrations/verify/015_myplan_verify.sql` transaction. The verification rolls back every synthetic fixture.

Before deploying the vertical-row editor, also apply `supabase-migrations/017_myplan_step_illustrations.sql` and run its `verify/017_myplan_step_illustrations_verify.sql` transaction. It extends photo validation to accept an optional, known `illustrationId`; legacy photo documents remain valid. It does not rewrite schedules/photos or change ownership, RLS, storage paths or the compare-and-swap protocol. The frontend emits this metadata when photo schedules are saved, so the migration must precede the frontend release.

Reload other open My Plan tabs after this release. Older client code strips fields it does not recognize and can remove a newly selected companion illustration on a later edit; the photo asset and crop remain intact. Editable backup format version 1 continues to work: new exports preserve the companion illustration and old imports receive the deterministic fallback.

The migration adds only My Plan objects:

- `myplan_schedules`, with `owner_id`, validated JSON, monotonic version and deletion tombstone.
- `myplan_save_schedule`, an authenticated, validated compare-and-swap RPC. Direct authenticated table writes are revoked. A stale version returns a conflict; a wrong owner never receives the existing record.
- A **private** `myplan-photos` bucket, JPEG-only, maximum 5 MiB/object. Objects are immutable and stored at `owner UUID/assets/photo UUID.jpg`. RLS ownership applies to reads, inserts and deletes; a restrictive fence prevents other permissive storage policies from leaking this bucket.

No Ma family membership, feed, table or media bucket is used. No privileged credential is shipped. No analytics script is loaded. Private content, URLs and raw service errors are never logged. Shared navigation/feedback is retained, with no automatic schedule attachment.

**Applied:** 31 October 2026 to the existing Kapework project `fimsbfcvavpehryvvcho`, migration name `myplan_private_schedules`, after explicit approval. All 19 live ownership/validation/conflict assertions passed; subsequent checks found no synthetic users, schedules or objects left behind.

## Durability, conflicts and backups

Each open editor holds its own content revision. Local writes compare that revision and commit atomically in IndexedDB; stale tabs preserve a separate conflict copy, queued edits follow that copy, and stale deletion keeps the newer routine. Closing an unchanged tab does not write its older snapshot. Cloud acknowledgements cannot lower a newer stored version.

IndexedDB `kapework-myplan-v1` keeps schedules and JPEG blobs in separate stores, scoped to `guest` or the account UUID. Before a schedule edit is queued, a per-page/account text journal is written synchronously to localStorage; pictures stay in IndexedDB. A commit clears only its own exact journal request. On reopen, an interrupted edit is replayed only against its matching base; a newer committed version is kept alongside a recovered copy.

Local commits and cloud success have distinct visible states. Cloud sync uploads pictures before saving the record. Network calls time out after 20 seconds and retry on reconnection, focus, manual sync or further edits. An expired session or failed upload leaves the local copy intact. Network operations bind their original account token and abort local changes after an account switch, including switches during uploads or imports. A version conflict preserves both schedules; the open editor follows the conflict copy.

`Export editable backup` downloads `.myplan.json` containing the schedule, settings, original normalized JPEGs and crops. Import validates all content first, remaps identifiers and adds an independent schedule. The limit is 80 MiB. A PDF is not an editable backup. Sign-out hides account drafts but intentionally retains their recoverable local storage; users of shared devices should also clear site data when finished.

Deletion removes the schedule from the library, clears its cloud document content, and keeps a small versioned tombstone to prevent offline resurrection. Immutable photo blobs can be referenced by duplicate or offline schedules and are retained. **Maintenance limitation:** orphan-photo garbage collection / immediate media erasure is not implemented; add an owner-authorized purge with an offline recovery grace period before promising complete deletion of photos. Do not blindly delete blobs while duplicates or offline drafts can still reference them.

## Print behaviour

Each routine prints as one vertical sequence: number, large label with an optional caption, a consistent illustration, and an optional square photo at the right. Thin dividers separate rows on white paper. Photos supplement the illustration; choosing a new illustration leaves the photo intact, and removing a photo leaves the selected illustration. Mixed-photo routines keep their columns aligned; illustration-only routines give more width to the text. The reward stays in a distinct, unnumbered panel below the steps.

US Letter portrait permits up to 12 short rows; 11 × 17 portrait permits up to 16. Labels stay at 22 pt on Letter and 30 pt on the wall sheet; captions use 11.5/14 pt. These are capacity ceilings, not a promise that every 12/16-step draft fits. Titles, captions, photos and the reward must pass the actual geometry check, including a minimum picture size of 40/48 pt. A reward reduces space available to the steps. Overcrowding blocks export and offers larger paper, shorter text or fewer/split routines; it never silently shrinks labels, clips content or adds pages. Editable drafts may still hold up to 24 steps.

Existing photo assets and crop coordinates are retained. A legacy photo without a companion illustration uses the matching generic starter illustration when its label is recognized, otherwise a neutral star that the parent can change. The new square photo frame can show a different part of an old photo even with the same stored crop coordinates; Recrop adjusts its framing without altering the saved original JPEG.

The preview, crop dialog and PDF share geometry. Locally vendored jsPDF 4.2.1 and Noto Sans generate one actual PDF with vector text and embedded images. The illustration source is SVG; PDF illustrations are consistently rasterized at print quality. No remote/private URLs are needed to open the finished PDF. The font supports Latin, Greek and Cyrillic; unsupported glyphs produce a visible error rather than broken PDF text. Other scripts/emoji require an additional locally licensed font.

Print invokes the browser's print dialog with the same single-page SVG. The sheet excludes navigation, controls, dates, checkboxes and progress. Printer hardware margins and print-dialog overrides remain device-dependent; use portrait and actual size / fit-to-printable-area as needed.

## Vertical-row PDF validation on 1 November 2026

Five sample PDFs were generated through the production print module with a native canvas adapter, rendered with Poppler, and visually inspected: eight-step bedtime on Letter; 12 rows on Letter; 16 rows on 11 × 17; eight mixed-photo rows with captions and a reward; and 12 Letter rows with short captions. Every output is one page at the expected paper dimensions, with ordered labels, embedded pictures, sharp text and no clipping or overlap. Four portrait/landscape/square/reward photo crops matched the expected source rectangles in real canvas drawing calls. The 12-row Letter and 16-row wall-sheet reward variants correctly stop with a more-room message, as does an overcrowded long-text example.

These checks exercise PDF generation and geometry, not physical-phone download behavior or printer output. The original browser/device limitations below still apply until separately rechecked.

## Original My Plan release validation on 31 October 2026

- **529 automated tests passed:** 494 existing repository checks plus 35 My Plan model, storage, JPEG backup and recovery-journal checks. The existing calendar-write test now freezes its clock so its August fixture does not expire; production calendar logic is unchanged.
- **19 live database assertions passed:** owner create/read/update/photo access, other-account and anonymous denial, validated input, immutable version conflict behaviour, private bucket and write grants. All fixtures rolled back.
- **Chrome on macOS:** starter creation; insert/reorder/remove reflected in page order; reload and continued editing; independent copy; native synthetic JPEG selection, crop and recrop; backup export/import and intact crop; cancelled native photo picker without loss; actual PDF download; native print preview showing one sheet and no editor controls; two open tabs preserve their independent edits and reopen the conflict copy intact. A physical page was not printed.
- **Responsive Chrome viewport:** narrow (375 CSS-pixel) editor has no horizontal overflow, prominent preview action, and return-to-edit flow. This is viewport testing, not an iPhone browser result.
- **PDF inspection:** downloaded bedtime Letter PDF is one 612 × 792-point page; rasterized and visually checked. Separate Letter reward and 11 × 17 outputs were generated and inspected during development.
- **Controlled persistence tests:** same-account second-device reopening, concurrent changes, expired/failed network paths, failed uploads, editing during cloud save, interrupted local write recovery, stale deletion conflicts and account separation.

Still manual: real iPhone Safari camera/HEIC selection, force-suspension while camera is open, Safari PDF opening/downloading/Share sheet, Android native picker/PDF handling, actual printer output, and a full same-account signed-in journey on two physical devices. Existing account credentials were not available for that interactive test. Magic-link redirect verification remains a separate opt-in configuration task.

## Row-layout release validation on 1 November 2026

Migration 017 was applied to the existing Kapework Supabase project before releasing the new client. All 27 live picture/document compatibility assertions passed in a rolled-back transaction. The migration extends validation only; it does not rewrite saved routines or change ownership rules. The complete repository suite passed 583 tests (497 existing/server, 46 My Plan, 40 shared-auth/origin/UI).

Chrome on macOS also verified native photo selection, independent illustration changes, recropping, photo removal and Undo, reload persistence, and the 390-pixel editor/preview with no horizontal overflow and exact return to the prior scroll position. Printed crops now use square frames; existing original photos and crop coordinates are retained for further adjustment.
