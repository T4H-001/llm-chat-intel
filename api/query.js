// /api/query.js — server-side proxy to the T4H bridge.
// Browser calls THIS (same-origin, zero CORS), this calls the bridge server-side.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sql } = req.body || {};
  if (!sql) return res.status(400).json({ error: 'Missing sql' });

  const LAMBDA_URL = 'https://zdgnab3py0.execute-api.ap-southeast-2.amazonaws.com/prod/lambda/invoke';
  const LAMBDA_KEY = 'bk_gfTUR-hHSYFJz_JR8krfZLIdYSYL0sHMpAIH2X3fRvYkJva6DgmLJQ';

  try {
    const resp = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': LAMBDA_KEY },
      body: JSON.stringify({ fn: 'troy-sql-executor', sql })
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Bridge HTTP ${resp.status}`, detail: data });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Bridge unreachable', detail: String(e) });
  }
}
