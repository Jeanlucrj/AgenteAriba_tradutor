#!/usr/bin/env node
/**
 * Comando: npm run brain:add
 * Processa arquivos em brain/inbox/ e adiciona ao cérebro do agente.
 *
 * Uso:
 *   npm run brain:add              → processa tudo em brain/inbox/
 *   npm run brain:add -- arquivo.pdf  → processa um arquivo específico
 *   npm run brain:list             → lista o que está no cérebro
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { addFileToBrain, listBrainFiles } = require('../src/main/brainManager');

const INBOX_DIR    = path.join(process.cwd(), 'brain', 'inbox');
const PROCESSED_DIR = path.join(process.cwd(), 'brain', 'processed');
const SUPPORTED    = ['.pdf', '.docx', '.txt', '.md'];

// Cores no terminal
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function log(msg)   { console.log(msg); }
function ok(msg)    { console.log(`${C.green}✅ ${msg}${C.reset}`); }
function warn(msg)  { console.log(`${C.yellow}⚠  ${msg}${C.reset}`); }
function err(msg)   { console.log(`${C.red}❌ ${msg}${C.reset}`); }
function info(msg)  { console.log(`${C.cyan}ℹ  ${msg}${C.reset}`); }
function dim(msg)   { console.log(`${C.gray}   ${msg}${C.reset}`); }

function ensureDirs() {
  [INBOX_DIR, PROCESSED_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

async function processFile(filePath) {
  const name = path.basename(filePath);
  const ext  = path.extname(name).toLowerCase();

  if (!SUPPORTED.includes(ext)) {
    warn(`Formato não suportado: ${name} (use PDF, DOCX, TXT ou MD)`);
    return false;
  }

  log(`\n${C.bold}Processando: ${name}${C.reset}`);
  info('Extraindo texto...');

  try {
    const result = await addFileToBrain(filePath);
    ok(`Adicionado ao cérebro: "${result.title}"`);
    dim(`Tags geradas: ${result.tags.slice(0, 6).join(', ')}`);
    dim(`Resumo: ${result.summary?.slice(0, 120)}...`);
    return true;
  } catch (e) {
    err(`Falha ao processar ${name}: ${e.message}`);
    return false;
  }
}

async function runInbox() {
  ensureDirs();
  const files = fs.readdirSync(INBOX_DIR)
    .filter(f => SUPPORTED.includes(path.extname(f).toLowerCase()));

  if (files.length === 0) {
    warn(`Nenhum arquivo encontrado em brain/inbox/`);
    info(`Coloque PDFs, DOCX ou TXT na pasta ${C.bold}brain/inbox/${C.reset}${C.cyan} e rode novamente.`);
    return;
  }

  log(`\n${C.bold}${C.cyan}🧠 Cérebro do Agente — Adicionando ${files.length} arquivo(s)${C.reset}`);
  log('─'.repeat(50));

  let success = 0, failed = 0;

  for (const file of files) {
    const src  = path.join(INBOX_DIR, file);
    const dest = path.join(PROCESSED_DIR, file);
    const ok_  = await processFile(src);

    if (ok_) {
      // Move para processed/ (adiciona timestamp se já existir)
      const finalDest = fs.existsSync(dest)
        ? path.join(PROCESSED_DIR, `${Date.now()}_${file}`)
        : dest;
      fs.renameSync(src, finalDest);
      dim(`Movido para brain/processed/`);
      success++;
    } else {
      failed++;
    }
  }

  log('\n' + '─'.repeat(50));
  log(`${C.bold}Resultado: ${C.green}${success} adicionado(s)${C.reset}` +
      (failed ? `  ${C.red}${failed} com falha${C.reset}` : ''));

  if (success > 0) {
    info('Reinicie o agente ou clique em Ligar Agente para carregar o novo conhecimento.');
  }
}

async function runSingleFile(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) { err(`Arquivo não encontrado: ${resolved}`); process.exit(1); }

  log(`\n${C.bold}${C.cyan}🧠 Adicionando ao Cérebro${C.reset}`);
  log('─'.repeat(50));
  const result = await processFile(resolved);
  if (result) info('Reinicie o agente para carregar o novo conhecimento.');
}

function runList() {
  const files = listBrainFiles();
  if (files.length === 0) {
    warn('Nenhum arquivo no cérebro ainda.');
    return;
  }
  log(`\n${C.bold}${C.cyan}🧠 Cérebro — ${files.length} arquivo(s) indexado(s)${C.reset}`);
  log('─'.repeat(50));
  files.forEach((f, i) => {
    log(`\n${C.bold}${i + 1}. ${f.title}${C.reset}`);
    if (f.source) dim(`Origem: ${f.source}`);
    if (f.added)  dim(`Adicionado: ${f.added}`);
    if (f.tags?.length) dim(`Tags: ${f.tags.join(', ')}`);
    if (f.summary) dim(`Resumo: ${f.summary.slice(0, 100)}...`);
  });
  log('\n' + '─'.repeat(50));
}

// ─── Entry point ───────────────────────────────────────────────
const arg = process.argv[2];

(async () => {
  try {
    if (arg === '--list' || arg === 'list') {
      runList();
    } else if (arg) {
      await runSingleFile(arg);
    } else {
      await runInbox();
    }
  } catch (e) {
    err(`Erro inesperado: ${e.message}`);
    process.exit(1);
  }
})();
