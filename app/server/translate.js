const TARGETS = new Set(['en', 'es', 'zh-CN', 'ja']);
const MAX_CHARS = 1000;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const BUDGET_MS = 8000;
const buckets = new Map();

const ES = new Set(`hola gracias buenos buenas dias días tardes noches por favor
que qué como cómo esta está estan están esto muy pero porque tambien también
amigo amiga vale mola onda neta chido manana mañana soy eres estamos tienes
quiero nada todo bien mal donde dónde cuando cuándo ahora aqui aquí hay yo
tu tú el la los las una unos unas del al con sin para mi su te se lo ya mas
más si sí en es de un vos oye dios vuelvo ni para nada neta chido mola vale
onda orale órale locura voy quiero rayos olvídalo olvidalo idea`.split(/\s+/));

const EN = new Set(`the is are was were to of and you your for with this that
it on at hello hi thanks thank good morning evening night please how what yes
but because also very friend gonna wanna yeah hey bye see soon love cool huge
moon day from have has just like really about would could should i'm im it's
its don't dont can't cant let's lets bro dude man guys awesome great nice sure
hold go got real what's whats up that's thats haha hahaha lol lmao lmfao omg
brb idk nvm wtf nope sup yo crazy thanks please gonna wanna`.split(/\s+/));

const SLANG = {
  lol: { en: 'lol', es: 'jaja', 'zh-CN': '哈哈', ja: 'ワロタ' },
  lmao: { en: 'lmao', es: 'jajaja', 'zh-CN': '笑死了', ja: 'ワロタ' },
  lmfao: { en: 'lmfao', es: 'jajaja', 'zh-CN': '笑死了', ja: 'ワロタ' },
  omg: { en: 'omg', es: 'dios mío', 'zh-CN': '我的天', ja: 'まじで' },
  brb: { en: 'brb', es: 'ya vuelvo', 'zh-CN': '马上回来', ja: 'すぐ戻る' },
  idk: { en: 'idk', es: 'ni idea', 'zh-CN': '不知道', ja: 'わからん' },
  nvm: { en: 'nvm', es: 'olvídalo', 'zh-CN': '算了', ja: 'なんでもない' },
  yeah: { en: 'yeah', es: 'sí', 'zh-CN': '嗯嗯', ja: 'うん' },
  nope: { en: 'nope', es: 'para nada', 'zh-CN': '才不要', ja: 'いやだ' },
  sup: { en: "what's up", es: 'qué onda', 'zh-CN': '最近怎么样', ja: '調子どう' },
  hey: { en: 'hey', es: 'oye', 'zh-CN': '嘿', ja: 'やあ' },
  yo: { en: 'yo', es: 'oye', 'zh-CN': '哟', ja: 'よお' },
  jaja: { en: 'haha', es: 'jaja', 'zh-CN': '哈哈', ja: 'ハハ' },
  jajaja: { en: 'hahaha', es: 'jajaja', 'zh-CN': '哈哈哈', ja: 'アハハ' },
  haha: { en: 'haha', es: 'jaja', 'zh-CN': '哈哈', ja: 'ハハ' },
  hahaha: { en: 'hahaha', es: 'jajaja', 'zh-CN': '哈哈哈', ja: 'アハハ' },
  '哈哈': { en: 'haha', es: 'jaja', 'zh-CN': '哈哈', ja: 'ハハ' },
  '哈哈哈': { en: 'hahaha', es: 'jajaja', 'zh-CN': '哈哈哈', ja: 'アハハ' },
  '草': { en: 'lol', es: 'jaja', 'zh-CN': '笑死了', ja: 'ワロタ' },
  'qué onda': { en: "what's up", es: 'qué onda', 'zh-CN': '最近怎么样', ja: '調子どう' },
  'que onda': { en: "what's up", es: 'qué onda', 'zh-CN': '最近怎么样', ja: '調子どう' },
  neta: { en: 'for real', es: 'neta', 'zh-CN': '真的假的', ja: 'マジで' },
  chido: { en: 'cool', es: 'chido', 'zh-CN': '很酷', ja: 'いいね' },
  mola: { en: "that's cool", es: 'mola', 'zh-CN': '超赞', ja: 'めっちゃいい' },
  vale: { en: 'ok', es: 'vale', 'zh-CN': '好的', ja: '了解だよ' },
  'órale': { en: "let's go", es: 'órale', 'zh-CN': '走起', ja: 'いこう' },
  orale: { en: "let's go", es: 'órale', 'zh-CN': '走起', ja: 'いこう' },
  gonna: { en: 'gonna', es: 'voy a', 'zh-CN': '就要', ja: 'するつもり' },
  wanna: { en: 'wanna', es: 'quiero', 'zh-CN': '想要', ja: 'したい' },
  wtf: { en: 'wtf', es: 'qué rayos', 'zh-CN': '什么鬼', ja: 'なにそれ' },
  'ありがとう': { en: 'thanks', es: 'gracias', 'zh-CN': '谢谢', ja: 'ありがとう' },
  '谢谢': { en: 'thanks', es: 'gracias', 'zh-CN': '谢谢', ja: 'ありがとう' },
  gracias: { en: 'thanks', es: 'gracias', 'zh-CN': '谢谢', ja: 'ありがとう' },
  thanks: { en: 'thanks', es: 'gracias', 'zh-CN': '谢谢', ja: 'ありがとう' },
  please: { en: 'please', es: 'por favor', 'zh-CN': '拜托', ja: 'お願い' },
  'por favor': { en: 'please', es: 'por favor', 'zh-CN': '拜托', ja: 'お願い' },
  'まじ': { en: 'for real', es: 'neta', 'zh-CN': '真的假的', ja: 'まじ' },
  'マジ': { en: 'for real', es: 'neta', 'zh-CN': '真的假的', ja: 'マジ' },
  'やばい': { en: 'crazy', es: 'una locura', 'zh-CN': '太离谱了', ja: 'やばい' },
  '了解': { en: 'got it', es: 'vale', 'zh-CN': '知道了', ja: '了解だよ' },
  '嗯': { en: 'yeah', es: 'sí', 'zh-CN': '嗯', ja: 'うん' },
  '嗯嗯': { en: 'yeah', es: 'sí', 'zh-CN': '嗯嗯', ja: 'うん' }
};

