// /api/estate.js — fixed, read-only estate monitor queries.
// No client-supplied SQL is accepted here.

const LAMBDA_URL = process.env.T4H_LAMBDA_URL;
const LAMBDA_KEY = process.env.T4H_LAMBDA_API_KEY;

const QUERIES = {
  providers: `SELECT COALESCE(ai_source, 'unknown') AS provider, COUNT(*)::int AS conversations FROM gpt_conversations GROUP BY ai_source ORDER BY conversations DESC`,
  chats: `SELECT COUNT(*)::int AS total_chats FROM gpt_conversations`,
  agent_registry: `SELECT COUNT(*)::int AS total_agents FROM agent_registry`,
  agent_registry_status: `SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::int AS count FROM agent_registry GROUP BY status ORDER BY count DESC`,
  agent_runtime: `SELECT COUNT(*)::int AS total_runtime, COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) = 'running')::int AS running, COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('waiting','idle'))::int AS waiting, COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('failed','error'))::int AS failed FROM runtime.agent_state`,
  agent_used: `SELECT COUNT(DISTINCT agent_id)::int AS used_agents FROM runtime.job_runs WHERE agent_id IS NOT NULL`
};

async function run(sql) {
  const response = await fetch(LAMBDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': LAMBDA_KEY },
    body: JSON.stringify({ fn: 'troy-sql-executor', sql }),
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
  if (typeof data?.body === 'string') {
    try { return rows(JSON.parse(data.body)); } catch (_) { return []; }
  }
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.method !== 'GET') return res.status(405).json({ status: 'BLOCKED', error: 'Method not allowed' });
  if (!LAMBDA_URL || !LAMBDA_KEY) return res.status(503).json({ status: 'BLOCKED', code: 'MISSING_RUNTIME_SECRET' });

  const result = {
    status: 'PARTIAL',
    generated_at: new Date().toISOString(),
    providers: [],
    chats: null,
    agent_registry: null,
    agent_registry_status: [],
    agent_runtime: null,
    agent_used: null,
    gaps: []
  };

  for (const [name, sql] of Object.entries(QUERIES)) {
    try {
      const data = rows(await run(sql));
      if (name === 'providers') result.providers = data;
      else if (name === 'chats') result.chats = data[0] || null;
      else if (name === 'agent_registry') result.agent_registry = data[0] || null;
      else if (name === 'agent_registry_status') result.agent_registry_status = data;
      else if (name === 'agent_runtime') result.agent_runtime = data[0] || null;
      else if (name === 'agent_used') result.agent_used = data[0] || null;
    } catch (e) {
      result.gaps.push({ dataset: name, error: e.message });
    }
  }

  const liveRuntime = result.agent_runtime !== null;
  const registry = Number(result.agent_registry?.total_agents || 0);
  const used = Number(result.agent_used?.used_agents || 0);
  result.built_not_used = registry > 0 && result.agent_used ? Math.max(registry - used, 0) : null;
  result.status = liveRuntime && registry > 0 ? 'REAL' : 'PARTIAL';
  result.catalogue_agents = 729;
  result.provenance = {
    catalogue_agents: 'canonical T4H agent estate records',
    live_agents: liveRuntime ? 'runtime.agent_state' : 'unavailable',
    used_agents: result.agent_used ? 'runtime.job_runs' : 'unavailable',
    conversations: 'gpt_conversations'
  };

  return res.status(200).json(result);
}
