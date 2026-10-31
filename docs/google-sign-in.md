# Google sign-in across Kapework

This runbook describes the implemented code and the steps needed to activate it. It is not evidence that Google, Supabase Auth hooks, redirects, or a production deployment have already been configured. Record those live checks in the release handover.

## Account behavior

`shared/auth.js` supplies one Supabase client per browser origin, using the existing default Supabase storage key. The same Google identity can use the suite, but each origin has its own session storage. Signing in at `create.kapework.com` does not automatically sign in at `ma.kapework.com` or another subdomain. Account actions must use the shared service; classic game scripts use `shared/auth-compat.js`. Guest gameplay remains available, and sign-in does not add cloud saving to apps that do not already support it.

Google sign-in is a full-page PKCE flow. It stores a validated local return path in session storage, sends the user through Supabase and Google, and returns to `/shared/auth/callback.html` on the **origin where sign-in began**. The callback removes response parameters, exchanges the code, and returns to the app. It has no analytics, feedback widget, or third-party scripts. `/shared/` bypasses the subdomain router. A return path expires after 15 minutes; the provider's authorization-code lifetime is separate. Cancelled, expired, or cross-browser attempts show a retry/return message without deleting local drafts. See [Supabase PKCE documentation](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

The shared client keeps existing Ma and Make24/36 sessions. It adopts My Plan's previous `kapework-myplan-auth` session only when there is no existing default-key session. An already selected shared account takes precedence. Successful migration or sign-out marks the legacy key consumed and removes it, preventing an old account from returning after sign-out. My Plan still partitions drafts and photos by account, saves before starting Google sign-in, and asks before adding pre-sign-in device drafts to the selected account. A Google account does not automatically claim another person's device drafts.

Existing-account email options remain: My Plan password sign-in and its gated magic-link option, Ma magic links, and Make24/36 email codes. All email OTP requests use `shouldCreateUser: false`. PKCE magic links must open in the same browser that requested them; another device must request its own sign-in. `MYPLAN_MAGIC_LINK_ENABLED=true` must remain off until its exact email return URL and same-browser behavior are verified. Google uses the shared callback; existing email flows retain their app return URLs.

## Ma stays private

Account creation alone does not grant Ma access. `routeAfterAuth` checks an existing family membership or active care-team membership **before** prompting for a profile or loading family views. Grants remain explicit in `ma_family_members` or `ma_care_team_members`; do not auto-enrol Google users. Today's paired-device screen retains its existing pairing mechanism and receives no general sign-in control.

Migration `supabase-migrations/016_ma_account_access.sql` restricts profile writes to granted users, checks current access in logboek mutation RPCs, and removes browser execution privileges from maintenance RPCs. Ma functions also reject sibling-origin requests before authentication/database work. Production accepts the Ma origin; a deploy preview accepts its own exact `DEPLOY_PRIME_URL`; local Netlify development has explicit localhost exceptions. RLS and RPC authorization remain the access boundary.

The migration also defines `public.kapework_before_user_created(jsonb)`. Attach it as Supabase Auth's **Before User Created** hook before allowing global signups. It allows new accounts only when Auth's `app_metadata.provider` is `google`; missing/other providers fail closed. User-editable metadata cannot grant this exception. Existing email accounts can still sign in. The hook also blocks new email invitations; exceptional owner-created email accounts must use the privileged Admin API, followed by any explicit Ma grant. Do not disable this hook while public signups are enabled. [Supabase documents the hook payload and rejection behavior](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).

## Exact production callback allowlist

Add these exact entries to Supabase Auth's Redirect URLs. They cover the root, five hubs, the number and puzzle apps, tools, and Ma. Create's seven apps—including My Plan—share the `create.kapework.com` entry. Root-hosted `/apps/...` paths share the `kapework.com` entry. Do not add wildcard subdomains or wildcard paths. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls) is separate from Google's OAuth-client redirect configuration.

