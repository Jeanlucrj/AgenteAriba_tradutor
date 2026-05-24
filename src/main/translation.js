// Mapeamento de idiomas do app para códigos DeepL
const DEEPL_LANG_MAP = {
  'Português':  'PT-BR',
  'English':    'EN-US',
  'Español':    'ES',
  'French':     'FR',
  'German':     'DE',
  'Italian':    'IT',
};

const DEEPL_SOURCE_MAP = {
  'en': 'EN', 'pt': 'PT', 'es': 'ES',
  'fr': 'FR', 'de': 'DE', 'it': 'IT',
  'zh': 'ZH', 'ja': 'JA', 'auto': null,
};

async function translateWithDeepL(text, targetLang, sourceLang) {
  const apiKey = (process.env.DEEPL_API_KEY || '').trim();
  if (!apiKey || apiKey.toLowerCase().includes('your_')) {
    console.warn('[DeepL] Chave não configurada');
    return null;
  }

  const targetCode = DEEPL_LANG_MAP[targetLang];
  if (!targetCode) {
    console.warn(`[DeepL] Idioma não mapeado: "${targetLang}"`);
    return null;
  }

  const sourceCode = DEEPL_SOURCE_MAP[sourceLang] || null;
  console.log(`[DeepL] → target: ${targetCode}${sourceCode ? ` de ${sourceCode}` : ''}`);

  // SDK oficial deepl-node — mais confiável que fetch direto no Electron
  const deepl = require('deepl-node');
  const client = new deepl.DeepLClient(apiKey);
  const result = await client.translateText(text, sourceCode, targetCode);
  const translated = result.text?.trim();
  if (!translated) throw new Error('DeepL retornou resposta vazia');
  console.log(`[DeepL] ✅ "${translated.slice(0, 60)}"`);
  return translated;
}

async function translateWithGemini(text, targetLang, context = []) {
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
    throw new Error(`Nenhuma tradução retornada. Motivo: ${data.promptFeedback?.blockReason || 'desconhecido'}`);
  }

  const candidate = data.candidates[0];
  if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
    throw new Error(`Gemini encerrou com motivo: ${candidate.finishReason}`);
  }

  const translated = candidate.content?.parts?.[0]?.text?.trim();
  if (!translated) throw new Error('Resposta do Gemini vazia');
  return translated;
}

/**
 * Traduz texto: tenta DeepL primeiro, cai no Gemini se falhar.
 */
async function translateText(text, targetLang = 'Português', context = [], sourceLang = 'auto') {
  if (!text || !text.trim()) return '';

  // 1. Tenta DeepL (mais rápido, gratuito até 1 milhão de chars/mês no plano Free)
  try {
    const result = await translateWithDeepL(text, targetLang, sourceLang);
    if (result) {
      return { text: result, engine: 'DeepL' };
    }
  } catch (e) {
    console.warn(`[Tradução] DeepL falhou (${e.message}) — usando Gemini`);
  }

  // 2. Fallback: Gemini
  try {
    const result = await translateWithGemini(text, targetLang, context);
    return { text: result, engine: 'Gemini' };
  } catch (e) {
    console.error('Erro na tradução:', e.message);
    throw new Error(`Tradução falhou: ${e.message}`);
  }
}

module.exports = { translateText };
