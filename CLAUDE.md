# Realtime Translator Agent — Guia Completo para Agentes

## O que é este projeto

Aplicativo desktop Electron + React que faz **tradução simultânea em tempo real** de reuniões (Teams, Zoom, Meet, YouTube) com um painel de **Consultor SAP Ariba Senior** que analisa a conversa ao vivo e sugere respostas quando o usuário recebe uma pergunta.

**Fluxo principal:**
1. Captura áudio do sistema via WASAPI loopback (`getDisplayMedia` + `audio: 'loopback'`)
2. Envia chunks de áudio ao Deepgram via WebSocket → recebe transcrição em tempo real
3. Envia transcrição ao Gemini → tradução simultânea exibida como legenda always-on-top
4. A cada fala finalizada, analisa o histórico da conversa com o Gemini (Consultor Ariba) para detectar perguntas e sugerir respostas
5. Ao final da sessão, Gemini gera resumo da reunião salvo em `brain/meetings/` e extrai conhecimento técnico novo para `brain/knowledge/learned_from_meetings.md`

---

## Stack técnica

- **Electron 31** — janela overlay transparente, always-on-top, sem borda, `type: 'toolbar'`
- **React 18 + Vite** — renderer no processo de renderização
- **Tailwind CSS 3** — estilo utility-first
- **Deepgram** (`nova-2-meeting`, WebSocket, `endpointing=400`, `utterance_end_ms=1500`, `interim_results=true`)
- **Google Gemini** (`gemini-2.5-flash` via `v1beta`, `thinkingBudget: 0`) — tradução + análise Ariba + brain
- **Supabase** — banco PostgreSQL na nuvem para histórico de sessões (opcional: se não configurado, app funciona sem ele)
- **pdf-parse** + **mammoth** — extração de texto de PDFs e DOCX para o cérebro

---

## Estrutura de arquivos

```
realtime-translator-agent/
├── src/
│   ├── main/
│   │   ├── main.js          # Processo principal Electron — janela, IPC handlers, Deepgram WS
│   │   ├── preload.js       # Bridge IPC: expõe window.api para o renderer
│   │   ├── ariba.js         # Análise Gemini: detecta perguntas e sugere respostas (Consultor Ariba)
│   │   ├── brain.js         # Resumo de reunião, carrega contexto, extrai conhecimento pós-sessão
│   │   ├── brainManager.js  # CRUD do cérebro: adicionar/listar/deletar arquivos de conhecimento
│   │   ├── translation.js   # Tradução via Gemini (temperatura 0)
│   │   └── database.js      # Supabase: meetings + meeting_turns (graceful fallback se não configurado)
│   └── renderer/
│       ├── App.jsx          # Overlay principal — controles, legenda, painel Ariba
│       ├── History.jsx      # Janela de histórico de conversas (abre em window separada via /#history)
│       ├── BrainManager.jsx # Gerenciador do cérebro (abre via /#brain)
│       ├── index.jsx        # Entry point — roteamento por hash (#history, #brain, padrão = App)
│       ├── index.html       # HTML base
│       └── index.css        # Estilos globais + animação @keyframes subtitle-in
├── scripts/
│   └── brain-add.js         # CLI: npm run brain:add — processa arquivos em brain/inbox/
├── brain/
│   ├── knowledge/           # Arquivos .md indexados (VERSIONADOS no git)
│   │   ├── professional_profile.md   # Perfil profissional do usuário (sempre incluído no contexto)
│   │   ├── cig_guide.md              # Guia CIG (SAP Ariba Cloud Integration Gateway)
│   │   ├── learned_from_meetings.md  # Conhecimento extraído automaticamente das reuniões
│   │   └── ...outros arquivos inseridos via brain:add ou Brain Manager UI
│   ├── meetings/            # Resumos de reuniões gerados pelo Gemini (PRIVADO — .gitignore)
│   ├── inbox/               # Arquivos para processar (PRIVADO — .gitignore)
│   └── processed/           # Arquivos já processados (PRIVADO — .gitignore)
├── .env                     # Chaves API reais (NUNCA commitar — .gitignore)
├── .env.example             # Template sem valores reais
├── .gitignore               # brain/meetings/, brain/inbox/, brain/processed/, .env
├── package.json
├── vite.config.js
└── tailwind.config.js
```

