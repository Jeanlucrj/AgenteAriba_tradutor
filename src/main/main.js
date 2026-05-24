const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente a partir do arquivo .env
dotenv.config();

const { translateText } = require('./translation');
const { analyzeConversation } = require('./ariba');
const { startMeeting, saveTurn, endMeeting, getMeetings, getTurns } = require('./database');
const { generateMeetingSummary, saveMeetingSummary, loadBrainContext, extractAndLearnKnowledge } = require('./brain');
const { addFileToBrain, listBrainFiles, deleteBrainFile, loadSmartContext } = require('./brainManager');

let cachedBrainContext = '';
const WebSocket = require('ws');

let mainWindow;
let deepgramSocket = null;
let keepAliveInterval = null;
let pendingDisplaySourceId = null;

function createOverlayWindow() {
  // Usa bounds (não workAreaSize) para funcionar corretamente em fullscreen (Teams/Meet/Zoom/YouTube)
  const { width, height } = screen.getPrimaryDisplay().bounds;

  const windowWidth = Math.floor(width * 0.85);
  const windowHeight = 200;
  const xPosition = Math.floor((width - windowWidth) / 2);
  const yPosition = height - windowHeight - 10;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: xPosition,
    y: yPosition,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    type: 'toolbar',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 'screen-saver' garante que o overlay apareça em cima de Teams, Zoom, Meet, YouTube fullscreen
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('set-pending-display-source', (_event, sourceId) => {
  pendingDisplaySourceId = sourceId;
});

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const source = pendingDisplaySourceId
        ? (sources.find(s => s.id === pendingDisplaySourceId) || sources.find(s => s.id.startsWith('screen:')) || sources[0])
        : (sources.find(s => s.id.startsWith('screen:')) || sources[0]);
      pendingDisplaySourceId = null;
      callback({ video: source, audio: 'loopback' });
    });
  });

  createOverlayWindow();
  cachedBrainContext = loadBrainContext();
  console.log(`[Brain] Contexto inicial: ${cachedBrainContext.length} caracteres`);

  // Diagnóstico de chaves de API no startup
  const deepLKey = process.env.DEEPL_API_KEY;
  if (deepLKey && !deepLKey.includes('your_')) {
    console.log(`[DeepL] Chave configurada — plano: ${deepLKey.endsWith(':fx') ? 'FREE (api-free.deepl.com)' : 'PRO (api.deepl.com)'}`);
  } else {
    console.warn('[DeepL] Chave NÃO configurada — traduções usarão Gemini');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Fontes de tela
ipcMain.handle('get-audio-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 1, height: 1 }
    });
    return sources.map(source => ({
      id: source.id,
      name: source.id.startsWith('screen:')
        ? `🔊 [Sistema] ${source.name} — Teams/Meet/Zoom/YouTube`
        : `🪟 [Janela] ${source.name}`
    }));
  } catch (error) {
    console.error('Erro ao buscar fontes:', error);
    throw error;
  }
});

// IPC: Tradução
ipcMain.handle('translate-text', async (event, text, targetLang, context = [], sourceLang = 'auto') => {
  try {
    const { text: translated, engine } = await translateText(text, targetLang, context, sourceLang);
    console.log(`[Tradução] ${engine}: "${text.slice(0, 50)}" → "${translated.slice(0, 50)}"`);
    return { text: translated, engine };
  } catch (error) {
    console.error('Erro de tradução:', error);
    return { text: `[Erro: ${error.message}]`, engine: 'error' };
  }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setIgnoreMouseEvents(ignore, options);
});

ipcMain.handle('get-deepgram-key', () => process.env.DEEPGRAM_API_KEY || '');
ipcMain.on('close-app', () => app.quit());

ipcMain.handle('analyze-ariba', async (_event, history, frames) => {
  // Extrai keywords da conversa para seleção inteligente de contexto
  const recentText = (history || []).slice(-8).join(' ');
  const keywords = recentText
    .split(/\s+/)
    .filter(w => w.length >= 5)
    .map(w => w.toLowerCase().replace(/[^a-záéíóúãõâêôçüà]/gi, ''));
  const smartCtx = loadSmartContext([...new Set(keywords)]);
  return await analyzeConversation(history, frames, smartCtx);
});

ipcMain.handle('brain-refresh-context', () => {
  cachedBrainContext = loadBrainContext();
  console.log(`[Brain] Contexto carregado: ${cachedBrainContext.length} caracteres`);
  return cachedBrainContext.length;
});

