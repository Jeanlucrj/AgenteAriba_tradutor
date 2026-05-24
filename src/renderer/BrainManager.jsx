import React, { useState, useEffect, useCallback } from 'react';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default function BrainManager() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState('');
  const [error, setError] = useState('');

  const loadFiles = useCallback(async () => {
    try {
      const data = await window.api.brainListFiles();
      setFiles(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleAdd = async () => {
    setAdding(true);
    setAddStatus('Selecionando arquivo...');
    setError('');
    try {
      const result = await window.api.brainAddFile();
      if (result?.canceled) { setAddStatus(''); return; }
      if (result?.error) throw new Error(result.error);
      setAddStatus(`✅ "${result.title}" adicionado com tags: ${result.tags?.slice(0, 4).join(', ')}`);
      await loadFiles();
    } catch (e) {
      setError('Erro ao adicionar: ' + e.message);
      setAddStatus('');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (filename, title) => {
    if (!window.confirm(`Remover "${title}" do cérebro?`)) return;
    try {
      await window.api.brainDeleteFile(filename);
      setFiles(prev => prev.filter(f => f.filename !== filename));
    } catch (e) {
      setError('Erro ao remover: ' + e.message);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">

      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-sm font-bold text-white">🧠 Cérebro do Agente</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Base de conhecimento local — {files.length} arquivo(s) indexado(s)
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={adding}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-wait transition-all"
        >
          {adding ? '⏳ Processando...' : '+ Adicionar Arquivo'}
        </button>
      </div>

      {/* Status de adição */}
      {addStatus && (
        <div className="mx-6 mt-3 px-4 py-2 rounded-lg bg-emerald-950 border border-emerald-700 text-emerald-300 text-xs">
          {addStatus}
        </div>
      )}

      {/* Explicação */}
      <div className="mx-6 mt-3 px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-700/40 text-[11px] text-slate-400 leading-relaxed flex-shrink-0">
        <span className="text-slate-300 font-semibold">Como funciona:</span> Adicione documentos SAP (PDF, DOCX, TXT).
        O agente analisa o arquivo <span className="text-emerald-400">uma única vez</span> e gera tags automáticas.
        Durante as reuniões, apenas os arquivos <span className="text-emerald-400">relevantes para a conversa</span> são enviados ao Gemini — economizando tokens.
      </div>

      {/* Lista de arquivos */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {loading && (
          <div className="text-xs text-slate-500 text-center pt-8 animate-pulse">Carregando arquivos...</div>
        )}

        {!loading && files.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-16 text-slate-600">
            <span className="text-4xl mb-3">📂</span>
            <p className="text-sm font-medium">Nenhum arquivo no cérebro ainda</p>
            <p className="text-xs mt-1 text-slate-700">Clique em "+ Adicionar Arquivo" para começar</p>
          </div>
        )}

        {files.map(f => (
          <div key={f.filename} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-white truncate">{f.title}</span>
                  {f.added && (
                    <span className="text-[10px] text-slate-500 flex-shrink-0">{formatDate(f.added)}</span>
                  )}
                </div>
                {f.source && f.source !== f.filename && (
                  <p className="text-[10px] text-slate-500 mb-2">📎 {f.source}</p>
                )}
                {f.summary && (
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-2 line-clamp-2">{f.summary}</p>
                )}
                {f.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {f.tags.map((tag, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                        🏷 {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleDelete(f.filename, f.title)}
                className="flex-shrink-0 px-2 py-1 text-[10px] rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-500 hover:text-rose-400 border border-slate-700 hover:border-rose-700 transition-all"
                title="Remover do cérebro"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mx-6 mb-4 px-4 py-2 rounded-lg bg-rose-950 border border-rose-700 text-rose-300 text-xs">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
