const { contextBridge, ipcRenderer } = require('electron');

console.log('--- PRELOAD SCRIPT INITIATED ---');

contextBridge.exposeInMainWorld('api', {
  getAudioSources: () => {
    console.log('getAudioSources called from preload');
    return ipcRenderer.invoke('get-audio-sources');
  },
  translateText: (text, targetLang, context) => ipcRenderer.invoke('translate-text', text, targetLang, context),
  setIgnoreMouse: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
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
  analyzeAriba: (history, frameBase64) => ipcRenderer.invoke('analyze-ariba', history, frameBase64),
  setWindowHeight: (height) => ipcRenderer.send('set-window-height', height),
  dbStartMeeting: (sourceLang, targetLang) => ipcRenderer.invoke('db-start-meeting', sourceLang, targetLang),
  dbSaveTurn: (meetingId, turn) => ipcRenderer.invoke('db-save-turn', meetingId, turn),
  dbEndMeeting: (meetingId) => ipcRenderer.invoke('db-end-meeting', meetingId),
  dbGetMeetings: () => ipcRenderer.invoke('db-get-meetings'),
  dbGetTurns: (meetingId) => ipcRenderer.invoke('db-get-turns', meetingId),
  openHistory: () => ipcRenderer.send('open-history-window'),
  openBrain: () => ipcRenderer.send('open-brain-window'),
  brainRefreshContext: () => ipcRenderer.invoke('brain-refresh-context'),
  brainGenerateSummary: (turns, sourceLang, targetLang) => ipcRenderer.invoke('brain-generate-summary', turns, sourceLang, targetLang),
  exportConversation: (meetingInfo, turns) => ipcRenderer.invoke('export-conversation', meetingInfo, turns),
  brainListFiles: () => ipcRenderer.invoke('brain-list-files'),
  brainAddFile: () => ipcRenderer.invoke('brain-add-file'),
  brainDeleteFile: (filename) => ipcRenderer.invoke('brain-delete-file', filename)
});
