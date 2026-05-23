const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } = require('electron');
const path = require('path');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente a partir do arquivo .env
dotenv.config();

const { translateText } = require('./translation');
const { analyzeConversation } = require('./ariba');
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
ipcMain.handle('translate-text', async (event, text, targetLang, context = []) => {
  try {
    const result = await translateText(text, targetLang, context);
    console.log(`[Tradução] "${text}" → "${result}"`);
    return result;
  } catch (error) {
    console.error('Erro de tradução:', error);
    return `[Erro: ${error.message}]`;
  }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setIgnoreMouseEvents(ignore, options);
});

ipcMain.handle('get-deepgram-key', () => process.env.DEEPGRAM_API_KEY || '');
ipcMain.on('close-app', () => app.quit());

ipcMain.handle('analyze-ariba', async (_event, history) => {
  return await analyzeConversation(history);
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


