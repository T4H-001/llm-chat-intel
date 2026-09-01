// /api/query.js — server-side read-only proxy to the T4H bridge.
// Runtime secrets MUST be supplied through Vercel environment variables.

const LAMBDA_URL = process.env.T4H_LAMBDA_URL;
const LAMBDA_KEY = process.env.T4H_LAMBDA_API_KEY;
const MAX_SQL_LENGTH = 12000;
const ALLOWED_SOURCES = new Set([
  'public.llm_intelligence_runtime_summary',
  'grk_runtime.registry_records',
  'grk_runtime.executions',
  'grk_runtime.telemetry_events',
  'grk_runtime.receipts',
  'knowledge_runtime.search_index',
  'knowledge_runtime.ingestion_events'
]);

function rejectUnsafeSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return 'Missing sql';
  if (sql.length > MAX_SQL_LENGTH) return 'SQL exceeds maximum length';
  const normalized = sql.trim().toLowerCase();
  if (!/^select\b/.test(normalized)) return 'Only SELECT queries are allowed';
  if (normalized.includes(';')) return 'Multiple SQL statements are not allowed';
  if (/--|\/\*|\*\//.test(normalized)) return 'SQL comments are not allowed';
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute|call|copy|vacuum|analyze|refresh|union|join)\b/.test(normalized)) return 'Mutating, administrative, join or union SQL is not allowed';
  if (/\b(pg_|information_schema|auth\.|storage\.|vault\.)/.test(normalized)) return 'System/auth tables are not available';
  const sources = [...normalized.matchAll(/\bfrom\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/g)].map(m => m[1]);
  if (!sources.length) return 'A permitted source is required';
  if (sources.some(source => !ALLOWED_SOURCES.has(source))) return 'Requested source is not permitted';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method !== 'POST') return res.status(405).json({ status: 'BLOCKED', error: 'Method not allowed' });
  if (!LAMBDA_URL || !LAMBDA_KEY) return res.status(503).json({ status: 'BLOCKED', error: 'Runtime not configured', code: 'MISSING_RUNTIME_SECRET' });

  const { sql } = req.body || {};
  const validationError = rejectUnsafeSql(sql);
  if (validationError) return res.status(400).json({ status: 'BLOCKED', error: validationError });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': LAMBDA_KEY },
      body: JSON.stringify({ fn: 'troy-sql-executor', debug: true, sql }),
      signal: controller.signal
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }
    if (!resp.ok) return res.status(resp.status >= 500 ? 502 : resp.status).json({ status: 'BLOCKED', error: `Bridge HTTP ${resp.status}`, code: 'BRIDGE_ERROR' });
    return res.status(200).json({ status: 'REAL', receipt: 'QUERY_RETURNED', result: data });
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    return res.status(502).json({ status: 'BLOCKED', error: timedOut ? 'Bridge timeout' : 'Bridge unreachable', code: timedOut ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE' });
  } finally { clearTimeout(timeout); }
}
