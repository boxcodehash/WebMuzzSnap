const ALLOWED_ORIGINS = new Set([
  'https://muzzsnap-app.vercel.app',
  'https://localhost'
]);

export function applyCors(req, res) {
  const origin = (req.headers && (req.headers.origin || req.headers.Origin)) || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

export function readRequest(req) {
  const headers = req.headers || {};
  let body = req.body;
  if (typeof body === 'string' && body) {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  if (!body || typeof body !== 'object') body = {};
  let query = {};
  try {
    const url = new URL(req.url || '/', 'https://muzzsnap.local');
    query = Object.fromEntries(url.searchParams.entries());
  } catch {
    query = {};
  }
  return {
    method: String(req.method || 'GET').toUpperCase(),
    headers,
    body,
    url: req.url || '',
    query,
    now: Date.now()
  };
}

export function sendResult(req, res, result) {
  applyCors(req, res);
  if (!result || result.status === 204) {
    res.status(204).end();
    return;
  }
  res.status(result.status || 500).json(result.body || { error: 'push_failed' });
}
