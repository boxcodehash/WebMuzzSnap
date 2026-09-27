const TARGETS = new Set(['en', 'es', 'zh-CN', 'ja']);
const MAX_CHARS = 1000;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const buckets = new Map();

export function resetTranslateRate() {
  buckets.clear();
}

export function guessSource(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  if (/[áéíóúüñ¿¡]/i.test(text)) return 'es';
  if (/\b(el|la|los|las|hola|gracias|buenos|por favor)\b/i.test(text)) return 'es';
  return 'en';
}

function clientIp(headers) {
  const raw = headers && (headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '');
  const first = String(raw).split(',')[0].trim();
  return (first || 'unknown').slice(0, 80);
}

function allow(ip, now) {
  const row = buckets.get(ip);
  if (!row || now - row.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return true;
  }
  row.count += 1;
  return row.count <= MAX_PER_WINDOW;
}

function googleUrl(text, target) {
  const query = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: target,
    dt: 't',
    q: text
  });
  return 'https://translate.googleapis.com/translate_a/single?' + query.toString();
}

function memoryUrl(text, source, target) {
  const query = new URLSearchParams({
    q: text,
    langpair: source + '|' + target
  });
  return 'https://api.mymemory.translated.net/get?' + query.toString();
}

async function fetchJson(url, fetchImpl, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const raw = await res.text();
    if (!res.ok) throw new Error('status');
    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}

function fromGoogle(data) {
  const rows = data && data[0];
  if (!Array.isArray(rows)) throw new Error('shape');
  const text = rows.map((row) => (row && row[0]) || '').join('').trim();
  if (!text) throw new Error('empty');
  return text;
}

function fromMemory(data) {
  const text = data && data.responseData && data.responseData.translatedText;
  const value = String(text || '').trim();
  if (!value || data.quotaFinished || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(value)) {
    throw new Error('memory');
  }
  if (Number(data.responseStatus) !== 200) throw new Error('memory');
  return value;
}

async function translateText(text, target, fetchImpl) {
  const deadline = Date.now() + 5000;
  const left = () => Math.max(1, deadline - Date.now());
  try {
    const data = await fetchJson(googleUrl(text, target), fetchImpl, Math.min(5000, left()));
    return fromGoogle(data);
  } catch {
    /* Google's public endpoint often answers 429. MyMemory is the free fallback. */
  }
  if (Date.now() >= deadline) throw new Error('timeout');
  let source = guessSource(text);
  if (source === target) source = target === 'en' ? 'es' : 'en';
  const data = await fetchJson(memoryUrl(text, source, target), fetchImpl, left());
  return fromMemory(data);
}

export async function handleTranslate(req, deps = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return { status: 204 };
  if (method !== 'POST') return { status: 405, body: { error: 'method' } };
  const body = req.body || {};
  const text = String(body.text == null ? '' : body.text).trim();
  const target = String(body.target || '');
  if (!TARGETS.has(target)) return { status: 400, body: { error: 'bad_target' } };
  if (!text) return { status: 400, body: { error: 'empty' } };
  if (text.length > MAX_CHARS) return { status: 400, body: { error: 'too_long' } };
  const ip = clientIp(req.headers);
  if (!allow(ip, req.now || Date.now())) return { status: 429, body: { error: 'rate_limited' } };
  try {
    const translated = await translateText(text, target, deps.fetch || fetch);
    return { status: 200, body: { text: translated } };
  } catch {
    return { status: 502, body: { error: 'translate_failed' } };
  }
}
