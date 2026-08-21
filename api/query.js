// /api/query.js — server-side read-only proxy to the T4H bridge.
// Runtime secrets MUST be supplied through Vercel environment variables.

const LAMBDA_URL = process.env.T4H_LAMBDA_URL;
const LAMBDA_KEY = process.env.T4H_LAMBDA_API_KEY;
const MAX_SQL_LENGTH = 12000;
const ALLOWED_TABLE = 'gpt_conversations';

function rejectUnsafeSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return 'Missing sql';
  if (sql.length > MAX_SQL_LENGTH) return 'SQL exceeds maximum length';
  const normalized = sql.trim().toLowerCase();
  if (!/^(select|with)\b/.test(normalized)) return 'Only SELECT/WITH queries are allowed';
  if (normalized.includes(';')) return 'Multiple SQL statements are not allowed';
  if (/--|\/\*|\*\//.test(normalized)) return 'SQL comments are not allowed';
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute|call|copy|vacuum|analyze|refresh)\b/.test(normalized)) {
    return 'Mutating or administrative SQL is not allowed';
  }
  if (!normalized.includes(ALLOWED_TABLE)) return `Only ${ALLOWED_TABLE} is available through this endpoint`;
  if (/\b(pg_|information_schema|auth\.|storage\.|vault\.)/.test(normalized)) return 'System/auth tables are not available';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!LAMBDA_URL || !LAMBDA_KEY) {
    return res.status(503).json({
      error: 'Runtime not configured',
      code: 'MISSING_RUNTIME_SECRET',
      detail: 'T4H_LAMBDA_URL and T4H_LAMBDA_API_KEY must be configured in production.'
    });
  }

  const { sql } = req.body || {};
  const validationError = rejectUnsafeSql(sql);
  if (validationError) return res.status(400).json({ error: validationError });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': LAMBDA_KEY },
      body: JSON.stringify({ fn: 'troy-sql-executor', sql }),
      signal: controller.signal
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }

    if (!resp.ok) {
      return res.status(resp.status >= 500 ? 502 : resp.status).json({
        error: `Bridge HTTP ${resp.status}`,
        detail: data
      });
    }
    return res.status(200).json(data);
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    return res.status(502).json({
      error: timedOut ? 'Bridge timeout' : 'Bridge unreachable',
      code: timedOut ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE'
    });
  } finally {
    clearTimeout(timeout);
  }
}