ipcMain.handle('brain-generate-summary', async (_event, turns, sourceLang, targetLang) => {
  try {
    const [summary] = await Promise.all([
      generateMeetingSummary(turns, sourceLang, targetLang),
      extractAndLearnKnowledge(turns).catch(e => console.warn('[Brain] Aprendizado:', e.message))
    ]);
    if (summary) {
      saveMeetingSummary(summary);
      cachedBrainContext = loadBrainContext();
      console.log('[Brain] Resumo gerado e contexto atualizado.');
    }
    return summary;
  } catch (e) {
    console.error('[Brain] Erro ao gerar resumo:', e.message);
    return null;
  }
});

ipcMain.handle('export-conversation', async (_event, meetingInfo, turns) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Exportar Conversa',
    defaultPath: `conversa_ariba_${meetingInfo.date.replace(/\//g, '-')}_${meetingInfo.time.replace(':', 'h')}.txt`,
    filters: [{ name: 'Texto', extensions: ['txt'] }]
  });
  if (canceled || !filePath) return { success: false };

  const lines = [
    'AGENTE ARIBA SENIOR — HISTÓRICO DE CONVERSA',
    '='.repeat(50),
    `Sessão: ${meetingInfo.date} às ${meetingInfo.time}`,
    `Duração: ${meetingInfo.duration}`,
    `Idioma: ${meetingInfo.sourceLang} → ${meetingInfo.targetLang}`,
    `Total de falas: ${meetingInfo.totalTurns} | Perguntas detectadas: ${meetingInfo.questions}`,
    '='.repeat(50),
    ''
  ];

  turns.forEach(t => {
    const time = t.created_at ? new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    if (t.is_question) {
      lines.push(`[${time}] ⚡ PERGUNTA DETECTADA`);
      lines.push(`  "${t.original_text}"`);
      if (t.suggested_response) {
        lines.push(`  Resposta (EN): ${t.suggested_response}`);
      }
      if (t.suggested_response_pt) {
        lines.push(`  Resposta (PT): ${t.suggested_response_pt}`);
      }
      if (t.key_points?.length) {
        lines.push(`  Tópicos: ${t.key_points.join(', ')}`);
      }
    } else {
      lines.push(`[${time}] ${t.original_text}`);
      if (t.translated_text) lines.push(`       > ${t.translated_text}`);
    }
    lines.push('');
  });

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return { success: true, filePath };
});

ipcMain.handle('db-start-meeting', async (_event, sourceLang, targetLang) => {
  return await startMeeting(sourceLang, targetLang);
});

ipcMain.handle('db-save-turn', async (_event, meetingId, turn) => {
  await saveTurn(meetingId, turn);
});

ipcMain.handle('db-end-meeting', async (_event, meetingId) => {
  await endMeeting(meetingId);
});

ipcMain.handle('db-get-meetings', async () => {
  return await getMeetings();
});

ipcMain.handle('db-get-turns', async (_event, meetingId) => {
  return await getTurns(meetingId);
});

// Brain Manager IPC
ipcMain.handle('brain-list-files', () => listBrainFiles());

ipcMain.handle('brain-add-file', async () => {
  const { filePath, canceled } = await dialog.showOpenDialog({
    title: 'Adicionar ao Cérebro',
    filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'txt', 'md'] }],
    properties: ['openFile']
  });
  if (canceled || !filePath?.[0]) return { canceled: true };
  try {
    const result = await addFileToBrain(filePath[0]);
    cachedBrainContext = loadBrainContext();
    return result;
  } catch (e) {
    console.error('[Brain] Erro ao adicionar arquivo:', e.message);
    return { error: e.message };
  }
});

ipcMain.handle('brain-delete-file', (_event, filename) => {
  const ok = deleteBrainFile(filename);
  if (ok) cachedBrainContext = loadBrainContext();
  return ok;
});

