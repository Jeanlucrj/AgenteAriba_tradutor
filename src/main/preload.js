const { contextBridge, ipcRenderer } = require('electron');

console.log('--- PRELOAD SCRIPT INITIATED ---');

contextBridge.exposeInMainWorld('api', {
  getAudioSources: () => {
    console.log('getAudioSources called from preload');
    return ipcRenderer.invoke('get-audio-sources');
  },
  translateText: (text, targetLang, context) => ipcRenderer.invoke('translate-text', text, targetLang, context),
  setIgnoreMouse: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  getDeepgramKey: () => ipcRenderer.invoke('get-deepgram-key'),
  closeApp: () => ipcRenderer.send('close-app'),
  startDeepgram: (sourceLang) => ipcRenderer.invoke('start-deepgram', sourceLang),
  sendAudioChunk: (arrayBuffer) => ipcRenderer.send('send-audio-chunk', arrayBuffer),
  stopDeepgram: () => ipcRenderer.invoke('stop-deepgram'),
  onTranscription: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('transcription-data', handler);
    return () => ipcRenderer.off('transcription-data', handler);
  },
  onDeepgramError: (callback) => {
    const handler = (event, err) => callback(err);
    ipcRenderer.on('deepgram-error', handler);
    return () => ipcRenderer.off('deepgram-error', handler);
  },
  logToMain: (type, text) => ipcRenderer.send('log-to-main', type, text),
  setPendingDisplaySource: (sourceId) => ipcRenderer.send('set-pending-display-source', sourceId),
  analyzeAriba: (history) => ipcRenderer.invoke('analyze-ariba', history),
  setWindowHeight: (height) => ipcRenderer.send('set-window-height', height)
});