const TRADITIONAL = /[這來說對會時開門東車書國點裡從為與麼後發現過還讓應經關問電話機網頭體學習業產動種樣進運選環邊達遠連週雖難廣麵雞個們長雲愛無樂氣實題請謝視聽頁電買亞馬遜幹嗎著隻乾鬆準餘]/;
const ZH_MARK = /[的了吗呢吧啊这那个们说对会时开东车书国点里从为与么后发现过还让应经关问机网头体产动种样进运选环边虽难广面鸡云乐实题请谢视听页电买亚逊很是不哪什欢习气无]/;
const ZH_BIGRAM = /你好|谢谢|我們|我们|什么|什麼|怎么|怎麼|不是|没有|沒有|可以|现在|現在|知道|喜欢|喜歡|這個|这个/;
const SLANG_RE = /\b(?:lmfao|lmao|jajaja|hahaha|haha|jaja|lol|omg|brb|idk|nvm|yeah|nope)\b|哈哈哈|哈哈|(?<![\u4e00-\u9fff\u3040-\u30ff])草(?![\u4e00-\u9fff\u3040-\u30ff])/gi;

const TOKEN_SRC = [
  String.raw`https?:\/\/[^\s<>"'\p{Extended_Pictographic}]+`,
  String.raw`www\.[^\s<>"'\p{Extended_Pictographic}]+`,
  String.raw`0x[a-fA-F0-9]{40}`,
  String.raw`(?<![\w])@[A-Za-z0-9_]{1,32}`,
  String.raw`:sticker:[A-Za-z0-9_-]+:`,
  String.raw`\[\[sticker:[^\]]+\]\]`,
  String.raw`\[sticker:[^\]]+\]`,
  String.raw`:[A-Za-z][A-Za-z0-9_-]{0,40}:`,
  String.raw`\p{Regional_Indicator}{2}`,
  String.raw`[#*0-9]\uFE0F?\u20E3`,
  String.raw`\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*`
].join('|');

function tokenRe() {
  return new RegExp(TOKEN_SRC, 'gu');
}

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function hard(err) {
  return err && (err.code === 'timeout' || err.code === 'offline' || err.code === 'rate_limited');
}

export function resetTranslateRate() {
  buckets.clear();
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

function peelUrl(raw) {
  let url = raw;
  let extra = '';
  while (/[.,)!?;]$/.test(url)) {
    extra = url.slice(-1) + extra;
    url = url.slice(0, -1);
  }
  return { url, extra };
}

