-- Migration 001 — columns written by api/track.js (action: update_case)
-- Idempotent: safe to run multiple times. Apply in the Supabase SQL editor.
--
-- The `cases` table is written by public/index.html -> updateCaseTracking()
-- -> api/track.js. Columns added over time as the tracking payload grew:
--   industry, root_cause, phase_reached, memo_generated  (original)
--   conversation, memo_content                           (transcript + memo persistence)
--   flags                                                (risk flags, e.g. "sip_design_issue")
--
-- Without these columns the Supabase update fails silently — updateCaseTracking()
-- is fire-and-forget, so the error is swallowed and nothing is stored.

alter table cases add column if not exists industry       text;
alter table cases add column if not exists root_cause     text;
alter table cases add column if not exists phase_reached  integer;
alter table cases add column if not exists memo_generated boolean default false;
alter table cases add column if not exists conversation   jsonb;   -- array of {role, content}
alter table cases add column if not exists memo_content   text;    -- rendered memo HTML
alter table cases add column if not exists flags          jsonb;   -- string[] of risk flags
