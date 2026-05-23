/**
 * Traduz um texto de forma direta para o idioma alvo usando a API oficial do Google Gemini
 * @param {string} text Texto de entrada transcrito
 * @param {string} targetLang Idioma final (ex: 'Português', 'English', 'Español')
 * @returns {Promise<string>} Tradução finalizada
 */
async function translateText(text, targetLang = 'Português', context = []) {
  if (!text || !text.trim()) return '';

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      throw new Error("Chave de API do Gemini não configurada no arquivo .env");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: `You are a real-time translator for business meetings (Teams, Google Meet, Zoom). Translate the user's text directly to ${targetLang}. Output ONLY the translated text — no explanations, no notes, no quotes, no prefix like "Translation:".${context.length > 0 ? `\n\nRecent conversation context (already translated — use for consistency of names, terms and pronouns):\n${context.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}` }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: text }]
            }
          ],
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 300,
            thinkingConfig: { thinkingBudget: 0 },
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errData = {};
      try { errData = JSON.parse(errText); } catch (_) {}
      throw new Error(errData.error?.message || `HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      const blockReason = data.promptFeedback?.blockReason;
      throw new Error(`Nenhuma tradução retornada pelo Gemini. Motivo: ${blockReason || 'desconhecido'}`);
    }

    const candidate = data.candidates[0];
    if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      throw new Error(`Gemini encerrou com motivo: ${candidate.finishReason}`);
    }

    const translated = candidate.content?.parts?.[0]?.text?.trim();
    if (!translated) {
      throw new Error('Resposta do Gemini veio vazia ou mal formatada');
    }

    return translated;

  } catch (error) {
    console.error('Erro na chamada da API do Gemini:', error.message);
    throw new Error(`Gemini Error: ${error.message}`);
  }
}

module.exports = {
  translateText
};