---

## Variáveis de ambiente (.env)

```env
GEMINI_API_KEY=...       # Google Gemini API (obrigatório)
DEEPGRAM_API_KEY=...     # Deepgram (obrigatório)
SUPABASE_URL=...         # Supabase REST URL (opcional)
SUPABASE_ANON_KEY=...    # Supabase anon key (opcional, RLS habilitado)
```

**SEGURANÇA CRÍTICA:** `.env` contém chaves reais e NUNCA deve ser commitado. Já está no `.gitignore`. A chave Supabase (`sb_publishable_...`) é a chave pública anon — segura para uso no cliente, porém não deve ser exposta desnecessariamente.

---

## Como rodar

```bash
npm install
npm run dev           # Inicia Vite (renderer) + Electron em paralelo
```

Em produção (build):
```bash
npm run build         # Compila o renderer com Vite
npm run dev:electron  # Inicia Electron apontando para dist/
```

---

## Arquitetura do IPC (Main ↔ Renderer)

Todo acesso ao sistema passa pelo padrão: **Main Process → preload.js → window.api → Renderer**

`contextIsolation: true` + `nodeIntegration: false` — o renderer não tem acesso direto ao Node.

### IPC Handlers em main.js

| Canal | Tipo | O que faz |
|-------|------|-----------|
| `get-audio-sources` | invoke | Lista telas/janelas via desktopCapturer |
| `translate-text` | invoke | Traduz via Gemini (translation.js) |
| `set-ignore-mouse-events` | on | Passa/bloqueia eventos de mouse para o overlay |
| `move-window` | on | Move a janela principal por dx/dy |
| `get-deepgram-key` | invoke | Retorna chave do .env |
| `start-deepgram` | invoke | Abre WebSocket ao Deepgram no Main process |
| `send-audio-chunk` | on | Recebe ArrayBuffer do renderer e encaminha ao Deepgram WS |
| `stop-deepgram` | invoke | Fecha o WebSocket |
| `analyze-ariba` | invoke | Extrai keywords → loadSmartContext → analyzeConversation (ariba.js) |
| `brain-refresh-context` | invoke | Recarrega brain context no cache |
| `brain-generate-summary` | invoke | Gera resumo da reunião + extrai conhecimento (em paralelo) |
| `export-conversation` | invoke | dialog.showSaveDialog → escreve .txt formatado |
| `brain-list-files` | invoke | Lista arquivos em brain/knowledge/ com metadados |
| `brain-add-file` | invoke | dialog.showOpenDialog → addFileToBrain → atualiza cache |
| `brain-delete-file` | invoke | Remove arquivo de brain/knowledge/ |
| `open-history-window` | on | Cria BrowserWindow carregando /#history |
| `open-brain-window` | on | Cria BrowserWindow carregando /#brain |
| `set-window-height` | on | Redimensiona e reposiciona mainWindow |
| `set-pending-display-source` | on | Armazena sourceId antes do getDisplayMedia |
| `db-start-meeting` | invoke | Supabase INSERT meetings |
| `db-save-turn` | invoke | Supabase INSERT meeting_turns |
| `db-end-meeting` | invoke | Supabase PATCH meetings (ended_at) |
| `db-get-meetings` | invoke | Supabase GET meetings |
| `db-get-turns` | invoke | Supabase GET meeting_turns |

### Eventos do Main → Renderer (via webContents.send)

| Canal | O que envia |
|-------|-------------|
| `transcription-data` | Objeto JSON do Deepgram (Results, Metadata, etc.) |
| `deepgram-error` | String de erro |

---

## Captura de áudio — detalhes importantes

### WASAPI Loopback (áudio do sistema)
O handler `setDisplayMediaRequestHandler` no `app.whenReady()` injeta `audio: 'loopback'` na resposta do `getDisplayMedia`. Isso captura o áudio que o Windows está tocando (Teams, YouTube, etc.) sem precisar de um driver virtual.

