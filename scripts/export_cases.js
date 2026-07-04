// scripts/export_cases.js
// Exports memo-generated cases from Supabase to scripts/cases_export.json and
// prints a summary, to help identify cases rich enough to distill into
// few-shot examples for the system prompt in public/index.html.
//
// Run from the repo root with the same env vars api/track.js uses:
//   SUPABASE_URL and SUPABASE_ANON_KEY
//
// Bash:        SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_ANON_KEY="eyJ..." node scripts/export_cases.js
// PowerShell:  $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_ANON_KEY="eyJ..."; node scripts/export_cases.js

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(`
❌ Missing Supabase credentials.

This script needs the same two env vars that api/track.js uses:
  • SUPABASE_URL       (e.g. https://xxxxx.supabase.co)
  • SUPABASE_ANON_KEY  (the anon/public key, "eyJ...")

Find them in: Supabase dashboard → Project Settings → API,
or in your Vercel project → Settings → Environment Variables.

Run from the repo root (D:\\RewardsDOS\\rewards-os-deploy):

  PowerShell:
    $env:SUPABASE_URL="https://xxxxx.supabase.co"; $env:SUPABASE_ANON_KEY="eyJ..."; node scripts/export_cases.js

  Git Bash / Linux / macOS:
    SUPABASE_URL="https://xxxxx.supabase.co" SUPABASE_ANON_KEY="eyJ..." node scripts/export_cases.js

Note: if the query returns 0 rows but you know memo cases exist, the anon key is
likely blocked by row-level security on the "cases" table — use the service_role
key instead (Settings → API → service_role), and keep it out of git.
`.trim());
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const COLUMNS = 'id, industry, root_cause, phase_reached, conversation, memo_content, created_at';

async function fetchCases() {
  // Prefer newest-first; fall back if the table has no created_at column.
  let { data, error } = await supabase
    .from('cases')
    .select(COLUMNS)
    .eq('memo_generated', true)
    .order('created_at', { ascending: false });

  if (error && /created_at/.test(error.message || '')) {
    console.warn('⚠️  No created_at column — fetching without ordering.');
    ({ data, error } = await supabase
      .from('cases')
      .select(COLUMNS)
      .eq('memo_generated', true));
  }

  if (error) {
    console.error('❌ Supabase query failed:', error.message);
    process.exit(1);
  }
  return data || [];
}

function tally(rows, key) {
  const counts = {};
  for (const r of rows) {
    const k = (r[key] === null || r[key] === undefined || r[key] === '') ? '(none)' : String(r[key]);
    counts[k] = (counts[k] || 0) + 1;
  }
  // sort by count desc
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function convLength(row) {
  const c = row.conversation;
  if (Array.isArray(c)) return c.length;
  if (typeof c === 'string') { try { const p = JSON.parse(c); return Array.isArray(p) ? p.length : 0; } catch { return 0; } }
  return 0;
}

(async () => {
  const rows = await fetchCases();

  const outPath = path.join(__dirname, 'cases_export.json');
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(`  Exported ${rows.length} memo-generated case(s)`);
  console.log(`  → ${outPath}`);
  console.log('════════════════════════════════════════════');

  console.log('\nBy root_cause:');
  for (const [k, n] of tally(rows, 'root_cause')) console.log(`  ${String(n).padStart(4)}  ${k}`);

  console.log('\nBy industry:');
  for (const [k, n] of tally(rows, 'industry')) console.log(`  ${String(n).padStart(4)}  ${k}`);

  // Richness hint: cases with the longest conversations + a memo are the best
  // few-shot candidates. Surface the top 10 by message count.
  const ranked = rows
    .map(r => ({ id: r.id, industry: r.industry, root_cause: r.root_cause, phase: r.phase_reached, msgs: convLength(r), memoChars: (r.memo_content || '').length }))
    .sort((a, b) => b.msgs - a.msgs)
    .slice(0, 10);

  console.log('\nRichest cases (top 10 by conversation length — few-shot candidates):');
  console.log('  msgs  memoChars  phase  root_cause / industry / id');
  for (const r of ranked) {
    console.log(`  ${String(r.msgs).padStart(4)}  ${String(r.memoChars).padStart(9)}  ${String(r.phase ?? '').padStart(5)}  ${r.root_cause || '(none)'} / ${r.industry || '(none)'} / ${r.id}`);
  }
  console.log('');
})();
