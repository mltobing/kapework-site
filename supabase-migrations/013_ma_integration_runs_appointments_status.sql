-- 013_ma_integration_runs_appointments_status.sql — idempotent.
--
-- Adds ma_integration_runs.appointments_status. The private irma-sync job's
-- reporting.py (see its "provider appointment reconciliation" change) writes
-- this column on every run's start_row() and finalize_row(), and reads it as
-- part of MA_INTEGRATION_RUN_COLUMNS — but no earlier migration created it.
-- Without this column the next sync run on that code fails to write/read its
-- run row, which would also stall provider-appointment ingestion.
--
-- Mirrors notices_status' status vocabulary and shape exactly (migration 009):
-- a single status column, not a second set of count columns. Defaults to
-- 'skipped' so pre-existing rows and the appointments-disabled case are valid
-- without a backfill step.

alter table ma_integration_runs
  add column if not exists appointments_status text not null default 'skipped';

alter table ma_integration_runs
  drop constraint if exists ma_integration_runs_appointments_status_check;

alter table ma_integration_runs
  add constraint ma_integration_runs_appointments_status_check
  check (appointments_status = any (array['pending', 'success', 'failed', 'disabled', 'misconfigured', 'skipped']));