```text
https://kapework.com/shared/auth/callback.html
https://readysetread.kapework.com/shared/auth/callback.html
https://numbercrunch.kapework.com/shared/auth/callback.html
https://braingym.kapework.com/shared/auth/callback.html
https://create.kapework.com/shared/auth/callback.html
https://tools.kapework.com/shared/auth/callback.html
https://make24.kapework.com/shared/auth/callback.html
https://hothand.kapework.com/shared/auth/callback.html
https://prim4.kapework.com/shared/auth/callback.html
https://make36.kapework.com/shared/auth/callback.html
https://tapsum.kapework.com/shared/auth/callback.html
https://motif.kapework.com/shared/auth/callback.html
https://blinkgrid4.kapework.com/shared/auth/callback.html
https://rainbowrules.kapework.com/shared/auth/callback.html
https://longshot.kapework.com/shared/auth/callback.html
https://motif6x6.kapework.com/shared/auth/callback.html
https://tiltrix.kapework.com/shared/auth/callback.html
https://tiltgarden.kapework.com/shared/auth/callback.html
https://puzzlefoundry.kapework.com/shared/auth/callback.html
https://clipdigest.kapework.com/shared/auth/callback.html
https://nameforge.kapework.com/shared/auth/callback.html
https://ma.kapework.com/shared/auth/callback.html
```

The list was derived from `index.html`, the hub links, app entry files, and `netlify/edge-functions/subdomain-router.ts`. Read-only HTTP checks on 2026-10-31 found the listed origins available. Make24's explicit `/index.html` serves the folder app; its `/` currently redirects to the older single-file app because `apps/make24.html` collides with the folder's clean URL. Use `https://make24.kapework.com/index.html` for the integrated folder app until routing is deliberately changed.

Do not add these as additional production sign-in origins:

- `www.kapework.com` redirects to `kapework.com`; sign-in starts on the latter.
- `blinkgrid.kapework.com` only redirects to BlinkGrid4.
- `cvcbuilder.kapework.com` failed certificate hostname validation during the check. CVC Builder remains reachable through `https://kapework.com/apps/cvcbuilder.html`, using the root callback. Repair and verify the alias before adding its exact callback.
- `make24.app` is a separate deployment and is not updated by this repository's release. Its integration requires its own review; the Kapework-hosted Make24 is covered above.

Keep existing approved email-return entries while adding the OAuth callbacks. Ma currently requests `https://ma.kapework.com`; My Plan requests `https://create.kapework.com/myplan/` on its canonical address. Verify the exact normalization and email templates with the provider before removing either no-slash/slash variants already in use. The new callback entries do not replace those email paths.

For each preview, add only `https://<exact-preview-host>/shared/auth/callback.html`, replacing the placeholder with the actual pipeline preview hostname. For local OAuth tests use one exact origin/port, such as `http://localhost:8888/shared/auth/callback.html`, in a separate development project. Remove temporary entries after validation. Never add an unrestricted `*.netlify.app` entry to production.

## Google and deployment configuration

Google's **Web application** OAuth client must use the project's Supabase callback as its Authorized redirect URI. For the existing production project this is:

```text
https://fimsbfcvavpehryvvcho.supabase.co/auth/v1/callback
```

