const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(process.cwd(), 'brain', 'knowledge');

function ensureKnowledgeDir() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

// Extrai texto de PDF
async function extractPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

// Extrai texto de DOCX
async function extractDocx(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

// Extrai texto de TXT/MD
function extractText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return await extractPdf(filePath);
  if (ext === '.docx') return await extractDocx(filePath);
  return extractText(filePath);
}

// Gera título, tags e resumo via Gemini (chamada única na inserção)
async function generateTagsAndSummary(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurado');

  // Trunca para não gastar tokens desnecessários (primeiros 6000 chars)
  const sample = text.slice(0, 6000);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Analise este documento e responda APENAS com JSON válido (sem markdown):\n\n${sample}\n\n{\n  "title": "título descritivo em português BR (máx 60 chars)",\n  "tags": ["até 10 keywords em inglês/português relevantes para busca: nomes de módulos SAP, processos, tecnologias, etc"],\n  "summary": "resumo compacto em português BR com os principais conceitos (máx 300 chars)"\n}` }]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } }
      })
    }
  );

  if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(json);
}

// Processa e insere um arquivo no cérebro
async function addFileToBrain(filePath) {
  ensureKnowledgeDir();
  const originalName = path.basename(filePath);

  console.log(`[Brain] Processando arquivo: ${originalName}`);
  const text = await extractTextFromFile(filePath);
  if (!text || text.trim().length < 50) throw new Error('Arquivo vazio ou muito curto');

  console.log(`[Brain] Gerando tags via Gemini...`);
  const meta = await generateTagsAndSummary(text);

  const slug = originalName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 40)
    .toLowerCase();

  const now = new Date().toISOString().slice(0, 10);
  const content = `---
title: ${meta.title}
tags: [${meta.tags.join(', ')}]
source: ${originalName}
added: ${now}
---

## Resumo
${meta.summary}

## Conteúdo
${text.slice(0, 8000)}`;

  const destFile = path.join(KNOWLEDGE_DIR, `${slug}.md`);
  fs.writeFileSync(destFile, content, 'utf-8');
  console.log(`[Brain] Arquivo salvo: ${slug}.md | Tags: ${meta.tags.join(', ')}`);
  return { filename: `${slug}.md`, title: meta.title, tags: meta.tags, summary: meta.summary };
}

// Lista todos os arquivos do cérebro com metadados
function listBrainFiles() {
  ensureKnowledgeDir();
  const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8');
    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const tagsMatch = content.match(/^tags:\s*\[(.+)\]$/m);
    const sourceMatch = content.match(/^source:\s*(.+)$/m);
    const addedMatch = content.match(/^added:\s*(.+)$/m);
    const summaryMatch = content.match(/## Resumo\n([\s\S]*?)\n\n/);
    return {
      filename: f,
      title: titleMatch?.[1]?.trim() || f.replace('.md', ''),
      tags: tagsMatch?.[1]?.split(',').map(t => t.trim()) || [],
      source: sourceMatch?.[1]?.trim() || f,
      added: addedMatch?.[1]?.trim() || '',
      summary: summaryMatch?.[1]?.trim() || '',
    };
  });
}

// Deleta um arquivo do cérebro
function deleteBrainFile(filename) {
  const filePath = path.join(KNOWLEDGE_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[Brain] Arquivo removido: ${filename}`);
    return true;
  }
  return false;
}

const MEETINGS_DIR = path.join(process.cwd(), 'brain', 'meetings');

// Seleção inteligente: retorna contexto filtrando por keywords da conversa
function loadSmartContext(conversationKeywords = []) {
  ensureKnowledgeDir();
  const keywords = conversationKeywords.map(k => k.toLowerCase());
  let ctx = '';

  // Últimas 3 reuniões: sempre incluídas
  try {
    if (fs.existsSync(MEETINGS_DIR)) {
      const meetingFiles = fs.readdirSync(MEETINGS_DIR)
        .filter(f => f.endsWith('.md')).sort().slice(-3);
      if (meetingFiles.length > 0) {
        ctx += '\n\n=== REUNIÕES ANTERIORES (memória recente) ===\n';
        meetingFiles.forEach(f => {
          ctx += '\n' + fs.readFileSync(path.join(MEETINGS_DIR, f), 'utf-8') + '\n---';
        });
      }
    }
  } catch (e) { console.warn('[Brain] Reuniões:', e.message); }

  // Knowledge files: filtra por tags relevantes
  const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.md'));
  const alwaysInclude = ['professional_profile.md', 'learned_from_meetings.md'];

  files.forEach(f => {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8');
    const isAlways = alwaysInclude.includes(f);

    // Verifica se tags batem com keywords da conversa
    const tagsMatch = content.match(/^tags:\s*\[(.+)\]$/m);
    const tags = tagsMatch?.[1]?.split(',').map(t => t.trim().toLowerCase()) || [];
    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const title = titleMatch?.[1]?.toLowerCase() || '';

    const isRelevant = keywords.length === 0 || isAlways ||
      keywords.some(kw => tags.some(tag => tag.includes(kw) || kw.includes(tag)) || title.includes(kw));

    if (isRelevant) {
      const label = titleMatch?.[1]?.trim() || f.replace('.md', '').toUpperCase();
      // Remove frontmatter antes de incluir
      const bodyMatch = content.match(/---[\s\S]*?---\n([\s\S]*)/);
      const body = bodyMatch?.[1]?.trim() || content;
      ctx += `\n\n=== CONHECIMENTO: ${label} ===\n${body.slice(0, 3000)}`;
    }
  });

  return ctx.trim();
}

module.exports = { addFileToBrain, listBrainFiles, deleteBrainFile, loadSmartContext };
