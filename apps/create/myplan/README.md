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
- `storage.js`: all Supabase calls, durable local saves, account isolation, upload ordering, retries, optimistic concurrency and editable backups.
- `main.js`: editor, schedule library, native pickers, crop dialog, mobile preview, authentication and output actions.
- `sw.js`: caches only public application assets. No authenticated response, schedule or photo enters Cache Storage.

## Configuration and authentication

Netlify build variables:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Existing Supabase project endpoint. |
| `SUPABASE_ANON_KEY` | Public anonymous/publishable client key. Never a service-role credential. |
| `MYPLAN_MAGIC_LINK_ENABLED` | Optional; exactly `true` enables email links **only after** the app redirect is verified in Supabase. Default off. |

Password sign-in uses existing accounts and needs no redirect. Registration remains closed; My Plan does not call signup. The live project settings were checked on 31 October 2026: `disable_signup=true`, email authentication enabled, anonymous accounts disabled.

My Plan uses its own auth storage key, `kapework-myplan-auth`. A Ma sign-in on a different subdomain does not automatically sign the user in here. Guest drafts are added to a signed-in account only by the explicit account-dialog action.

Before enabling magic links, verify the exact production redirect `https://create.kapework.com/myplan/` in Supabase Authentication URL Configuration and, if needed, the exact approved preview URL. Test a link opened on another device. Do not add a broad redirect wildcard or change registration policy. The redirect allowlist could not be inspected in this implementation session; links therefore remain disabled. No user credentials were requested or read.

Use separate staging Supabase configuration in the Netlify preview context when it is available. No separate staging database or authenticated Netlify settings session was available during this implementation. The additive production migration was explicitly approved by the owner and verified using rolled-back synthetic fixtures; that is not a claim of a separate database staging deployment.

## Migration and server security

Apply `supabase-migrations/015_myplan.sql` as a versioned migration, then run the whole `supabase-migrations/verify/015_myplan_verify.sql` transaction. The verification rolls back every synthetic fixture.

The migration adds only My Plan objects:

- `myplan_schedules`, with `owner_id`, validated JSON, monotonic version and deletion tombstone.
- `myplan_save_schedule`, an authenticated, validated compare-and-swap RPC. Direct authenticated table writes are revoked. A stale version returns a conflict; a wrong owner never receives the existing record.
- A **private** `myplan-photos` bucket, JPEG-only, maximum 5 MiB/object. Objects are immutable and stored at `owner UUID/assets/photo UUID.jpg`. RLS ownership applies to reads, inserts and deletes; a restrictive fence prevents other permissive storage policies from leaking this bucket.

No Ma family membership, feed, table or media bucket is used. No privileged credential is shipped. No analytics script is loaded. Private content, URLs and raw service errors are never logged. Shared navigation/feedback is retained, with no automatic schedule attachment.

**Applied:** 31 October 2026 to the existing Kapework project `fimsbfcvavpehryvvcho`, migration name `myplan_private_schedules`, after explicit approval. All 19 live ownership/validation/conflict assertions passed; subsequent checks found no synthetic users, schedules or objects left behind.

## Durability, conflicts and backups

IndexedDB `kapework-myplan-v1` keeps schedules and JPEG blobs in separate stores, scoped to `guest` or the account UUID. Before a schedule edit is queued, a per-page/account text journal is written synchronously to localStorage; pictures stay in IndexedDB. A commit clears only its own exact journal request. On reopen, an interrupted edit is replayed only against its matching base; a newer committed version is kept alongside a recovered copy.

Local commits and cloud success have distinct visible states. Cloud sync uploads pictures before saving the record. Network calls time out after 20 seconds and retry on reconnection, focus, manual sync or further edits. An expired session or failed upload leaves the local copy intact. A version conflict preserves both schedules; the open editor follows the conflict copy.

`Export editable backup` downloads `.myplan.json` containing the schedule, settings, original normalized JPEGs and crops. Import validates all content first, remaps identifiers and adds an independent schedule. The limit is 80 MiB. A PDF is not an editable backup. Sign-out hides account drafts but intentionally retains their recoverable local storage; users of shared devices should also clear site data when finished.

Deletion removes the schedule from the library, clears its cloud document content, and keeps a small versioned tombstone to prevent offline resurrection. Immutable photo blobs can be referenced by duplicate or offline schedules and are retained. **Maintenance limitation:** orphan-photo garbage collection / immediate media erasure is not implemented; add an owner-authorized purge with an offline recovery grace period before promising complete deletion of photos. Do not blindly delete blobs while duplicates or offline drafts can still reference them.

## Print behaviour

US Letter portrait defaults to at most eight steps; 11 × 17 portrait permits up to fifteen. Editable drafts may hold up to 24 steps. All labels, captions and pictures are measured against readable fixed font sizes. Overcrowding blocks export and offers larger paper or shorter/split routines, rather than clipping or generating extra pages. A reward is a separate panel.

The preview, crop dialog and PDF share geometry. Locally vendored jsPDF 4.2.1 and Noto Sans generate one actual PDF with vector text and embedded images. The illustration source is SVG; PDF illustrations are consistently rasterized at print quality. No remote/private URLs are needed to open the finished PDF. The font supports Latin, Greek and Cyrillic; unsupported glyphs produce a visible error rather than broken PDF text. Other scripts/emoji require an additional locally licensed font.

Print invokes the browser's print dialog with the same single-page SVG. The sheet excludes navigation, controls, dates, checkboxes and progress. Printer hardware margins and print-dialog overrides remain device-dependent; use portrait and actual size / fit-to-printable-area as needed.

## Validation on 31 October 2026

- **515 automated tests passed:** 494 existing repository checks plus 21 My Plan model, storage, JPEG backup and recovery-journal checks. The existing calendar-write test now freezes its clock so its August fixture does not expire; production calendar logic is unchanged.
- **19 live database assertions passed:** owner create/read/update/photo access, other-account and anonymous denial, validated input, immutable version conflict behaviour, private bucket and write grants. All fixtures rolled back.
- **Chrome on macOS:** starter creation; insert/reorder/remove reflected in page order; reload and continued editing; independent copy; native synthetic JPEG selection, crop and recrop; backup export/import and intact crop; cancelled native photo picker without loss; actual PDF download; native print preview showing one sheet and no editor controls. A physical page was not printed.
- **Responsive Chrome viewport:** narrow (375 CSS-pixel) editor has no horizontal overflow, prominent preview action, and return-to-edit flow. This is viewport testing, not an iPhone browser result.
- **PDF inspection:** downloaded bedtime Letter PDF is one 612 × 792-point page; rasterized and visually checked. Separate Letter reward and 11 × 17 outputs were generated and inspected during development.
- **Controlled persistence tests:** same-account second-device reopening, concurrent changes, expired/failed network paths, failed uploads, editing during cloud save, interrupted local write recovery, stale deletion conflicts and account separation.

Still manual: real iPhone Safari camera/HEIC selection, force-suspension while camera is open, Safari PDF opening/downloading/Share sheet, Android native picker/PDF handling, actual printer output, and a full same-account signed-in journey on two physical devices. Existing account credentials were not available for that interactive test. Magic-link redirect verification remains a separate opt-in configuration task.