ipcMain.on('open-brain-window', () => {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
  const w = Math.min(900, sw - 80);
  const h = Math.min(700, sh - 80);
  const win = new BrowserWindow({
    width: w, height: h,
    x: Math.floor((sw - w) / 2), y: Math.floor((sh - h) / 2),
    title: 'Cérebro do Agente — Conhecimento',
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) win.loadURL('http://127.0.0.1:5173/#brain');
  else win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'), { hash: 'brain' });
});

ipcMain.on('open-history-window', () => {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
  const w = Math.min(1200, sw - 80);
  const h = Math.min(780, sh - 80);
  const win = new BrowserWindow({
    width: w, height: h,
    x: Math.floor((sw - w) / 2), y: Math.floor((sh - h) / 2),
    title: 'Histórico de Conversas — Agente Ariba',
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    win.loadURL('http://127.0.0.1:5173/#history');
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'), { hash: 'history' });
  }
});

ipcMain.on('set-window-height', (_event, height) => {
  if (!mainWindow) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
  const [currentWidth] = mainWindow.getSize();
  const safeHeight = Math.max(200, Math.min(height, sh - 20));
  mainWindow.setSize(currentWidth, safeHeight);
  mainWindow.setPosition(
    Math.floor((sw - currentWidth) / 2),
    sh - safeHeight - 10
  );
});
ipcMain.on('log-to-main', (event, type, text) => {
  console.log(`[Renderer ${type.toUpperCase()}] ${text}`);
});

ipcMain.on('move-window', (_event, dx, dy) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + Math.round(dx), y + Math.round(dy));
});

// ==========================================
// DEEPGRAM WEBSOCKET (RESTAURADO E CONFIGURADO COM URL DE AUTODETECÇÃO)
// ==========================================

function closeDeepgramSocket() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  if (deepgramSocket) {
    try {
      if (deepgramSocket.readyState === WebSocket.OPEN) deepgramSocket.close();
    } catch (e) {}
    deepgramSocket = null;
  }
}

ipcMain.handle('start-deepgram', async (_event, sourceLang = 'auto') => {
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  if (!deepgramKey || deepgramKey.includes('YOUR_DEEPGRAM_API_KEY')) {
    throw new Error('Chave do Deepgram não configurada no arquivo .env');
  }

  closeDeepgramSocket();

  return new Promise((resolve, reject) => {
    const lang = (sourceLang && sourceLang !== 'auto') ? sourceLang : 'en';
    // nova-2-meeting: otimizado para Teams/Zoom/Meet (múltiplos speakers, ruído de fundo)
    const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-2-meeting&language=${lang}&smart_format=true&punctuate=true&filler_words=false&endpointing=400&utterance_end_ms=1500&interim_results=true`;
    console.log(`Main: Conectando ao Deepgram... URL: ${wsUrl}`);

    deepgramSocket = new WebSocket(wsUrl, {
      headers: { 'Authorization': `Token ${deepgramKey}` }
    });

    deepgramSocket.on('open', () => {
      console.log('Main: ✅ Deepgram conectado com sucesso via Main Process!');
      keepAliveInterval = setInterval(() => {
        if (deepgramSocket && deepgramSocket.readyState === WebSocket.OPEN) {
          deepgramSocket.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 10000);
      resolve({ success: true });
    });

    deepgramSocket.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const transcript = parsed.channel?.alternatives?.[0]?.transcript;

        if (parsed.type === 'Results') {
          const lang = parsed.channel?.alternatives?.[0]?.languages?.[0] || parsed.detected_language || '';
          if (transcript && transcript.trim()) {
            console.log(`[Deepgram] ✅ TRANSCRIÇÃO: "${transcript}" | final: ${parsed.is_final} | lang: ${lang}`);
          } else {
            console.log(`[Deepgram] ⬜ Results vazio | final: ${parsed.is_final} | lang: ${lang}`);
          }
        } else {
          console.log(`[Deepgram] MSG tipo: ${parsed.type}`);
        }

        if (mainWindow) mainWindow.webContents.send('transcription-data', parsed);
      } catch (e) {
        console.error('Main: Erro ao processar mensagem:', e);
      }
    });

    deepgramSocket.on('error', (err) => {
      console.error('Main: Erro Deepgram:', err.message);
      if (mainWindow) mainWindow.webContents.send('deepgram-error', err.message);
      reject(err);
    });

    deepgramSocket.on('close', (code) => {
      console.log(`Main: Deepgram fechado. Código: ${code}`);
    });
  });
});

ipcMain.on('send-audio-chunk', (event, arrayBuffer) => {
  if (deepgramSocket && deepgramSocket.readyState === WebSocket.OPEN) {
    deepgramSocket.send(Buffer.from(arrayBuffer));
  }
});

ipcMain.handle('stop-deepgram', () => {
  closeDeepgramSocket();
  return { success: true };
});


