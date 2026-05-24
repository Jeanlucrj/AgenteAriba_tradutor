import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function App() {
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState('');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('Português');
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('disconnected');
  const [errorMsg, setErrorMsg] = useState('');

  const [currentTranscript, setCurrentTranscript] = useState('');
  const [finalTranslation, setFinalTranslation] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [interimTranslation, setInterimTranslation] = useState('');

  const lastInterimTranslateTimeRef = useRef(0);
  const isTranslatingInterimRef = useRef(false);
  const translationCacheRef = useRef(new Map());
  const contextWindowRef = useRef([]); // últimas 3 traduções finais para contexto do Gemini

  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const videoStreamRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const websocketRef = useRef(null);
  const clearSubtitleTimeoutRef = useRef(null);
  const unsubscribeTranscriptionRef = useRef(null);
  const unsubscribeErrorRef = useRef(null);
  const audioContextRef = useRef(null);
  const volIntervalRef = useRef(null);
  const isRecordingRef = useRef(false);
  const startRecordingRef = useRef(null);
  const [audioVolume, setAudioVolume] = useState(0);
  const [chunksSent, setChunksSent] = useState(0);
  const [deepgramStats, setDeepgramStats] = useState({ results: 0, nonEmpty: 0, lastText: '' });
  const [isTesting, setIsTesting] = useState(false);
  const [translatorEngine, setTranslatorEngine] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [aribaAnalysis, setAribaAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const conversationHistoryRef = useRef([]);
  const isPanelOpenRef = useRef(false);
  const analysisDebounceRef = useRef(null);
  const meetingIdRef = useRef(null);
  const frameBufferRef = useRef([]);
  const frameBufferIntervalRef = useRef(null);
  const dragStartRef = useRef(null);

  // Bridge de log para o terminal do Electron
  useEffect(() => {
    if (window.api && window.api.logToMain) {
      const originalLog = console.log;
      console.log = (...args) => {
        originalLog(...args);
        window.api.logToMain('log', args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '));
      };
      const originalError = console.error;
      console.error = (...args) => {
        originalError(...args);
        window.api.logToMain('error', args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '));
      };
      console.log('Renderer: Bridge de log iniciada!');
    }
  }, []);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isPanelOpenRef.current = isPanelOpen; }, [isPanelOpen]);

  // Captura um frame da tela atual (via stream de vídeo já ativo) para contexto visual
  const captureScreenFrame = useCallback(() => {
    const video = hiddenVideoRef.current;
    if (!video || !video.videoWidth || !videoStreamRef.current) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = Math.floor(video.videoWidth  * 0.5);
      canvas.height = Math.floor(video.videoHeight * 0.5);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.65).split(',')[1]; // base64 sem prefixo
    } catch (e) {
      console.warn('Falha ao capturar frame da tela:', e.message);
      return null;
    }
  }, []);

  const triggerAnalysis = useCallback((history) => {
    if (analysisDebounceRef.current) clearTimeout(analysisDebounceRef.current);
    analysisDebounceRef.current = setTimeout(async () => {
      if (!isPanelOpenRef.current || history.length === 0) return;
      setIsAnalyzing(true);
      // Captura frame atual + buffer dos últimos 15-45s (contexto temporal para slides/vídeos)
      const currentFrame = captureScreenFrame();
      const frames = currentFrame
        ? [...frameBufferRef.current, currentFrame].slice(-4)
        : [...frameBufferRef.current];
      if (frames.length > 0) console.log(`📸 ${frames.length} frame(s) capturados para contexto Ariba`);
      try {
        const result = await window.api.analyzeAriba(history, frames);
        if (result) {
          setAribaAnalysis(result);
          if (result.isQuestion && meetingIdRef.current) {
            window.api.dbSaveTurn(meetingIdRef.current, {
              originalText: result.question || history[history.length - 1] || '',
              translatedText: null,
              isQuestion: true,
              suggestedResponse: result.suggestedResponse || null,
              suggestedResponsePT: result.suggestedResponsePT || null,
              keyPoints: result.keyPoints || [],
            }).catch(e => console.error('[DB] Falha ao salvar análise:', e.message));
          }
        }
      } catch (e) {
        console.error('Erro análise Ariba:', e.message);
      } finally {
        setIsAnalyzing(false);
      }
    }, 2000);
  }, [captureScreenFrame]);

  // Inicializa (ou reinicializa) o analisador de volume em tempo real
  const initVolumeAnalyzer = useCallback((audioStream) => {
    if (volIntervalRef.current) { clearInterval(volIntervalRef.current); volIntervalRef.current = null; }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      const src = audioContext.createMediaStreamSource(audioStream);
      src.connect(analyser);
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      volIntervalRef.current = setInterval(() => {
        if (audioContext.state === 'suspended') audioContext.resume();
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / bufferLength);
        setAudioVolume(Math.min(Math.round(rms * 600), 100));
      }, 200);
    } catch (e) {
      console.warn('Analisador de áudio falhou:', e.message);
    }
  }, []);

  // Ao trocar dispositivo de áudio (ex: plugar/despluguar fone), reinicia a captura inteira.
  // Necessário porque o WASAPI loopback fica preso no dispositivo antigo (speakers) quando o
  // Windows troca o padrão para headphones — resultando em chunks de silêncio ao Deepgram.
  useEffect(() => {
    const handleDeviceChange = async () => {
      if (!isRecordingRef.current) return;
      console.log('Dispositivo de áudio alterado — aguardando OS finalizar troca...');
      await new Promise(r => setTimeout(r, 1200));
      if (!isRecordingRef.current || !startRecordingRef.current) return;
      console.log('Reiniciando captura para rebind WASAPI ao novo dispositivo...');
      await startRecordingRef.current();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, []);

  // Carrega fontes de áudio: microfones + fontes de tela (desktopCapturer)
  const fetchSources = async () => {
    try {
      if (!window.api) throw new Error('window.api undefined');

      // Microfones físicos
      let micSources = [];
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        micSources = devices
          .filter(d => d.kind === 'audioinput')
          .map(d => ({ id: `mic:${d.deviceId}`, name: `🎙️ ${d.label || 'Microfone'}` }));
      } catch (e) {
        console.warn('Microfone não acessível:', e.message);
      }

      // Fontes de tela/janela via desktopCapturer (capturam áudio do sistema no Windows)
      const screenSources = await window.api.getAudioSources();

      // Telas primeiro (capturam áudio do sistema), depois microfones, depois janelas
      const screens = screenSources.filter(s => s.id.startsWith('screen:'));
      const windows = screenSources.filter(s => !s.id.startsWith('screen:'));
      const allSources = [...screens, ...micSources, ...windows];

      setSources(allSources);

      // Padrão: primeira tela (captura áudio do sistema automaticamente no Windows)
      if (!selectedSource && screens.length > 0) {
        setSelectedSource(screens[0].id);
      } else if (!selectedSource && allSources.length > 0) {
        setSelectedSource(allSources[0].id);
      }
    } catch (err) {
      console.error('Erro ao buscar fontes:', err.message);
      setErrorMsg(`Erro: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchSources();
    const interval = setInterval(() => { if (!isRecording) fetchSources(); }, 5000);
    return () => clearInterval(interval);
  }, [isRecording]);

  useEffect(() => {
    return () => { cleanupStreams(); };
  }, []);

  const resetSubtitleTimer = () => {
    if (clearSubtitleTimeoutRef.current) clearTimeout(clearSubtitleTimeoutRef.current);
    clearSubtitleTimeoutRef.current = setTimeout(() => {
      setFinalTranslation('');
      setOriginalText('');
      setInterimTranslation('');
      setCurrentTranscript('');
    }, 5000);
  };

  const cleanupStreams = async () => {
    if (clearSubtitleTimeoutRef.current) clearTimeout(clearSubtitleTimeoutRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }
    if (hiddenVideoRef.current) hiddenVideoRef.current.srcObject = null;
    if (volIntervalRef.current) { clearInterval(volIntervalRef.current); volIntervalRef.current = null; }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    if (unsubscribeTranscriptionRef.current) { unsubscribeTranscriptionRef.current(); unsubscribeTranscriptionRef.current = null; }
    if (unsubscribeErrorRef.current) { unsubscribeErrorRef.current(); unsubscribeErrorRef.current = null; }
    if (frameBufferIntervalRef.current) { clearInterval(frameBufferIntervalRef.current); frameBufferIntervalRef.current = null; }
    frameBufferRef.current = [];
    await window.api.stopDeepgram();

    setChunksSent(0);
    setInterimTranslation('');
    setDeepgramStats({ results: 0, nonEmpty: 0, lastText: '' });
    contextWindowRef.current = [];
    conversationHistoryRef.current = [];
    setAribaAnalysis(null);
    if (analysisDebounceRef.current) { clearTimeout(analysisDebounceRef.current); analysisDebounceRef.current = null; }
  };

  const startRecording = async () => {
    if (!selectedSource) { setErrorMsg('Selecione uma fonte de áudio.'); return; }

    await cleanupStreams();
    setStatus('connecting');
    setErrorMsg('');

    try {
      const deepgramKey = await window.api.getDeepgramKey();
      if (!deepgramKey || deepgramKey.includes('YOUR_DEEPGRAM_API_KEY')) {
        throw new Error('Configure sua chave Deepgram no .env');
      }

      // Captura do stream de áudio
      let stream;
      const isMic = selectedSource.startsWith('mic:');

      if (isMic) {
        // Microfone físico
        const deviceId = selectedSource.replace('mic:', '');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
        console.log('Captura: microfone iniciada.');
      } else {
        // Tela/Janela via getDisplayMedia + setDisplayMediaRequestHandler no main process
        // O handler no main process usa audio: 'loopback' (WASAPI) — captura áudio do sistema no Windows
        window.api.setPendingDisplaySource(selectedSource);
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });

        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        console.log(`Captura desktop: ${audioTracks.length} trilha(s) de áudio, ${videoTracks.length} de vídeo.`);
        audioTracks.forEach(t => console.log(`  Áudio: ${t.label} | estado: ${t.readyState}`));

        if (audioTracks.length === 0) {
          throw new Error('Nenhuma trilha de áudio capturada. Verifique se a fonte de tela está correta.');
        }

        // Mantém o stream de vídeo vivo para não congelar o áudio no Windows (bug do Chromium)
        videoStreamRef.current = stream;
        if (hiddenVideoRef.current) {
          hiddenVideoRef.current.srcObject = stream;
          hiddenVideoRef.current.play().catch(e => console.warn('Vídeo oculto:', e.message));
        }

        // Buffer silencioso: captura 1 frame a cada 15s para contexto temporal (slides/vídeos)
        // Não chama Gemini — apenas guarda em memória até a próxima análise ser disparada
        frameBufferIntervalRef.current = setInterval(() => {
          const f = captureScreenFrame();
          if (f) frameBufferRef.current = [...frameBufferRef.current, f].slice(-3);
        }, 15000);
      }

      // Conecta ao Deepgram via IPC do Main Process (servidor seguro Node)
      await window.api.startDeepgram(sourceLang);
      setStatus('listening');
      setIsRecording(true);

      // Inicia sessão no banco de dados (fire-and-forget, não bloqueia)
      window.api.dbStartMeeting(sourceLang, targetLang)
        .then(id => { meetingIdRef.current = id; })
        .catch(e => console.error('[DB] Falha ao iniciar sessão:', e.message));

      // Carrega cérebro do agente — memória das reuniões anteriores
      window.api.brainRefreshContext()
        .then(size => console.log(`[Brain] ${size} caracteres carregados no contexto`))
        .catch(e => console.error('[Brain] Falha ao carregar contexto:', e.message));

      // Ouvinte de eventos de transcrição recebidos do Main
      unsubscribeTranscriptionRef.current = window.api.onTranscription(async (data) => {
        try {
          // Rastreia stats para debug (antes de qualquer return)
          if (data.type === 'Results') {
            const t = data.channel?.alternatives?.[0]?.transcript ?? '';
            setDeepgramStats(prev => ({
              results: prev.results + 1,
              nonEmpty: t.trim() ? prev.nonEmpty + 1 : prev.nonEmpty,
              lastText: t.trim() ? t : prev.lastText,
            }));
          }

          const channel = data.channel;
          if (!channel) return;
          const transcript = channel.alternatives[0].transcript;
          const isFinal = data.is_final;

          if (transcript && transcript.trim()) {
            const cacheKey = `${transcript}::${targetLang}`;

            const setCache = (text, lang, val) => {
              const k = `${text}::${lang}`;
              translationCacheRef.current.set(k, val);
              if (translationCacheRef.current.size > 60) {
                translationCacheRef.current.delete(translationCacheRef.current.keys().next().value);
              }
            };

            if (isFinal) {
              setCurrentTranscript('');
              setInterimTranslation('');
              setOriginalText(transcript);
              resetSubtitleTimer();
              const cached = translationCacheRef.current.get(cacheKey);
              if (cached) {
                setFinalTranslation(cached);
                resetSubtitleTimer();
              } else {
                try {
                  const res = await window.api.translateText(transcript, targetLang, contextWindowRef.current, sourceLang);
                  const translated = res?.text ?? res;
                  if (res?.engine) setTranslatorEngine(res.engine);
                  setCache(transcript, targetLang, translated);
                  setFinalTranslation(translated);
                  contextWindowRef.current = [...contextWindowRef.current, translated].slice(-3);
                  const updatedHistory = [...conversationHistoryRef.current, transcript].slice(-20);
                  conversationHistoryRef.current = updatedHistory;
                  triggerAnalysis(updatedHistory);
                  // Salva turno no banco (fire-and-forget)
                  if (meetingIdRef.current) {
                    window.api.dbSaveTurn(meetingIdRef.current, {
                      originalText: transcript,
                      translatedText: translated,
                      isQuestion: false,
                      suggestedResponse: null,
                      suggestedResponsePT: null,
                      keyPoints: [],
                    }).catch(e => console.error('[DB] Falha ao salvar turno:', e.message));
                  }
                  resetSubtitleTimer();
                } catch (te) {
                  console.error('Erro na tradução final:', te.message);
                }
              }
            } else {
              setCurrentTranscript(transcript);
              resetSubtitleTimer();
              const now = Date.now();
              // Throttle reduzido: 300ms (era 800ms)
              if (now - lastInterimTranslateTimeRef.current > 300 && !isTranslatingInterimRef.current) {
                const cached = translationCacheRef.current.get(cacheKey);
                if (cached) {
                  setInterimTranslation(cached);
                  lastInterimTranslateTimeRef.current = now;
                } else {
                  isTranslatingInterimRef.current = true;
                  lastInterimTranslateTimeRef.current = now;
                  window.api.translateText(transcript, targetLang, contextWindowRef.current, sourceLang)
                    .then(r => { const t = r?.text ?? r; if (r?.engine) setTranslatorEngine(r.engine); setCache(transcript, targetLang, t); setInterimTranslation(t); })
                    .catch(e => console.error('Erro tradução interim:', e.message))
                    .finally(() => { isTranslatingInterimRef.current = false; });
                }
              }
            }
          }
        } catch (e) {
          console.error('Erro ao processar transcrição:', e.message);
        }
      });

      unsubscribeErrorRef.current = window.api.onDeepgramError(async (err) => {
        console.error('Erro Deepgram via IPC:', err);
        setStatus('error');
        setErrorMsg(`Falha Deepgram: ${err}`);
        await cleanupStreams();
        setIsRecording(false);
      });

      // Extrai apenas as trilhas de áudio para o MediaRecorder
      const audioTracks = stream.getAudioTracks();
      const audioStream = new MediaStream(audioTracks);
      audioStreamRef.current = audioStream;

      // Analisador de volume em tempo real
      initVolumeAnalyzer(audioStream);

      // Configura o MediaRecorder (webm/opus — aceito pelo Deepgram sem encoding explícito)
      let options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'audio/webm' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) options = {};

      console.log('MediaRecorder: iniciando com opções:', JSON.stringify(options));
      const recorder = new MediaRecorder(audioStream, options);
      mediaRecorderRef.current = recorder;

      recorder.onstart = () => console.log('MediaRecorder: gravando!');
      recorder.onerror = (e) => { console.error('MediaRecorder erro:', e.error?.message); setErrorMsg(`Erro gravador: ${e.error?.message}`); };
      recorder.onstop = () => console.log('MediaRecorder: parado.');

      recorder.ondataavailable = async (event) => {
        try {
          if (event.data.size > 0) {
            const arrayBuffer = await event.data.arrayBuffer();
            window.api.sendAudioChunk(arrayBuffer); // Envia o ArrayBuffer via IPC para o Main Process!
            setChunksSent(prev => prev + 1);
          }
        } catch (err) {
          console.error('Erro ondataavailable:', err.message);
        }
      };

      recorder.start(250); // chunks a cada 250ms

    } catch (err) {
      console.error('Erro ao iniciar:', err.message);
      setStatus('error');
      setErrorMsg(err.message || 'Erro inesperado');
      await cleanupStreams();
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    const closingMeetingId = meetingIdRef.current;
    if (closingMeetingId) {
      window.api.dbEndMeeting(closingMeetingId)
        .catch(e => console.error('[DB] Falha ao encerrar sessão:', e.message));

      // Gera resumo da reunião e salva no cérebro do agente
      window.api.dbGetTurns(closingMeetingId).then(turns => {
        if (turns && turns.length > 0) {
          console.log(`[Brain] Gerando resumo de ${turns.length} turnos...`);
          return window.api.brainGenerateSummary(turns, sourceLang, targetLang);
        }
      }).then(summary => {
        if (summary) console.log('[Brain] Resumo salvo com sucesso.');
      }).catch(e => console.error('[Brain] Falha ao gerar resumo:', e.message));

      meetingIdRef.current = null;
    }
    await cleanupStreams();
    setStatus('disconnected');
    setIsRecording(false);
    if (isPanelOpenRef.current) {
      setIsPanelOpen(false);
      isPanelOpenRef.current = false;
      window.api.setWindowHeight(200);
    }
  };

  const togglePanel = () => {
    const newOpen = !isPanelOpen;
    setIsPanelOpen(newOpen);
    isPanelOpenRef.current = newOpen;
    window.api.setWindowHeight(newOpen ? 380 : 200);
    if (newOpen && conversationHistoryRef.current.length > 0) {
      triggerAnalysis(conversationHistoryRef.current);
    }
  };

  const testTranslation = async () => {
    setIsTesting(true);
    setErrorMsg('');
    const testPhrase = 'Hello everyone, welcome to the meeting. How are you doing today?';
    setOriginalText(testPhrase);
    setFinalTranslation('');
    try {
      // Testa DeepL primeiro diretamente
      const deepLResult = await window.api.testDeepL();
      if (deepLResult.ok) {
        setTranslatorEngine('DeepL');
        setFinalTranslation(`[DeepL ${deepLResult.plan}] ${deepLResult.translated}`);
      } else {
        setErrorMsg(`DeepL: ${deepLResult.error}`);
        // Tenta Gemini como fallback
        const res = await window.api.translateText(testPhrase, targetLang);
        const translated = res?.text ?? res;
        if (res?.engine) setTranslatorEngine(res.engine);
        setFinalTranslation(translated);
      }
      resetSubtitleTimer();
    } catch (e) {
      setErrorMsg(`Teste falhou: ${e.message}`);
      setOriginalText('');
    } finally {
      setIsTesting(false);
    }
  };

  // Mantém ref sempre com a versão mais recente de startRecording (sem deps stale no devicechange)
  useEffect(() => { startRecordingRef.current = startRecording; });

  // Cor do indicador de volume
  const volumeColor = audioVolume > 10 ? 'bg-emerald-400' : audioVolume > 2 ? 'bg-amber-400' : 'bg-rose-500';
  const isMicSource = selectedSource?.startsWith('mic:');
  // Só avisa se volume zero E Deepgram não está recebendo fala (evita falso positivo ao trocar fone)
  const hasNoAudio = isRecording && audioVolume < 2 && deepgramStats.nonEmpty === 0;

  // Legenda: sempre UMA frase — interim tem prioridade sobre final
  const displayTranslation = interimTranslation || finalTranslation;
  const displayOriginal = currentTranscript || originalText;
  const isInterim = !!interimTranslation;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none font-sans bg-transparent">
      {/* Painel de Controle */}
      <div
        className="flex items-center justify-between mx-auto my-3 px-5 py-2.5 w-[96%] rounded-full bg-slate-900/90 border border-slate-700/50 backdrop-blur-md shadow-2xl transition-all duration-300 pointer-events-auto"
        onMouseEnter={() => window.api.setIgnoreMouse(false)}
        onMouseLeave={() => window.api.setIgnoreMouse(true, { forward: true })}
      >
        <div className="flex items-center gap-3">
          {/* Grip de arrastar */}
          <div
            className="flex items-center justify-center w-5 h-7 text-slate-600 hover:text-slate-300 flex-shrink-0 -ml-1 cursor-grab active:cursor-grabbing select-none"
            title="Arrastar para mover o overlay"
            onMouseEnter={() => window.api.setIgnoreMouse(false)}
            onMouseDown={(e) => {
              e.preventDefault();
              window.api.setIgnoreMouse(false);
              dragStartRef.current = { x: e.screenX, y: e.screenY };
              const cleanup = () => {
                dragStartRef.current = null;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              const onMove = (ev) => {
                // Se botão foi solto fora da janela, ev.buttons === 0 — limpa sem travar
                if (ev.buttons === 0) { cleanup(); return; }
                if (!dragStartRef.current) return;
                const dx = ev.screenX - dragStartRef.current.x;
                const dy = ev.screenY - dragStartRef.current.y;
                dragStartRef.current = { x: ev.screenX, y: ev.screenY };
                window.api.moveWindow(dx, dy);
              };
              const onUp = () => cleanup();
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          >
            <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
              <circle cx="2" cy="2"  r="1.3"/><circle cx="6" cy="2"  r="1.3"/>
              <circle cx="2" cy="6"  r="1.3"/><circle cx="6" cy="6"  r="1.3"/>
              <circle cx="2" cy="10" r="1.3"/><circle cx="6" cy="10" r="1.3"/>
              <circle cx="2" cy="14" r="1.3"/><circle cx="6" cy="14" r="1.3"/>
            </svg>
          </div>

          {/* Status dot */}
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                status === 'listening' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-slate-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-3 w-3 ${
                status === 'listening' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-slate-500'
              }`} />
            </span>
            <span className="text-xs font-semibold tracking-wider text-slate-300 uppercase flex items-center gap-1.5">
              Overlay Tradutor
              {isRecording && (
                <span className="text-[10px] text-emerald-400 font-mono normal-case bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-800/30">
                  {chunksSent} chunks
                </span>
              )}
            </span>
          </div>

          {/* Barra de Volume em Tempo Real */}
          {isRecording && (
            <div className="flex items-center gap-1.5" title={`Volume: ${audioVolume}%`}>
              <span className="text-[9px] text-slate-500 uppercase font-bold">Vol</span>
              <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${volumeColor}`}
                  style={{ width: `${audioVolume}%` }}
                />
              </div>
              <span className={`text-[9px] font-mono font-bold ${audioVolume > 5 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {audioVolume}%
              </span>
            </div>
          )}

          <div className="h-4 w-[1px] bg-slate-700" />

          {/* Fonte de Áudio */}
          <div className="flex items-center gap-1.5" title="🔊 [Sistema] captura TODO áudio do sistema — Teams, Meet, Zoom, YouTube, etc.">
            <label className="text-[10px] uppercase font-bold text-slate-400">Áudio:</label>
            <select
              className="px-2.5 py-1 text-xs rounded bg-slate-800 text-slate-200 border border-slate-700 focus:outline-none focus:border-emerald-500 max-w-[220px] truncate"
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              disabled={isRecording}
            >
              {sources.map(src => (
                <option key={src.id} value={src.id}>{src.name}</option>
              ))}
            </select>
          </div>

          {/* Idioma de Origem */}
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-400">De:</label>
            <select
              className="px-2.5 py-1 text-xs rounded bg-slate-800 text-slate-200 border border-slate-700 focus:outline-none focus:border-emerald-500 cursor-pointer"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              disabled={isRecording}
            >
              <option value="auto">🌐 Auto (EN)</option>
              <option value="pt">🇧🇷 Português</option>
              <option value="en">🇺🇸 English</option>
              <option value="es">🇪🇸 Español</option>
              <option value="fr">🇫🇷 Français</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="it">🇮🇹 Italiano</option>
              <option value="zh">🇨🇳 中文</option>
              <option value="ja">🇯🇵 日本語</option>
            </select>
          </div>

          {/* Idioma */}
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-400">Para:</label>
            <select
              className="px-2.5 py-1 text-xs rounded bg-slate-800 text-slate-200 border border-slate-700 focus:outline-none focus:border-emerald-500 cursor-pointer"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
            >
              <option value="Português">🇧🇷 Português</option>
              <option value="English">🇺🇸 English</option>
              <option value="Español">🇪🇸 Español</option>
              <option value="French">🇫🇷 Français</option>
              <option value="German">🇩🇪 Deutsch</option>
              <option value="Italian">🇮🇹 Italiano</option>
            </select>
          </div>
        </div>

        {/* Botões */}
        <div className="flex items-center gap-3">
          {errorMsg && (
            <span className="text-xs text-rose-400 font-medium truncate max-w-[200px] animate-pulse">
              {errorMsg}
            </span>
          )}
          <button
            onClick={() => window.api.openHistory()}
            title="Ver histórico de conversas"
            className="px-3 py-1 text-[10px] font-bold rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-all cursor-pointer"
          >
            📋 Histórico
          </button>
          <button
            onClick={togglePanel}
            disabled={!isRecording}
            title="Painel Consultor Ariba Senior — análise e sugestões em tempo real"
            className={`px-3 py-1 text-[10px] font-bold rounded-full transition-all cursor-pointer disabled:opacity-30 ${
              isPanelOpen
                ? 'bg-emerald-800 hover:bg-emerald-700 text-emerald-200 border border-emerald-600/50'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
            }`}
          >
            🏢 Ariba
          </button>
          <button
            onClick={testTranslation}
            disabled={isTesting}
            title="Testa a tradução com frase em inglês — bypassa o microfone"
            className="px-3 py-1 text-[10px] font-bold rounded-full bg-blue-800 hover:bg-blue-700 text-blue-200 hover:text-white transition-all cursor-pointer disabled:opacity-50"
          >
            {isTesting ? '⏳' : '🧪 Testar'}
          </button>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`px-5 py-1 text-xs font-bold rounded-full transition-all duration-300 shadow-md cursor-pointer ${
              isRecording
                ? 'bg-rose-600 hover:bg-rose-500 text-white hover:scale-105'
                : status === 'connecting'
                ? 'bg-amber-600 text-white cursor-wait'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white hover:scale-105'
            }`}
            disabled={status === 'connecting'}
          >
            {isRecording ? 'Desligar Agente' : status === 'connecting' ? 'Iniciando...' : 'Ligar Agente'}
          </button>
          <button
            onClick={() => window.api.closeApp()}
            className="flex items-center justify-center h-6 w-6 rounded-full bg-slate-800 hover:bg-rose-600/30 border border-slate-700 hover:border-rose-500 text-slate-400 hover:text-rose-400 transition-all duration-300 shadow cursor-pointer text-[10px] font-bold"
            title="Fechar"
          >✕</button>
        </div>
      </div>

      {/* Debug bar: visível enquanto gravando */}
      {isRecording && (
        <div
          className="mx-auto mt-0 mb-1 px-4 py-1 rounded-full bg-slate-900/70 border border-slate-700/20 text-[10px] font-mono text-slate-400 max-w-[96%] truncate pointer-events-none"
        >
          Deepgram:{' '}
          <span className={deepgramStats.results > 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {deepgramStats.results} resultados
          </span>
          {' '}•{' '}
          <span className={deepgramStats.nonEmpty > 0 ? 'text-emerald-400' : 'text-slate-500'}>
            {deepgramStats.nonEmpty} com fala
          </span>
          {translatorEngine && (
            <>
              {' '}•{' '}
              <span className={translatorEngine === 'DeepL' ? 'text-blue-400 font-bold' : 'text-amber-400'}>
                {translatorEngine === 'DeepL' ? '⚡ DeepL' : '✦ Gemini'}
              </span>
            </>
          )}
          {deepgramStats.lastText ? (
            <> • último: "<span className="text-amber-300">{deepgramStats.lastText.slice(0, 80)}</span>"</>
          ) : deepgramStats.results > 5 ? (
            <span className="text-rose-400"> • ⚠ sem fala — música não funciona; use em reuniões (Teams/Meet/Zoom) ou vídeos com fala</span>
          ) : null}
        </div>
      )}

      {/* Painel Consultor Ariba Senior */}
      {isPanelOpen && isRecording && (
        <div
          className="mx-auto mb-2 w-[96%] rounded-2xl bg-slate-900/95 border border-emerald-800/40 backdrop-blur-md shadow-2xl pointer-events-auto overflow-hidden"
          onMouseEnter={() => window.api.setIgnoreMouse(false)}
          onMouseLeave={() => window.api.setIgnoreMouse(true, { forward: true })}
        >
          <div className="px-5 pt-3 pb-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-400 tracking-wide">🏢 Consultor Ariba Senior</span>
                {isAnalyzing && (
                  <span className="text-[10px] text-amber-400 animate-pulse font-mono">analisando...</span>
                )}
              </div>
              {aribaAnalysis?.context && (
                <span className="text-[10px] text-slate-400 italic truncate max-w-[55%]">{aribaAnalysis.context}</span>
              )}
            </div>

            {/* Pergunta detectada + resposta sugerida */}
            {aribaAnalysis?.isQuestion && aribaAnalysis?.suggestedResponse ? (
              <div className="mb-3 p-3 rounded-xl bg-emerald-950/70 border border-emerald-500/40">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">⚡ Pergunta para você</span>
                  {aribaAnalysis.question && (
                    <span className="text-[10px] text-slate-400 italic truncate max-w-[70%]">"{aribaAnalysis.question}"</span>
                  )}
                </div>
                <p className="text-sm text-white leading-relaxed font-medium select-text">
                  {aribaAnalysis.suggestedResponse}
                </p>
                {aribaAnalysis.suggestedResponsePT && (
                  <p className="mt-2 text-xs text-emerald-300/70 leading-relaxed italic select-text border-t border-emerald-800/40 pt-2">
                    🇧🇷 {aribaAnalysis.suggestedResponsePT}
                  </p>
                )}
              </div>
            ) : aribaAnalysis && !isAnalyzing ? (
              <div className="mb-3 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700/30">
                <p className="text-xs text-slate-400 italic">Nenhuma pergunta direta detectada — ouvindo a conversa...</p>
              </div>
            ) : !aribaAnalysis && !isAnalyzing ? (
              <div className="mb-3 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700/30">
                <p className="text-xs text-slate-500 italic">Aguardando fala para iniciar análise...</p>
              </div>
            ) : null}

            {/* Tópicos-chave */}
            {aribaAnalysis?.keyPoints?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {aribaAnalysis.keyPoints.map((kp, i) => (
                  <span key={i} className="px-2 py-0.5 text-[10px] rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 select-text">
                    📌 {kp}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Aviso: sem áudio detectado */}
      {hasNoAudio && !isMicSource && (
        <div className="mx-auto px-5 py-2 w-[92%] rounded-2xl bg-rose-950/90 border border-rose-500/40 text-rose-200 text-xs text-center shadow-2xl backdrop-blur-md pointer-events-auto max-w-[650px]">
          ⚠️ <strong className="text-rose-300">Volume zero detectado!</strong> Selecione <strong>🖥️ [Tela]</strong> na lista de captura — não use fontes de janela (🪟).
        </div>
      )}

      {/* Área das Legendas */}
      <div className={`${isPanelOpen ? 'mt-1 pb-2' : 'flex-1 justify-end pb-4'} flex flex-col items-center px-6 pointer-events-none`}>
        {displayTranslation && (
          <div className="flex flex-col items-center max-w-[90%] text-center select-text">
            <div
              className="px-8 py-4 rounded-2xl"
              style={{
                background: 'rgba(0, 0, 0, 0.78)',
                backdropFilter: 'blur(6px)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              {/* Texto principal com outline preto — legível em qualquer fundo (Netflix/TV broadcast pattern) */}
              <p
                key={displayTranslation}
                className="text-xl font-bold tracking-wide leading-relaxed animate-subtitle-in text-white select-text"
                style={{
                  textShadow: [
                    '1px  1px 0 #000',
                    '-1px  1px 0 #000',
                    '1px -1px 0 #000',
                    '-1px -1px 0 #000',
                    '2px  0px 0 #000',
                    '-2px  0px 0 #000',
                    '0px  2px 0 #000',
                    '0px -2px 0 #000',
                    '0px  5px 12px rgba(0,0,0,0.95)',
                  ].join(', '),
                }}
              >
                {displayTranslation}
                {isInterim && (
                  <span
                    className="animate-pulse font-thin ml-1 select-none"
                    style={{ opacity: 0.5 }}
                  >▌</span>
                )}
              </p>

              {/* Original — menor, com outline para contraste também */}
              {displayOriginal && (
                <p
                  className="mt-2 text-[11px] font-medium tracking-wide text-white/60"
                  style={{
                    textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000',
                  }}
                >
                  {displayOriginal}{isInterim ? '…' : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Vídeo oculto para manter pipeline de vídeo ativo no Windows */}
      <video
        ref={hiddenVideoRef}
        style={{ width: '1px', height: '1px', opacity: 0, position: 'absolute', pointerEvents: 'none' }}
        playsInline
        muted
      />
    </div>
  );
}
