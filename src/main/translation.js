async function translateText(text, targetLang = 'Português', context = [], sourceLang = 'auto') {
  if (!text || !text.trim()) return { text: '', engine: 'Gemini' };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('Chave de API do Gemini não configurada no arquivo .env');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: `You are a real-time translator for business meetings (Teams, Google Meet, Zoom). Translate the user's text directly to ${targetLang}. Output ONLY the translated text — no explanations, no notes, no quotes, no prefix like "Translation:".${context.length > 0 ? `\n\nRecent conversation context (already translated — use for consistency of names, terms and pronouns):\n${context.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}` }]
        },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errData = {};
    try { errData = JSON.parse(errText); } catch (_) {}
    throw new Error(errData.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.candidates?.length) throw new Error('Gemini sem resposta');
  const translated = data.candidates[0].content?.parts?.[0]?.text?.trim();
  if (!translated) throw new Error('Gemini resposta vazia');
  return { text: translated, engine: 'Gemini' };
}

module.exports = { translateText };
