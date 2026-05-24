import React, { useState, useEffect, useCallback } from 'react';

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(start, end) {
  if (!start || !end) return '—';
  const secs = Math.round((new Date(end) - new Date(start)) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  if (m < 60) return `${m}min ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

function groupByDate(meetings) {
  const groups = {};
  meetings.forEach(m => {
    const label = formatDate(m.started_at);
    if (!groups[label]) groups[label] = [];
    groups[label].push(m);
  });
  return groups;
}

export default function History() {
  const [meetings, setMeetings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [turns, setTurns] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    window.api.dbGetMeetings()
      .then(data => { setMeetings(data || []); setLoadingMeetings(false); })
      .catch(e => { setError(e.message); setLoadingMeetings(false); });
  }, []);

  const selectMeeting = useCallback(async (meeting) => {
    setSelected(meeting);
    setTurns([]);
    setLoadingTurns(true);
    try {
      const data = await window.api.dbGetTurns(meeting.id);
      setTurns(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingTurns(false);
    }
  }, []);

  const filtered = meetings.filter(m => {
    if (!search) return true;
    return formatDate(m.started_at).includes(search) || m.source_lang?.includes(search) || m.target_lang?.includes(search);
  });

  const groups = groupByDate(filtered);
  const questions = turns.filter(t => t.is_question);
  const totalTurns = turns.filter(t => !t.is_question).length;

  const handleExport = useCallback(async () => {
    if (!selected || turns.length === 0) return;
    setExporting(true);
    try {
      const meetingInfo = {
        date: formatDate(selected.started_at),
        time: formatTime(selected.started_at),
        duration: formatDuration(selected.started_at, selected.ended_at),
        sourceLang: selected.source_lang || 'en',
        targetLang: selected.target_lang || 'Português',
        totalTurns,
        questions: questions.length
      };
      const result = await window.api.exportConversation(meetingInfo, turns);
      if (result?.success) {
        setError('');
      }
    } catch (e) {
      setError('Erro ao exportar: ' + e.message);
    } finally {
      setExporting(false);
    }
  }, [selected, turns, totalTurns, questions.length]);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">

      {/* Sidebar — lista de sessões */}
      <div className="w-72 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">📋 Histórico de Conversas</h1>
              <p className="text-[10px] text-slate-500 mt-0.5">Agente Ariba Senior</p>
            </div>
            <button
              onClick={() => window.api.openBrain()}
              title="Gerenciar base de conhecimento do agente"
              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-all"
            >
              🧠 Cérebro
            </button>
          </div>
          <input
            type="text"
            placeholder="Buscar sessão..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mt-3 w-full px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingMeetings && (
            <div className="p-4 text-xs text-slate-500 text-center animate-pulse">Carregando sessões...</div>
          )}
          {!loadingMeetings && filtered.length === 0 && (
            <div className="p-4 text-xs text-slate-500 text-center">Nenhuma sessão encontrada.</div>
          )}
          {Object.entries(groups).map(([date, items]) => (
            <div key={date}>
              <div className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-950/50 sticky top-0">
                {date}
              </div>
              {items.map(m => {
                const isActive = selected?.id === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => selectMeeting(m)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-800/50 transition-all ${
                      isActive ? 'bg-emerald-900/30 border-l-2 border-l-emerald-500' : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{formatTime(m.started_at)}</span>
                      <span className="text-[10px] text-slate-500">{formatDuration(m.started_at, m.ended_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                        {m.source_lang || 'en'} → {m.target_lang || 'pt'}
                      </span>
                      {!m.ended_at && (
                        <span className="text-[10px] text-amber-400">em andamento</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Painel principal — detalhes da sessão */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
            <span className="text-4xl mb-3">🏢</span>
            <p className="text-sm font-medium">Selecione uma sessão para ver o histórico</p>
            <p className="text-xs mt-1 text-slate-700">{meetings.length} sessão(ões) registrada(s)</p>
          </div>
        ) : (
          <>
            {/* Header da sessão */}
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-sm font-bold text-white">
                  Sessão — {formatDate(selected.started_at)} às {formatTime(selected.started_at)}
                </h2>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[11px] text-slate-400">⏱ {formatDuration(selected.started_at, selected.ended_at)}</span>
                  <span className="text-[11px] text-slate-400">💬 {totalTurns} falas</span>
                  <span className="text-[11px] text-emerald-400">⚡ {questions.length} pergunta(s) detectada(s)</span>
                  <span className="text-[11px] text-slate-500">
                    {selected.source_lang || 'en'} → {selected.target_lang || 'Português'}
                  </span>
                </div>
              </div>
              <button
                onClick={handleExport}
                disabled={exporting || turns.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {exporting ? '⏳ Exportando...' : '📄 Exportar .txt'}
              </button>
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {loadingTurns && (
                <div className="text-xs text-slate-500 text-center animate-pulse pt-8">Carregando conversa...</div>
              )}

              {!loadingTurns && turns.length === 0 && (
                <div className="text-xs text-slate-600 text-center pt-8">Nenhuma fala registrada nesta sessão.</div>
              )}

              {turns.map((turn, i) => (
                turn.is_question ? (
                  /* Pergunta detectada pelo Ariba */
                  <div key={turn.id || i} className="rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">⚡ Pergunta detectada</span>
                      <span className="text-[10px] text-slate-500">{formatTime(turn.created_at)}</span>
                    </div>
                    {turn.original_text && (
                      <p className="text-xs text-slate-300 italic mb-2">"{turn.original_text}"</p>
                    )}
                    {turn.suggested_response && (
                      <div className="mt-2 pt-2 border-t border-emerald-800/40">
                        <p className="text-[10px] font-bold text-emerald-500 uppercase mb-1">Resposta sugerida (EN)</p>
                        <p className="text-sm text-white font-medium leading-relaxed">{turn.suggested_response}</p>
                        {turn.suggested_response_pt && (
                          <p className="text-xs text-emerald-300/70 italic mt-1.5">🇧🇷 {turn.suggested_response_pt}</p>
                        )}
                      </div>
                    )}
                    {turn.key_points?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {turn.key_points.map((kp, ki) => (
                          <span key={ki} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            📌 {kp}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Turno normal de fala */
                  <div key={turn.id || i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-[11px] text-slate-400 leading-relaxed">{turn.original_text}</p>
                        {turn.translated_text && (
                          <p className="text-sm text-white font-medium mt-1 leading-relaxed">{turn.translated_text}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-600 flex-shrink-0 mt-0.5">{formatTime(turn.created_at)}</span>
                    </div>
                  </div>
                )
              ))}
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="absolute bottom-4 right-4 bg-rose-950 border border-rose-700 text-rose-300 text-xs px-4 py-2 rounded-lg">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
