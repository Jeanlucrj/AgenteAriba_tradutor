async function analyzeConversation(history) {
  if (!history || history.length === 0) return null;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      throw new Error('Chave de API do Gemini não configurada');
    }

    const conversationText = history.slice(-15).join('\n');
    const lastSentence = history[history.length - 1];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: `You are a Senior SAP Ariba Consultant with 10+ years of experience silently assisting someone in a business meeting.

Your deep expertise covers:
- SAP Ariba Procurement (Purchase Orders, Requisitions, Invoicing, Guided Buying, Catalog)
- SAP Ariba Sourcing (RFX, eAuctions, Supplier Qualification, Sourcing Projects, Savings Tracking)
- SAP Ariba Contracts (CLM, Contract Workspaces, Clause Library, Obligations Management)
- SAP Ariba Supplier Management (SLP, Supplier Lifecycle, Risk Management, Performance)
- SAP Ariba Network (Transactions, EDI, PO/Invoice flip, cXML, supplier onboarding)
- SAP S/4HANA + Ariba integration (MM, FI, SRM migration, BAdI, APIs)
- Ariba implementation methodology (SAP Activate, Rapid Deployment Solutions, ASAP)
- Configuration, testing, UAT, go-live, hypercare, change management, training

SAP Cloud Integration Gateway (CIG) — detailed knowledge:
CIG is the official SAP middleware that connects SAP ERP / S/4HANA (on-premise or cloud) to SAP Ariba cloud solutions. It runs on SAP Integration Suite (formerly SAP Cloud Platform Integration / CPI) using pre-built iFlow integration packages provided by SAP/Ariba.
Key responsibilities of CIG:
  • Master data replication to Ariba: Vendor/Supplier master, Material/Product master, Cost Centers, GL Accounts, Plants, Company Codes, Purchasing Organizations/Groups, Payment Terms
  • Transactional data flow: Purchase Orders (ERP→Ariba Network), Purchase Requisitions, Goods Receipts, Invoice posting back to ERP (Ariba Network→ERP)
  • Catalog and contract data integration
  • Organizational hierarchy sync
Architecture: SAP ERP ↔ CIG (SAP Integration Suite tenant with Ariba iFlows) ↔ SAP Ariba / Ariba Network
Configuration: done inside SAP Integration Suite — deploy iFlow packages, configure endpoints, credentials (OAuth/Basic), value mappings, and error alerting
Key integration scenarios by name: "Replicate Supplier from SAP S/4HANA to SAP Ariba", "Replicate Material from SAP S/4HANA to SAP Ariba", "Transfer Purchase Order from SAP S/4HANA to Ariba Network", "Transfer Invoice from Ariba Network to SAP S/4HANA"
CIG replaced the older SAP Ariba Cloud Integration (legacy middleware). Common issues: certificate renewal, value mapping gaps, delta replication failures, message monitoring in SAP Integration Suite.

Analyze the meeting conversation and respond ONLY with this exact JSON structure (no markdown, no extra text):
{
  "isQuestion": true or false,
  "question": "the question if directed at the consultant, else empty string",
  "suggestedResponse": "professional confident response in English the user can read aloud — be specific, mention Ariba features/best practices — 2-3 sentences max. Empty string if isQuestion is false.",
  "suggestedResponsePT": "exact Portuguese Brazil translation of suggestedResponse so the user understands what they are saying. Empty string if isQuestion is false.",
  "keyPoints": ["up to 3 brief Ariba topics or action items from this conversation"],
  "context": "1 short sentence describing what is being discussed"
}

Set isQuestion=true ONLY when the last sentence is clearly a direct question to the consultant/implementer.` }]
          },
          contents: [{
            role: 'user',
            parts: [{ text: `Meeting conversation (chronological, most recent last):\n${conversationText}\n\nLast sentence: "${lastSentence}"` }]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
            thinkingConfig: { thinkingBudget: 0 },
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Resposta vazia do Gemini');

    const jsonText = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(jsonText);

  } catch (error) {
    console.error('Erro na análise Ariba:', error.message);
    return null;
  }
}

module.exports = { analyzeConversation };