**Bug crítico do Chromium:** O stream de vídeo DEVE ser mantido ativo (`hiddenVideoRef` no renderer). Se o vídeo for parado/pausado, o áudio congela no Windows. Por isso existe um `<video>` invisível de 1px que fica ativo durante toda a gravação.

### Troca de dispositivo de áudio
O evento `devicechange` detecta quando o usuário troca de headphone/speaker durante a gravação. O handler aguarda 1200ms (OS precisa finalizar a troca) e reinicia toda a captura para rebind do WASAPI ao novo dispositivo.

### Microfone físico
Fontes com `id` começando em `mic:` usam `getUserMedia` diretamente (sem WASAPI). Não têm frame buffer de tela.

---

## Deepgram (Main Process WebSocket)

O WebSocket ao Deepgram roda **no Main Process** (não no renderer) para:
- Evitar limitações do sandbox do renderer
- Manter a conexão estável independente do estado React

**Configuração da URL:**
```
wss://api.deepgram.com/v1/listen?model=nova-2-meeting&language={lang}&smart_format=true&punctuate=true&filler_words=false&endpointing=400&utterance_end_ms=1500&interim_results=true
```

- `nova-2-meeting`: otimizado para múltiplos speakers e ruído de reunião
- `endpointing=400`: pausa de 400ms = fim de fala
- `utterance_end_ms=1500`: end-of-utterance após 1500ms de silêncio
- `interim_results=true`: transcrições parciais em tempo real
- Keep-alive: `{ type: 'KeepAlive' }` a cada 10s para manter o WS vivo

---

## Tradução (translation.js)

Gemini `gemini-2.5-flash`, `temperature: 0`, `thinkingBudget: 0` (sem raciocínio extra = mais rápido).

**Otimizações no renderer:**
- Cache em `Map` (máx. 60 entradas): evita traduzir o mesmo trecho duas vezes
- Contexto deslizante: últimas 3 traduções finais enviadas ao Gemini para consistência de nomes/pronomes
- Interim throttle: 300ms entre traduções parciais, apenas 1 em flight por vez

---

## Análise Ariba (ariba.js)

Chamada a cada fala finalizada, com debounce de 2s. Apenas quando o painel Ariba está aberto.

**Input:** últimas 15 falas da conversa + até 4 frames da tela (base64 JPEG)

**Output JSON:**
```json
{
  "isQuestion": true/false,
  "question": "a pergunta feita ao consultor",
  "suggestedResponse": "resposta em inglês para o consultor ler em voz alta",
  "suggestedResponsePT": "tradução PT-BR para o consultor entender o que está dizendo",
  "keyPoints": ["até 3 tópicos SAP relevantes"],
  "context": "descrição curta do que está sendo discutido"
}
```

**Sistema de prompt:** Cobre TODOS os módulos SAP Ariba:
- Buying & Invoicing: Guided Buying, catálogos, PO Flip, 3-way match, Ariba Pay
- Sourcing: RFI/RFP/RFQ, eAuctions (todos os tipos), Spend Analysis, Category Management
- Supplier Management: SLP, Supplier Risk (D&B/EcoVadis), Business Network
- Contracts: CLM completo, Contract Intelligence AI
- SAP Business Network: cXML, EDI (ANSI X12, EDIFACT), ANID
- Integration: CIG (detalhado), CPI/iFlows, SAP MM (ME21N, ME51N, MIGO, MIRO, TAXBRA, IS-Oil)
- S/4HANA, BTP, MDG, SuccessFactors, Concur
- ABAP, IDocs, OData, Solution Manager

**Prioridade:** conteúdo do cérebro (`brainContext`) → conhecimento do modelo. NUNCA responde "não sei" para tópicos SAP.

**Análise visual:** Gemini identifica o tipo de conteúdo na tela (PowerPoint, YouTube, SAP demo, página web) e extrai texto visível, subtítulos, transaction codes, etc.

---

