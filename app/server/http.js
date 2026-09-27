export function applyCors(req, res) {
  const origin = (req.headers && (req.headers.origin || req.headers.Origin)) || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
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
  return {
    method: String(req.method || 'GET').toUpperCase(),
    headers,
    body,
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
