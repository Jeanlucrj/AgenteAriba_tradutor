const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

async function supabasePost(table, body) {
  if (!isConfigured()) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${table}: ${await res.text()}`);
  const rows = await res.json();
  return rows?.[0] ?? null;
}

async function supabasePatch(table, id, body) {
  if (!isConfigured()) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}: ${await res.text()}`);
}

async function startMeeting(sourceLang, targetLang) {
  try {
    const row = await supabasePost('meetings', { source_lang: sourceLang, target_lang: targetLang });
    console.log(`[DB] Sessão iniciada: ${row?.id}`);
    return row?.id ?? null;
  } catch (e) {
    console.error('[DB] Erro ao iniciar sessão:', e.message);
    return null;
  }
}

async function saveTurn(meetingId, { originalText, translatedText, isQuestion, suggestedResponse, suggestedResponsePT, keyPoints }) {
  if (!meetingId) return;
  try {
    await supabasePost('meeting_turns', {
      meeting_id: meetingId,
      original_text: originalText,
      translated_text: translatedText ?? null,
      is_question: isQuestion ?? false,
      suggested_response: suggestedResponse ?? null,
      suggested_response_pt: suggestedResponsePT ?? null,
      key_points: keyPoints ?? [],
    });
  } catch (e) {
    console.error('[DB] Erro ao salvar turno:', e.message);
  }
}

async function endMeeting(meetingId) {
  if (!meetingId) return;
  try {
    await supabasePatch('meetings', meetingId, { ended_at: new Date().toISOString() });
    console.log(`[DB] Sessão encerrada: ${meetingId}`);
  } catch (e) {
    console.error('[DB] Erro ao encerrar sessão:', e.message);
  }
}

async function supabaseGet(path) {
  if (!isConfigured()) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${await res.text()}`);
  return res.json();
}

async function getMeetings() {
  return supabaseGet('meetings?order=started_at.desc&limit=100');
}

async function getTurns(meetingId) {
  return supabaseGet(`meeting_turns?meeting_id=eq.${meetingId}&order=created_at.asc`);
}

module.exports = { startMeeting, saveTurn, endMeeting, getMeetings, getTurns, isConfigured };
