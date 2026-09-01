// /api/estate.js — evidence-backed runtime estate endpoint.
// No client-supplied SQL is accepted. Catalogue counts are never presented as live counts.

const LAMBDA_URL = process.env.T4H_LAMBDA_URL;
const LAMBDA_KEY = process.env.T4H_LAMBDA_API_KEY;

const SQL = `SELECT * FROM public.llm_intelligence_runtime_summary`;
const PROVIDER_ARCHIVE = [
  { provider: 'GPT', candidates: 106 },
  { provider: 'Claude', candidates: 24 },
  { provider: 'Grok', candidates: 19 },
  { provider: 'Gemini', candidates: 6 },
  { provider: 'Perplexity', candidates: 7 }
];

async function run() {
  const response = await fetch(LAMBDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': LAMBDA_KEY },
    body: JSON.stringify({ fn: 'troy-sql-executor', debug: true, sql: SQL }),
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`bridge_${response.status}`);
  return data;
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.result?.rows)) return data.result.rows;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  if (typeof data?.body === 'string') { try { return rows(JSON.parse(data.body)); } catch (_) { return []; } }
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method !== 'GET') return res.status(405).json({ status: 'BLOCKED', error: 'Method not allowed' });
  if (!LAMBDA_URL || !LAMBDA_KEY) return res.status(503).json({ status: 'BLOCKED', code: 'MISSING_RUNTIME_SECRET' });

  try {
    const data = rows(await run());
    const s = data[0];
    if (!s) return res.status(503).json({ status: 'BLOCKED', code: 'NO_RUNTIME_SUMMARY' });

    const result = {
      status: s.runtime_state === 'REAL' ? 'REAL' : 'PARTIAL',
      generated_at: new Date().toISOString(),
      catalogue_agents: 729,
      registry_agents: Number(s.registry_total || 0),
      runtime_enabled: Number(s.runtime_enabled || 0),
      autonomous_enabled: Number(s.autonomous_enabled || 0),
      promotion_enabled: Number(s.promotion_enabled || 0),
      running: Number(s.running || 0),
      executions: Number(s.execution_total || 0),
      completed: Number(s.completed || 0),
      failed: Number(s.failed || 0),
      telemetry: Number(s.telemetry_total || 0),
      receipts: Number(s.receipt_total || 0),
      successful_receipts: Number(s.successful_receipts || 0),
      indexed_objects: Number(s.indexed_objects || 0),
      ingestion_events: Number(s.ingestion_events || 0),
      successful_ingestion_events: Number(s.successful_ingestion_events || 0),
      provider_archive_candidates: PROVIDER_ARCHIVE,
      used_agents: null,
      built_not_used: null,
      gaps: [
        'Full 729-agent usage cannot be derived until per-agent invocation telemetry is populated.',
        'Provider archive candidates are metadata inventory, not live conversation counts.',
        'Live LLM corpus search remains blocked until its source is ingested/indexed.'
      ],
      provenance: {
        runtime_summary: 'public.llm_intelligence_runtime_summary',
        registry: 'grk_runtime.registry_records',
        executions: 'grk_runtime.executions',
        telemetry: 'grk_runtime.telemetry_events',
        receipts: 'grk_runtime.receipts',
        index: 'knowledge_runtime.search_index',
        provider_archive: '2026-07-20 LLM archive candidate inventory'
      },
      receipt: 'ESTATE_RUNTIME_SUMMARY_RETURNED'
    };
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ status: 'BLOCKED', code: 'BRIDGE_UNREACHABLE', error: e.message });
  }
}
