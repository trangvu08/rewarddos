-- Migration 002 — email-based free-limit tracking
-- Idempotent: safe to run multiple times. Apply in the Supabase SQL editor
-- BEFORE deploying the api/track.js that depends on it.
--
-- The free-tier limit moves from device_id (localStorage, resets when the user
-- clears site data) to email (captured by the gate modal in public/index.html).
--
-- ⚠ Existing free-tier usage does NOT carry over: counting is keyed on a new
-- column, so every current user restarts at 0 of 2 cases.

-- 1. Email column + uniqueness on sessions.
--    The unique index is REQUIRED — PostgREST needs it for
--    .upsert(..., { onConflict: 'email' }) to work at all.
--    Postgres permits many NULLs in a unique index, so pre-existing
--    device_id-only rows are unaffected.
alter table sessions add column if not exists email text;
create unique index if not exists sessions_email_key on sessions (email);

-- 2. New session rows are keyed by email and carry no device_id.
--    If device_id is still NOT NULL, those inserts fail with error 23502.
alter table sessions alter column device_id drop not null;

-- 3. Email on cases, for analytics joins.
--    device_id is deliberately KEPT on this table as an analytics fallback.
alter table cases add column if not exists email text;
create index if not exists cases_email_idx on cases (email);

-- Verify:
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'sessions' and column_name in ('email','device_id');
--   -- expect: email YES, device_id YES
