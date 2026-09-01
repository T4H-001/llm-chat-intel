// /api/health.js — non-sensitive production readiness endpoint.

const LAMBDA_URL = process.env.T4H_LAMBDA_URL;
const LAMBDA_KEY = process.env.T4H_LAMBDA_API_KEY;
const SQL = 'SELECT * FROM public.llm_intelligence_runtime_summary';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method !== 'GET') return res.status(405).json({ status: 'BLOCKED', error: 'Method not allowed' });
  if (!LAMBDA_URL || !LAMBDA_KEY) return res.status(503).json({ status: 'BLOCKED', runtime: 'llm-chat-intel', bridge: 'NOT_CONFIGURED', configured: false });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': LAMBDA_KEY },
      body: JSON.stringify({ fn: 'troy-sql-executor', debug: true, sql: SQL }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) return res.status(503).json({ status: 'BLOCKED', runtime: 'llm-chat-intel', bridge: 'ERROR', bridge_status: response.status });
    let payload; try { payload = JSON.parse(text); } catch { payload = null; }
    return res.status(200).json({ status: 'REAL', runtime: 'llm-chat-intel', bridge: 'RESPONDING', source: 'public.llm_intelligence_runtime_summary', receipt: 'HEALTH_RUNTIME_SUMMARY_RETURNED', payload_present: payload !== null });
  } catch (e) {
    return res.status(503).json({ status: 'BLOCKED', runtime: 'llm-chat-intel', bridge: e && e.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE' });
  } finally { clearTimeout(timeout); }
}