## Frame Buffer (contexto temporal de tela)

Quando a fonte é tela (não microfone), um `setInterval` captura 1 frame a cada **15 segundos** silenciosamente e armazena em `frameBufferRef` (ring buffer de até 3 frames).

Quando `triggerAnalysis` é chamado, concatena o frame atual com o buffer → até 4 frames em ordem cronológica enviados ao Gemini.

Isso permite ao Gemini entender progressão temporal: slide avançou, vídeo progrediu, tela navegou.

**Resolução capturada:** 50% das dimensões originais, JPEG 65% de qualidade — equilibra qualidade vs. tokens.

---

## Janela Overlay — detalhes técnicos

```js
{
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  type: 'toolbar',         // passa por cima de janelas fullscreen no Windows
  skipTaskbar: true,
  resizable: false,
}
mainWindow.setAlwaysOnTop(true, 'screen-saver'); // garante estar acima de Teams/Zoom fullscreen
mainWindow.setIgnoreMouseEvents(true, { forward: true }); // overlay passa mouse events por padrão
```

**Interação com o mouse:** O overlay começa ignorando todos os eventos de mouse (`forward: true` repassa para a janela abaixo). Quando o mouse entra nos controles (`onMouseEnter`), chama `setIgnoreMouseEvents(false)`. Quando sai, volta a ignorar.

### Drag do overlay
`webkit-app-region: drag` **NÃO funciona** em janelas transparentes no Windows. Solução: drag manual via JavaScript.

```js
// mousedown → salva posição inicial
// mousemove → calcula delta, envia IPC move-window
// mouseup → cleanup

// Bug crítico: se o botão for solto FORA da janela transparente,
// o evento mouseup não chega. Solução: verificar ev.buttons === 0
// dentro do mousemove para detectar botão solto em qualquer lugar.
const onMove = (ev) => {
  if (ev.buttons === 0) { cleanup(); return; } // botão solto fora da janela
  ...
};
```

---

## Cérebro do Agente (brain/)

### Estrutura
- `brain/knowledge/` — base de conhecimento permanente (arquivos .md com frontmatter YAML)
- `brain/meetings/` — resumos automáticos de reuniões (privado, .gitignore)
- `brain/inbox/` — drop zone para novos arquivos a processar (privado, .gitignore)
- `brain/processed/` — arquivos já inseridos no cérebro (privado, .gitignore)

### Frontmatter dos arquivos de knowledge
```yaml
---
title: Nome descritivo
tags: [tag1, tag2, tag3, ...]
source: arquivo_original.pdf
added: 2026-05-24
---
```

### Seleção inteligente de contexto (loadSmartContext)
Em vez de enviar o cérebro inteiro ao Gemini em toda análise, extrai keywords das últimas 8 falas e filtra arquivos cujas tags batem com essas keywords. Arquivos sempre incluídos: `professional_profile.md`, `learned_from_meetings.md`.

### Aprendizado automático (extractAndLearnKnowledge)
Chamado ao final de cada sessão (em paralelo com generateMeetingSummary). Envia a transcrição ao Gemini pedindo que extraia conhecimento técnico novo. Se encontrar algo, appenda em `brain/knowledge/learned_from_meetings.md`.

### CLI para inserir arquivos
```bash
npm run brain:add              # processa tudo em brain/inbox/
npm run brain:add -- arquivo.pdf  # arquivo específico
npm run brain:list             # lista o que está no cérebro
```

**Fluxo do brain:add:**
1. Extrai texto (pdf-parse / mammoth / fs.readFileSync)
2. Envia primeiros 6000 chars ao Gemini → gera `{title, tags, summary}` (chamada única)
3. Salva em `brain/knowledge/{slug}.md` com frontmatter + conteúdo (até 8000 chars)
4. Move arquivo para `brain/processed/`

### Brain Manager UI
Acessível via botão "🧠 Cérebro" na janela de Histórico. Abre uma nova janela carregando `/#brain` → `BrainManager.jsx`. Permite adicionar (dialog de arquivo), listar e deletar arquivos do cérebro.