Leave Google's Authorized JavaScript origins unset for this implementation: it uses a full-page server OAuth flow through Supabase, without Google's browser SDK, popup, One Tap, or ID-token client. Google's Authorized redirect URI above is required; the 22 app callback URLs belong in Supabase. The app requests only `openid email profile`. Configure Kapework branding with `https://kapework.com/` and the published `https://kapework.com/privacy/`; do not supply an unpublished terms URL. External audience and production availability must permit ordinary Google accounts, rather than only a testing allowlist. Store the client ID/secret in Supabase's Google provider configuration; never place the client secret in repository files, browser config, logs, or PR text. See [Supabase's Google provider setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google); browser-SDK integration would require its additional browser-origin configuration.

Netlify builds run `npm test && node scripts/generate-config.js`. Browser config contains the public Supabase URL and anon key from `SUPABASE_URL` and `SUPABASE_ANON_KEY`; service-role and Google secrets remain server/provider-side. Google readiness is read from the actual Supabase `/auth/v1/settings` response, not a hardcoded frontend flag. Missing configuration/provider availability leaves public apps usable without signing in. Use separate staging credentials and verify build-context environment scopes; a deploy preview alone does not imply database isolation.

Activation order:

1. Apply and review migration 016 in staging; run the complete rollback verification SQL below. Deploy the code and Ma function restrictions through the branch/PR preview pipeline. Keep new public registrations disabled during preparation.
2. Configure and attach the Before User Created hook. Verify Google-shaped new-user input passes, email/missing providers fail, and browser roles cannot call the hook or maintenance RPCs. Check the hook is actually attached, not merely present in the database.
3. Configure the Google client/provider, exact callback URLs, and real preview origin. Test existing-account sign-in and cancellation in the preview. Publish the privacy page before using it in production branding.
4. Deploy the reviewed code and server restrictions to production through the normal merge pipeline. Verify the deployed commit, callback assets, public config host, and callback CSP. Apply the reviewed production migration and attach its hook before opening registration if not already done through the approved release sequence.
5. Only after the hook and Ma isolation checks pass, enable Google and allow new signups globally. The server hook then limits self-registration to Google. Test a new ordinary Google account, a returning account, blocked public email signup, and denied Ma access for an ungranted account. Record results rather than assuming the provider toggle proves the journey works.

## Validation and handover

Run from the repository root:

```sh
npm test
npm run test:auth
```

The integrated local run reviewed on 2026-10-31 passed 572 tests: 497 existing/server checks, 35 My Plan checks, and 40 shared-auth/origin/UI checks. These include singleton/PKCE return handling, legacy migration, local sign-out, provider/network failures, existing-account-only email requests, callback scheduling, text-safe account rendering, and Ma origin rejection. Make24/36's separate Jest suites are not part of that count and need their own app dependencies installed before running. Syntax checks also parsed the changed JS and the staged public pages' inline scripts.

Run `supabase-migrations/verify/016_ma_account_access_verify.sql` as one complete transaction after migration 016. It creates synthetic fixtures, verifies owner/member/caregiver, revoked/removed member, general-account and anonymous boundaries, and rolls back. Do not split it into persistent setup steps or invoke maintenance cleanup functions to test their permissions.

Before describing the feature as live, record these browser checks and their exact deployment:

- Root and five hubs expose Sign in/Account; each shared/custom game menu opens the account dialog. Guest play still starts without a provider or network connection.
- Google returns to the same app on the same origin; cancellation, expired code, disallowed redirect, offline startup, and a different-browser attempt show useful errors without erasing local work.
- A returning Google account reopens My Plan content on another device after signing in there. Legacy My Plan migration does not replace an existing shared account; device drafts are claimed only by explicit choice.
- Ma denies a fresh general Google account before profile creation. Existing granted owner/member/caregiver accounts retain the appropriate views; revoked accounts and anonymous visitors cannot access private rows, media, or mutations.
- Existing email code/password flows still work; PKCE email links work in the requesting browser and fail visibly elsewhere. Sign-out does not restore a consumed legacy session.
- Check iPhone Safari, Android Chrome and a desktop browser where available. Mark unavailable device/provider journeys as manual checks still required. Automated tests and HTTP asset checks do not establish successful real Google consent or cross-device sign-in.

## Account entry coverage

| Surface | Entry point |
| --- | --- |
| Root | Visible Sign in/Account button |
| Ready Set Read, Number Crunch, Brain Gym, Create, Tools | Visible button plus shared ellipsis Account item |
| Motif, Motif6x6, BlinkGrid4, Rainbow Rules, Longshot, Puzzle Foundry, TapSum, CVC Builder, ClipDigest, NameForge | Shared ellipsis Account item |
| Color & Sign, Tap Piano, Magic Mirror, Pixel Tiles, Color Pages, Finish the Picture | Shared ellipsis Account item on the Create origin |
| Prim4, Tiltrix, Tilt Garden | Account item in the existing custom menu |
| Hot Hand | Visible lobby Sign in/Account button |
| Make24 folder, Make36 | Account menu item plus existing settings email fallback, using the shared adapter |
| Legacy `/apps/make24.html` | Existing settings account controls use the shared adapter |
| My Plan | Its own account dialog; no duplicate shell account item |
| Ma | Its own granted-access sign-in screen; paired-device Vandaag unchanged |

If activation must be stopped, disable new registrations/Google provider without removing Ma RLS, membership checks, the signup hook, or local drafts. Revert app code through a reviewed PR/pipeline only when needed; disabling new signup is not a reason to undo the access hardening.