export function stripProtected(text) {
  return String(text || '').replace(tokenRe(), ' ');
}

function splitProtected(text) {
  const re = tokenRe();
  const parts = [];
  let last = 0;
  for (const match of String(text || '').matchAll(re)) {
    const raw = match[0];
    const at = match.index;
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) });
    if (/^https?:\/\//i.test(raw) || /^www\./i.test(raw)) {
      const peeled = peelUrl(raw);
      parts.push({ kind: 'keep', text: peeled.url });
      if (peeled.extra) parts.push({ kind: 'text', text: peeled.extra });
    } else {
      parts.push({ kind: 'keep', text: raw });
    }
    last = at + raw.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

function isNeutralWord(word) {
  if (/^(ok|okay)$/i.test(word)) return true;
  if (/^[0-9]+$/.test(word)) return true;
  if (/^[A-Z0-9]{2,}$/.test(word)) return true;
  return false;
}

function classifyWord(word) {
  if (isNeutralWord(word)) return 'und';
  const w = word.toLowerCase();
  if (/[áéíóúüñ]/i.test(w)) return 'es';
  const es = ES.has(w);
  const en = EN.has(w);
  if (es && !en) return 'es';
  if (en && !es) return 'en';
  return 'und';
}

function splitLatin(run, target) {
  const re = /([A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+)|([^A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+)/g;
  const bits = run.match(re) || [];
  const groups = [];
  for (const bit of bits) {
    if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/i.test(bit)) {
      if (groups.length) groups[groups.length - 1].text += bit;
      else groups.push({ kind: 'keep', lang: 'und', text: bit });
      continue;
    }
    const lang = classifyWord(bit);
    let kind = lang === 'und' || lang === target ? 'keep' : 'translate';
    if (lang === 'zh-CN' && target === 'zh-CN' && TRADITIONAL.test(bit)) kind = 'translate';
    const prev = groups[groups.length - 1];
    if (prev && prev.lang === lang && prev.kind === kind) prev.text += bit;
    else groups.push({ kind, lang, text: bit });
  }
  return groups;
}

function classifyRun(text, target) {
  const re = /[\u3040-\u30ff\uff66-\uff9d\u4e00-\u9fff]+|[^\u3040-\u30ff\uff66-\uff9d\u4e00-\u9fff]+/g;
  const bits = String(text || '').match(re) || [];
  const out = [];
  for (const bit of bits) {
    if (/[\u3040-\u30ff\uff66-\uff9d\u4e00-\u9fff]/.test(bit)) {
      const lang = /[\u3040-\u30ff\uff66-\uff9d]/.test(bit) ? 'ja' : 'zh-CN';
      let kind = lang === target ? 'keep' : 'translate';
      if (lang === 'zh-CN' && target === 'zh-CN' && TRADITIONAL.test(bit)) kind = 'translate';
      out.push({ kind, lang, text: bit });
    } else {
      out.push(...splitLatin(bit, target));
    }
  }
  return out;
}

function slangRow(token) {
  return SLANG[token] || SLANG[String(token || '').toLowerCase()] || null;
}

function explodeSlang(text, target) {
  const out = [];
  let last = 0;
  const re = new RegExp(SLANG_RE.source, 'gi');
  for (const match of String(text || '').matchAll(re)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
    const row = slangRow(match[0]);
    const repl = row && row[target];
    if (repl) out.push({ kind: 'keep', lang: target, text: repl });
    else out.push({ kind: 'text', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  if (!out.length) out.push({ kind: 'text', text: text || '' });
  return out;
}

function planPieces(text, target) {
  const out = [];
  for (const part of splitProtected(text)) {
    if (part.kind === 'keep') {
      out.push({ kind: 'keep', lang: 'und', text: part.text });
      continue;
    }
    for (const chunk of explodeSlang(part.text, target)) {
      if (chunk.kind === 'keep') out.push(chunk);
      else out.push(...classifyRun(chunk.text, target));
    }
  }
  return out;
}

export function segmentMessage(text, target) {
  return planPieces(text, target).map((part) => ({
    kind: part.kind,
    lang: part.lang,
    text: part.text
  }));
}

function classifyPieces(text) {
  return classifyRun(stripProtected(text), 'und').filter((part) => part.text.trim());
}

function hanOkForJapanese(text) {
  const core = String(text || '').replace(/\s+/g, '');
  if (!core || [...core].length > 12) return false;
  if (ZH_MARK.test(core) || ZH_BIGRAM.test(core)) return false;
  return true;
}

export function matchesTarget(text, target) {
  if (!TARGETS.has(target)) return false;
  const sample = stripProtected(String(text || '')).normalize('NFC');
  if (!sample.trim()) return true;
  if (target === 'ja') {
    const sentences = sample.split(/[。！？!?\n]+/);
    for (const sentence of sentences) {
      if (!/[\u4e00-\u9fff]/.test(sentence) || /[\u3040-\u30ff\uff66-\uff9d]/.test(sentence)) continue;
      const han = sentence.replace(/[^\u4e00-\u9fff]/g, '');
      if (!hanOkForJapanese(han)) return false;
    }
  }
  for (const part of classifyPieces(sample)) {
    if (part.lang === 'und') continue;
    if (part.lang === target) {
      if (target === 'zh-CN' && TRADITIONAL.test(part.text)) return false;
      continue;
    }
    if (target === 'ja' && part.lang === 'zh-CN' && hanOkForJapanese(part.text)) continue;
    return false;
  }
  return true;
}

export function detectLanguage(text) {
  const parts = classifyPieces(String(text || '').normalize('NFC')).filter((part) => part.lang !== 'und');
  if (!parts.length) return 'und';
  const score = {};
  for (const part of parts) score[part.lang] = (score[part.lang] || 0) + part.text.trim().length;
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
}

export function guessSource(text) {
  const lang = detectLanguage(text);
  return lang === 'und' ? 'en' : lang;
}

export { SLANG as slangTable };

function slangWhole(core, target) {
  const trimmed = String(core || '').trim();
  const marked = trimmed.match(/^([\s\S]+?)([?!.,。！？]+)$/);
  const phrase = (marked ? marked[1] : trimmed).trim().toLowerCase().replace(/\s+/g, ' ');
  const punct = marked ? marked[2] : '';
  const row = SLANG[phrase];
  if (!row || !row[target]) return null;
  return row[target] + punct;
}

function decodeEntities(text) {
  let out = String(text || '');
  for (let i = 0; i < 2; i += 1) {
    out = out
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
  }
  return out;
}

function pickKey(env, names) {
  for (const name of names) {
    const value = env && env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function googleLang(code) {
  if (code === 'zh-CN' || code === 'zh') return 'zh-CN';
  if (code === 'ja' || code === 'es' || code === 'en') return code;
  return code || 'auto';
}

function deeplLang(code) {
  if (code === 'zh-CN' || code === 'zh') return 'ZH';
  if (code === 'ja') return 'JA';
  if (code === 'es') return 'ES';
  if (code === 'en') return 'EN';
  return '';
}

async function readUpstream(url, fetchImpl, ms, init) {
  if (ms < 250) throw fail('timeout');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchImpl(url, { ...(init || {}), signal: ctrl.signal });
    const raw = await res.text();
    if (res.status === 429 || res.status === 456) throw fail('rate_limited');
    if (res.ok === false || (typeof res.status === 'number' && res.status >= 400)) throw fail('translate_failed');
    try {
      return JSON.parse(raw);
    } catch {
      throw fail('translate_failed');
    }
  } catch (err) {
    if (err && err.code) throw err;
    if (err && err.name === 'AbortError') throw fail('timeout');
    throw fail('offline');
  } finally {
    clearTimeout(timer);
  }
}

function fromGooglePublic(data) {
  const rows = data && data[0];
  if (!Array.isArray(rows)) throw fail('translate_failed');
  const text = rows.map((row) => (row && row[0]) || '').join('').trim();
  if (!text) throw fail('translate_failed');
  return decodeEntities(text);
}

async function publicTranslate(text, source, target, fetchImpl, ms) {
  const query = new URLSearchParams({
    client: 'gtx',
    sl: source && source !== 'auto' ? googleLang(source) : 'auto',
    tl: googleLang(target),
    dt: 't',
    q: text
  });
  const url = 'https://translate.googleapis.com/translate_a/single?' + query.toString();
  const data = await readUpstream(url, fetchImpl, ms, {
    headers: { Accept: 'application/json,text/plain,*/*', 'User-Agent': 'Mozilla/5.0' }
  });
  return fromGooglePublic(data);
}

async function cloudTranslate(text, source, target, key, fetchImpl, ms) {
  const url = 'https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key);
  const body = { q: text, target: googleLang(target), format: 'text' };
  if (source && source !== 'auto') body.source = googleLang(source);
  const data = await readUpstream(url, fetchImpl, ms, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const row = data && data.data && data.data.translations && data.data.translations[0];
  const out = row && row.translatedText;
  if (!out || !String(out).trim()) throw fail('translate_failed');
  return decodeEntities(String(out).trim());
}

async function deeplTranslate(text, source, target, key, fetchImpl, ms) {
  const root = /:fx$/.test(key) ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const body = { text: [text], target_lang: deeplLang(target) };
  const sourceLang = source && source !== 'auto' ? deeplLang(source) : '';
  if (sourceLang) body.source_lang = sourceLang;
  if (target === 'es' || target === 'ja') body.formality = 'less';
  const data = await readUpstream(root + '/v2/translate', fetchImpl, ms, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'DeepL-Auth-Key ' + key
    },
    body: JSON.stringify(body)
  });
  const row = data && data.translations && data.translations[0];
  const out = row && row.text;
  if (!out || !String(out).trim()) throw fail('translate_failed');
  return decodeEntities(String(out).trim());
}

async function translateUpstream(text, source, target, deps) {
  const env = deps.env || {};
  const fetchImpl = deps.fetch || fetch;
  const ms = deps.timeLeft ? deps.timeLeft() : BUDGET_MS;
  const googleKey = pickKey(env, ['GOOGLE_TRANSLATE_API_KEY', 'TRANSLATE_API_KEY']);
  const deeplKey = pickKey(env, ['DEEPL_API_KEY']);
  const errors = [];
  if (googleKey) {
    try {
      return await cloudTranslate(text, source, target, googleKey, fetchImpl, deps.timeLeft ? deps.timeLeft() : ms);
    } catch (err) {
      if (hard(err)) throw err;
      errors.push(err);
    }
  }
  if (deeplKey) {
    try {
      return await deeplTranslate(text, source, target, deeplKey, fetchImpl, deps.timeLeft ? deps.timeLeft() : ms);
    } catch (err) {
      if (hard(err)) throw err;
      errors.push(err);
    }
  }
  if (!googleKey && !deeplKey) return publicTranslate(text, source, target, fetchImpl, deps.timeLeft ? deps.timeLeft() : ms);
  throw errors[0] || fail('translate_failed');
}

async function translateCore(core, source, target, deps) {
  const known = slangWhole(core, target);
  if (known != null) return known;
  const attempts = [];
  if (source && source !== 'auto') attempts.push(source);
  attempts.push('auto');
  let wrong = false;
  let lastFail = null;
  for (const sl of attempts) {
    try {
      const out = String(await translateUpstream(core, sl, target, deps) || '').trim();
      if (out && matchesTarget(out, target)) return out;
      if (out) wrong = true;
    } catch (err) {
      if (hard(err)) throw err;
      lastFail = err;
    }
  }
  if (wrong) throw fail('wrong_language');
  throw lastFail || fail('translate_failed');
}

async function renderPiece(piece, target, deps) {
  if (piece.kind !== 'translate') return piece.text;
  const pad = String(piece.text || '').match(/^(\s*)([\s\S]*?)(\s*)$/);
  const lead = pad[1];
  const core = pad[2];
  const tail = pad[3];
  if (!core) return piece.text;
  const translated = await translateCore(core, piece.lang, target, deps);
  return lead + translated + tail;
}

async function translateMessage(text, target, deps) {
  const deadline = Date.now() + (deps.budgetMs || BUDGET_MS);
  const ctx = {
    env: deps.env || {},
    fetch: deps.fetch || fetch,
    timeLeft() { return deadline - Date.now(); }
  };
  let out = '';
  for (const piece of planPieces(text, target)) out += await renderPiece(piece, target, ctx);
  if (!matchesTarget(out, target)) throw fail('wrong_language');
  return out;
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
    const translated = await translateMessage(text, target, deps);
    return { status: 200, body: { text: translated } };
  } catch (err) {
    const code = err && err.code;
    if (code === 'timeout') return { status: 504, body: { error: 'timeout' } };
    if (code === 'rate_limited') return { status: 429, body: { error: 'rate_limited' } };
    if (code === 'offline') return { status: 503, body: { error: 'offline' } };
    if (code === 'wrong_language') return { status: 422, body: { error: 'wrong_language' } };
    return { status: 502, body: { error: 'translate_failed' } };
  }
}