---

## Roteamento do Renderer

`index.jsx` usa hash da URL para decidir qual componente renderizar:
```js
const hash = window.location.hash;
const component = hash.includes('history') ? <History />
  : hash.includes('brain') ? <BrainManager />
  : <App />;
```

- `/` → `App.jsx` (overlay principal)
- `/#history` → `History.jsx` (janela de histórico)
- `/#brain` → `BrainManager.jsx` (gerenciador do cérebro)

---

## Banco de dados Supabase

Tabelas (schema em `supabase_schema.sql`):

**meetings**
- `id` (uuid, PK)
- `source_lang` (text)
- `target_lang` (text)
- `started_at` (timestamptz)
- `ended_at` (timestamptz, nullable)

**meeting_turns**
- `id` (uuid, PK)
- `meeting_id` (uuid, FK → meetings)
- `original_text` (text)
- `translated_text` (text, nullable)
- `is_question` (bool)
- `suggested_response` (text, nullable)
- `suggested_response_pt` (text, nullable)
- `key_points` (text[], nullable)
- `created_at` (timestamptz)

**Graceful fallback:** se `SUPABASE_URL` ou `SUPABASE_ANON_KEY` não estiverem no `.env`, `isConfigured()` retorna false e todos os métodos do database.js retornam `null`/`[]` silenciosamente. O app funciona normalmente sem banco.

---

## Exportação de conversa

Botão "📄 Exportar .txt" na janela de Histórico. Chama `dialog.showSaveDialog` no Main, formata o histórico de turnos com timestamps, perguntas destacadas com respostas EN e PT-BR, e salva como `.txt` UTF-8.

---

## Bugs conhecidos e soluções

### 1. Drag quebra a tradução (IPC flood)
**Causa:** `mousemove` permanecia ativo após mouse solto fora da janela transparente, inundando o canal IPC `move-window` e bloqueando a tradução.
**Solução:** Verificar `ev.buttons === 0` dentro do `mousemove` para detectar botão solto em qualquer lugar.

### 2. Áudio congela ao trocar dispositivo (Windows)
**Causa:** WASAPI loopback fica preso no dispositivo original quando o Windows muda o padrão.
**Solução:** Listener `devicechange` que aguarda 1200ms e reinicia toda a captura.

### 3. Vídeo oculto necessário para áudio
**Causa:** Bug do Chromium — se o vídeo track for parado, o áudio track congela no Windows.
**Solução:** `<video>` invisível de 1px com `srcObject = stream` mantido ativo durante toda a gravação.

### 4. `webkit-app-region: drag` não funciona
**Causa:** Janelas transparentes no Windows não suportam CSS app-region drag de forma confiável.
**Solução:** Drag manual via JavaScript com mousedown/mousemove/mouseup.

### 5. Overlay não aparece sobre Teams/Zoom fullscreen
**Causa:** `alwaysOnTop: true` padrão não passa por cima de janelas fullscreen.
**Solução:** `mainWindow.setAlwaysOnTop(true, 'screen-saver')` — nível máximo no Windows.

---

## Regras de desenvolvimento

1. **Nunca commitar `.env`** — contém chaves reais. Já está no `.gitignore`.
2. **`brain/knowledge/` é versionado** — pode ir para o GitHub. Não contém dados sensíveis.
3. **`brain/meetings/`, `brain/inbox/`, `brain/processed/` são privados** — já no `.gitignore`.
4. **O overlay NÃO deve ter botões "manuais" para o cérebro** — tudo é automático. O usuário não quer gerenciar o cérebro durante reuniões. Brain Manager fica na janela de Histórico.
5. **Sistema prompt do Ariba cobre TODOS os módulos** — não apenas Sourcing. Inclui Buying, Invoicing, Contracts, Supplier Management, Business Network, integrações (CIG, CPI, SAP MM, S/4HANA, BTP, etc.).
6. **`thinkingBudget: 0` em todas as chamadas Gemini** — o thinking do Gemini 2.5 Flash não é necessário aqui e aumenta latência/custo.
