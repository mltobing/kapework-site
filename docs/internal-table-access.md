# Internal table access containment

On 2 November 2026, migration `018_internal_table_access.sql` was applied to the Kapework Supabase project as `internal_table_access`, following the owner's request for immediate containment.

`public.internal_people` and `public.internal_devices` previously had RLS disabled and full table grants to `anon` and `authenticated`. The migration enables RLS and revokes all table privileges from `PUBLIC`, `anon` and `authenticated`. No browser-access policies are added: these tables are intentionally inaccessible to app clients. Existing direct owner and `service_role` permissions remain intact. No table data, authentication settings or other app permissions are changed.

Preflight found no table policies, separate column grants, database view definitions or function bodies referencing the two tables. Repository search found only a historical migration comment, with no runtime consumers. An external tool using a browser/public-key session will now be denied; privileged administrative access remains available.

This narrow emergency change was applied before the repository PR completed; an isolated staging database was not available. Live verification uses `EXPLAIN` without `ANALYZE` under `anon` and `authenticated`, so no DML or private-row reads execute. All 16 SELECT/INSERT/UPDATE/DELETE probes were denied with SQLSTATE 42501. Effective table/column privileges, enabled RLS and preserved service-role access were also verified. Run `supabase-migrations/verify/018_internal_table_access_verify.sql` to repeat these checks; it rolls back session changes.

The follow-up security advisor no longer reports `rls_disabled_in_public` for either table. Its informational `rls_enabled_no_policy` notices are expected for these intentionally browser-inaccessible tables. This change closes the exposure; it does not establish whether historical access occurred or resolve other findings from the wider security review.

Do not restore public grants as a routine rollback. If an administrative consumer fails, review its access separately and use an appropriately restricted server-side path.
