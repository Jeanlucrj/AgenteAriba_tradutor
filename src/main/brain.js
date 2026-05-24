const fs = require('fs');
const path = require('path');

const BRAIN_DIR    = path.join(process.cwd(), 'brain');
const MEETINGS_DIR = path.join(BRAIN_DIR, 'meetings');
const KNOWLEDGE_DIR = path.join(BRAIN_DIR, 'knowledge');

function ensureDirs() {
  [BRAIN_DIR, MEETINGS_DIR, KNOWLEDGE_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// Gera resumo estruturado da reunião via Gemini
async function generateMeetingSummary(turns, sourceLang = 'en', targetLang = 'Português') {
  if (!turns || turns.length === 0) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const conversationText = turns.map(t => {
    if (t.is_question) {
      return `[PERGUNTA DETECTADA] "${t.original_text}"\nResposta sugerida: "${t.suggested_response || ''}"`;
    }
    return `Fala: "${t.original_text}"\nTradução: "${t.translated_text || ''}"`;
  }).join('\n\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: `Você é um consultor SAP Ariba Senior analisando uma reunião de projeto. Gere um resumo estruturado em Markdown que será salvo como memória persistente para reuniões futuras. Seja específico, objetivo e capture apenas informações úteis para o futuro.` }]
        },
        contents: [{
          role: 'user',
          parts: [{ text: `Transcrição da reunião (idioma de origem: ${sourceLang} → ${targetLang}):\n\n${conversationText}\n\nGere um resumo estruturado com as seguintes seções (em Português BR):\n\n## Resumo da Reunião\n(2-3 frases do que foi discutido)\n\n## Decisões Tomadas\n(lista de decisões confirmadas)\n\n## Tópicos Ariba Abordados\n(módulos, features, integrações discutidas)\n\n## Pontos em Aberto\n(dúvidas e pendências não resolvidas)\n\n## Notas Técnicas\n(configurações, erros, arquitetura mencionada)\n\n## Contexto do Cliente/Projeto\n(informações inferidas sobre ambiente, equipe, escopo)` }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    }
  );

  if (!response.ok) throw new Error(`Gemini brain error: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

function saveMeetingSummary(summary) {
  ensureDirs();
  const now = new Date();
  const label = now.toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
  const filename = `${label}.md`;
  const filepath = path.join(MEETINGS_DIR, filename);
  fs.writeFileSync(filepath, `# Reunião ${now.toLocaleString('pt-BR')}\n\n${summary}\n`, 'utf-8');
  console.log(`[Brain] Resumo salvo: ${filename}`);
  return filepath;
}

// Carrega contexto do cérebro para enriquecer o prompt do Consultor Ariba
function loadBrainContext() {
  ensureDirs();
  let ctx = '';

  // Últimas 5 reuniões
  try {
    const files = fs.readdirSync(MEETINGS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-5);
    if (files.length > 0) {
      ctx += '\n\n=== HISTÓRICO DE REUNIÕES ANTERIORES (memória do agente) ===\n';
      files.forEach(f => {
        ctx += '\n' + fs.readFileSync(path.join(MEETINGS_DIR, f), 'utf-8') + '\n---';
      });
    }
  } catch (e) {
    console.warn('[Brain] Falha ao carregar reuniões:', e.message);
  }

  // Base de conhecimento manual
  try {
    fs.readdirSync(KNOWLEDGE_DIR)
      .filter(f => f.endsWith('.md'))
      .forEach(f => {
        const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8').trim();
        if (content && !content.startsWith('_Adicione')) {
          ctx += `\n\n=== ${f.replace('.md', '').toUpperCase()} ===\n${content}`;
        }
      });
  } catch (e) {
    console.warn('[Brain] Falha ao carregar knowledge:', e.message);
  }

  return ctx.trim();
}

// Extrai novo conhecimento técnico da conversa e persiste no cérebro
async function extractAndLearnKnowledge(turns) {
  if (!turns || turns.length < 3) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const conversationText = turns.map(t =>
    t.is_question
      ? `[PERGUNTA] "${t.original_text}" → Resposta: "${t.suggested_response || ''}"`
      : `Fala: "${t.original_text}"`
  ).join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: `Você é um especialista SAP analisando uma transcrição de reunião para extrair novos conhecimentos técnicos que valem ser memorizados para reuniões futuras. Extraia apenas conhecimento objetivo e reutilizável (conceitos, decisões de arquitetura, nomes de sistemas, configurações, integrações, regras de negócio). Ignore conversas genéricas ou saudações. Se não houver conhecimento novo relevante, retorne apenas a palavra NADA.` }]
        },
        contents: [{
          role: 'user',
          parts: [{ text: `Transcrição:\n${conversationText}\n\nExtraia conhecimentos técnicos novos em formato de lista Markdown concisa (máx. 10 itens). Use Português BR. Se nada relevante, responda: NADA` }]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } }
      })
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text || text === 'NADA') return null;

  ensureDirs();
  const learnedFile = path.join(KNOWLEDGE_DIR, 'learned_from_meetings.md');
  const now = new Date().toLocaleString('pt-BR');
  const entry = `\n\n## Aprendizado — ${now}\n${text}`;
  fs.appendFileSync(learnedFile, entry, 'utf-8');
  console.log(`[Brain] Novo conhecimento extraído e salvo.`);
  return text;
}

module.exports = { generateMeetingSummary, saveMeetingSummary, loadBrainContext, extractAndLearnKnowledge };
