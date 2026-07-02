const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, device_id, industry, root_cause, phase_reached, memo_generated } = req.body;

  try {
    if (action === 'init_session') {
      const { data, error } = await supabase
        .from('sessions')
        .upsert({ device_id, last_active: new Date().toISOString() }, { onConflict: 'device_id' })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ session: data });
    }

    if (action === 'check_limit') {
      const { data, error } = await supabase
        .from('sessions')
        .select('case_count')
        .eq('device_id', device_id)
        .single();
      if (error && error.code === 'PGRST116') {
        return res.status(200).json({ case_count: 0, allowed: true });
      }
      if (error) throw error;
      return res.status(200).json({
        case_count: data.case_count,
        allowed: data.case_count < 1
      });
    }

    if (action === 'start_case') {
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .upsert({ device_id, last_active: new Date().toISOString() }, { onConflict: 'device_id' })
        .select()
        .single();
      if (sessionError) throw sessionError;

      await supabase
        .from('sessions')
        .update({ case_count: (session.case_count || 0) + 1, last_active: new Date().toISOString() })
        .eq('device_id', device_id);

      const { data: caseData, error: caseError } = await supabase
        .from('cases')
        .insert({ session_id: session.id, device_id, phase_reached: 0 })
        .select()
        .single();
      if (caseError) throw caseError;

      return res.status(200).json({ case_id: caseData.id });
    }

    if (action === 'update_case') {
      const { case_id } = req.body;
      await supabase
        .from('cases')
        .update({ industry, root_cause, phase_reached, memo_generated })
        .eq('id', case_id);
      return res.status(200).json({ ok: true });
    }

  } catch (err) {
    console.error('Supabase error:', err);
    return res.status(500).json({ error: err.message });
  }
};
