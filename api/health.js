// /api/health.js — non-sensitive production health/readiness endpoint.

const LAMBDA_URL = process.env.T4H_LAMBDA_URL;
const LAMBDA_KEY = process.env.T4H_LAMBDA_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method !== 'GET') return res.status(405).json({ status: 'BLOCKED', error: 'Method not allowed' });

  const configured = Boolean(LAMBDA_URL && LAMBDA_KEY);
  if (!configured) {
    return res.status(503).json({
      status: 'BLOCKED',
      runtime: 'llm-chat-intel',
      bridge: 'NOT_CONFIGURED',
      configured: false
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': LAMBDA_KEY },
      body: JSON.stringify({
        fn: 'troy-sql-executor',
        sql: 'SELECT COUNT(*) AS total FROM gpt_conversations'
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return res.status(503).json({
        status: 'BLOCKED',
        runtime: 'llm-chat-intel',
        bridge: 'ERROR',
        bridge_status: response.status
      });
    }

    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch (_) {}

    return res.status(200).json({
      status: 'REAL',
      runtime: 'llm-chat-intel',
      bridge: 'RESPONDING',
      corpus: 'gpt_conversations',
      receipt: 'HEALTH_QUERY_RETURNED',
      payload_shape: Array.isArray(payload) ? 'array' : typeof payload
    });
  } catch (e) {
    return res.status(503).json({
      status: 'BLOCKED',
      runtime: 'llm-chat-intel',
      bridge: e && e.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE'
    });
  } finally {
    clearTimeout(timeout);
  }
}
