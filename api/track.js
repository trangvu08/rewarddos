// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 002 — email-based free-limit tracking
//
// RUN THIS IN THE SUPABASE SQL EDITOR *BEFORE* DEPLOYING THIS FILE.
// Idempotent — safe to run more than once.
//
//   -- 1. Email column + uniqueness. The unique index is REQUIRED: PostgREST
//   --    needs it for `.upsert(..., { onConflict: 'email' })` to work at all.
//   --    Postgres permits many NULLs in a unique index, so pre-existing
//   --    device_id-only rows are unaffected.
//   alter table sessions add column if not exists email text;
//   create unique index if not exists sessions_email_key on sessions (email);
//
//   -- 2. New rows are keyed by email and carry no device_id. If device_id is
//   --    still NOT NULL the insert fails with error 23502.
//   alter table sessions alter column device_id drop not null;
//
//   -- 3. Email on cases, for analytics joins. device_id is deliberately KEPT.
//   alter table cases add column if not exists email text;
//   create index if not exists cases_email_idx on cases (email);
//
// Verify afterwards:
//   select column_name, is_nullable from information_schema.columns
//    where table_name = 'sessions' and column_name in ('email','device_id');
//   -- expect: email YES, device_id YES
//
// ⚠ Existing free-tier usage does NOT carry over. Counting moves from device_id
// to email, so every current user starts again at 0 of 2 cases.
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

// Free-tier ceiling, per email. Single source of truth — check_limit and
// start_case both read this so the advisory check can't drift from enforcement.
const FREE_CASE_LIMIT = 2;

// Lazy client. Building it at module scope meant a missing env var threw during
// cold start, before the handler ever ran.
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    const err = new Error('Server misconfigured: missing SUPABASE_URL or SUPABASE_ANON_KEY');
    err.statusCode = 500;
    throw err;
  }
  _supabase = createClient(url, key);
  return _supabase;
}

// Normalised server-side so Foo@X.com and foo@x.com can't become two rows and
// two free quotas. The client normalises too, but this is the authoritative pass.
function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// Deliberately permissive — this gate captures leads, it does not verify identity.
// Anything shaped like an address passes; nothing is emailed or confirmed.
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function isOwnerEmail(email) {
  const owners = (process.env.OWNER_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return owners.includes(email);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { action } = body;
  const email = normalizeEmail(body.email);
  // Retained for analytics only — never used for identity or limit decisions.
  const device_id = typeof body.device_id === 'string' ? body.device_id : null;

  if (!action) return res.status(400).json({ error: 'Missing required field: action' });

  // Every action except update_case is keyed by email.
  const needsEmail = action === 'register_email' || action === 'check_limit' || action === 'start_case';
  if (needsEmail) {
    if (!email) return res.status(400).json({ error: 'Missing required field: email' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const supabase = getSupabase();

    if (action === 'register_email') {
      const { data, error } = await supabase
        .from('sessions')
        .upsert(
          { email, device_id, last_active: new Date().toISOString() },
          { onConflict: 'email' }
        )
        .select()
        .single();
      if (error) throw error;
      const count = data.case_count || 0;
      return res.status(200).json({
        ok: true,
        case_count: count,
        limit: FREE_CASE_LIMIT,
        allowed: isOwnerEmail(email) || count < FREE_CASE_LIMIT
      });
    }

    if (action === 'check_limit') {
      if (isOwnerEmail(email)) {
        return res.status(200).json({ case_count: 0, limit: FREE_CASE_LIMIT, allowed: true });
      }
      const { data, error } = await supabase
        .from('sessions')
        .select('case_count')
        .eq('email', email)
        .single();
      // PGRST116 = no row yet: an email we've never seen has used 0 cases.
      if (error && error.code === 'PGRST116') {
        return res.status(200).json({ case_count: 0, limit: FREE_CASE_LIMIT, allowed: true });
      }
      if (error) throw error;
      const count = data.case_count || 0;
      return res.status(200).json({
        case_count: count,
        limit: FREE_CASE_LIMIT,
        allowed: count < FREE_CASE_LIMIT
      });
    }

    if (action === 'start_case') {
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .upsert(
          { email, device_id, last_active: new Date().toISOString() },
          { onConflict: 'email' }
        )
        .select()
        .single();
      if (sessionError) throw sessionError;

      // Enforced HERE, not only in check_limit. check_limit is advisory — the
      // browser decides whether to honour it, so this is the actual gate.
      const currentCount = session.case_count || 0;
      if (!isOwnerEmail(email) && currentCount >= FREE_CASE_LIMIT) {
        return res.status(403).json({
          error: 'free_limit_reached',
          case_count: currentCount,
          limit: FREE_CASE_LIMIT,
          allowed: false
        });
      }

      await supabase
        .from('sessions')
        .update({ case_count: currentCount + 1, last_active: new Date().toISOString() })
        .eq('email', email);

      const { data: caseData, error: caseError } = await supabase
        .from('cases')
        .insert({ session_id: session.id, email, device_id, phase_reached: 0 })
        .select()
        .single();
      if (caseError) throw caseError;

      return res.status(200).json({
        case_id: caseData.id,
        case_count: currentCount + 1,
        limit: FREE_CASE_LIMIT
      });
    }

    if (action === 'update_case') {
      const { case_id, industry, root_cause, phase_reached, memo_generated, conversation, memo_content, flags } = body;
      if (!case_id) return res.status(400).json({ error: 'Missing required field: case_id' });
      const updateData = {};
      if (industry !== undefined) updateData.industry = industry;
      if (root_cause !== undefined) updateData.root_cause = root_cause;
      if (phase_reached !== undefined) updateData.phase_reached = phase_reached;
      if (memo_generated !== undefined) updateData.memo_generated = memo_generated;
      if (conversation !== undefined) updateData.conversation = conversation;
      if (memo_content !== undefined) updateData.memo_content = memo_content;
      if (flags !== undefined) updateData.flags = flags;

      const { error } = await supabase.from('cases').update(updateData).eq('id', case_id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Previously fell through with no response, hanging the request until timeout.
    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('Supabase error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// Must come AFTER the module.exports assignment above — setting it before would be
// overwritten by that assignment. Set here rather than in a vercel.json "functions"
// block because this project uses the legacy "builds" array, and Vercel rejects a
// config containing both.
module.exports.config = { maxDuration: 30 };
