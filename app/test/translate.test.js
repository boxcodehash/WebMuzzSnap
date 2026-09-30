import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  detectLanguage,
  guessSource,
  handleTranslate,
  matchesTarget,
  resetTranslateRate,
  segmentMessage,
  slangTable
} from '../server/translate.js';

const WALLET = '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a';

function google(text) {
  return { ok: true, status: 200, text: async () => JSON.stringify([[[text, '', '']]]) };
}

function req(text, target, extra = {}) {
  return {
    method: 'POST',
    headers: extra.headers || { 'x-forwarded-for': extra.ip || '203.0.113.10' },
    body: { text, target },
    now: extra.now || 10_000
  };
}

test('translate rejects empty, unknown language, and long text without calling out', async () => {
  resetTranslateRate();
  let called = false;
  const fetchImpl = async () => { called = true; return google('x'); };
  const deps = { fetch: fetchImpl, env: {} };
  assert.equal((await handleTranslate({ method: 'OPTIONS', body: {}, headers: {} }, deps)).status, 204);
  assert.equal((await handleTranslate({ method: 'POST', body: { text: '  ', target: 'en' }, headers: {} }, deps)).status, 400);
  assert.equal((await handleTranslate({ method: 'POST', body: { text: 'Hola', target: 'fr' }, headers: {} }, deps)).status, 400);
  const long = await handleTranslate({ method: 'POST', body: { text: 'a'.repeat(1001), target: 'en' }, headers: {} }, deps);
  assert.equal(long.status, 400);
  assert.equal(long.body.error, 'too_long');
  assert.equal(called, false);
  assert.equal(guessSource('こんにちは'), 'ja');
  assert.equal(guessSource('你好'), 'zh-CN');
  assert.equal(guessSource('Buenos días'), 'es');
  assert.equal(guessSource('Good morning'), 'en');
  assert.equal(detectLanguage('Hola'), 'es');
  assert.deepEqual(
    segmentMessage('Hola friend', 'ja').filter((part) => part.kind === 'translate').map((part) => part.lang),
    ['es', 'en']
  );
  const src = readFileSync(new URL('../server/translate.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/translate.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /console\.(log|info|debug|error|warn)/);
  assert.match(src, /GOOGLE_TRANSLATE_API_KEY/);
  assert.match(src, /TRANSLATE_API_KEY/);
  assert.match(src, /DEEPL_API_KEY/);
  assert.doesNotMatch(src + api, /AIza[0-9A-Za-z_-]{10,}/);
  assert.match(api, /env:\s*process\.env/);
  const client = readFileSync(new URL('../www/js/translate.js', import.meta.url), 'utf8');
  assert.match(client, /Translation timed out\. Try again\./);
  assert.match(client, /Too many translations\. Try again in a minute\./);
  assert.match(client, /You're offline\. Check your connection and try again\./);
  assert.match(client, /wrong language/);
  assert.match(client, /AbortError/);
});

test('translate rate limit is per IP and does not include the message', async () => {
  resetTranslateRate();
  const fetchImpl = async () => google('Hello');
  const call = () => handleTranslate(req('Hola', 'en', {
    headers: { 'x-forwarded-for': '203.0.113.9' },
    now: 1_000
  }), { fetch: fetchImpl, env: {} });
  for (let i = 0; i < 20; i += 1) {
    const ok = await call();
    assert.equal(ok.status, 200);
    assert.equal(ok.body.text, 'Hello');
  }
  const limited = await call();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal('text' in limited.body, false);
});

const MIXED = [
  {
    name: 'spanish tokens to english',
    text: `Hola 👋👨‍👩‍👧‍👦🇪🇸👍🏽 https://muzzsnap.app/chat @ryashu ${WALLET} :sticker:to-the-moon:`,
    target: 'en',
    map: { Hola: 'Hello' },
    includes: ['Hello', '👋', '👨‍👩‍👧‍👦', '🇪🇸', '👍🏽', 'https://muzzsnap.app/chat', '@ryashu', WALLET, ':sticker:to-the-moon:'],
    language: 'en'
  },
  {
    name: 'english stickers and japanese to chinese',
    text: 'Good morning [[sticker:soy-verga]] こんにちは [sticker:the-boss]',
    target: 'zh-CN',
    map: { 'Good morning': '早上好', 'こんにちは': '你好' },
    includes: ['早上好', '[[sticker:soy-verga]]', '你好', '[sticker:the-boss]'],
    language: 'zh-CN'
  },
  {
    name: 'chinese wallet to japanese',
    text: `你好 ${WALLET} :muzz:`,
    target: 'ja',
    map: { '你好': 'こんにちは' },
    includes: ['こんにちは', WALLET, ':muzz:'],
    language: 'ja'
  },
  {
    name: 'japanese url to spanish',
    text: 'こんにちは https://muzzsnap.app/ja ❤️',
    target: 'es',
    map: { 'こんにちは': 'Hola' },
    includes: ['Hola', 'https://muzzsnap.app/ja', '❤️'],
    language: 'es'
  },
  {
    name: 'mixed latin to japanese',
    text: 'Hola friend',
    target: 'ja',
    map: { Hola: 'こんにちは', friend: '友達' },
    includes: ['こんにちは', '友達'],
    language: 'ja'
  },
  {
    name: 'slang inside an english sentence to spanish',
    text: 'lol good morning',
    target: 'es',
    map: { 'good morning': 'buenos días' },
    includes: ['jaja', 'buenos días'],
    language: 'es'
  }
];

function scriptedFetch(map, calls) {
  return async (url) => {
    const query = new URL(url).searchParams.get('q');
    calls.push(query);
    const text = map[query];
    if (!text) throw new Error('unexpected segment: ' + query);
    return google(text);
  };
}

test('mixed-language fixtures keep tokens and the target language', async () => {
  for (const fixture of MIXED) {
    resetTranslateRate();
    const calls = [];
    const result = await handleTranslate(req(fixture.text, fixture.target, {
      ip: '203.0.113.40',
      now: 20_000 + fixture.target.length
    }), { fetch: scriptedFetch(fixture.map, calls), env: {} });
    assert.equal(result.status, 200, fixture.name + ' ' + JSON.stringify(result.body));
    for (const bit of fixture.includes) assert.match(result.body.text, new RegExp(bit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), fixture.name);
    assert.equal(matchesTarget(result.body.text, fixture.language), true, fixture.name + ' -> ' + result.body.text);
    for (const query of calls) {
      assert.equal(query.includes(WALLET), false, fixture.name);
      assert.equal(query.includes('http'), false, fixture.name);
      assert.equal(query.includes('@'), false, fixture.name);
      assert.equal(query.includes('sticker'), false, fixture.name);
      assert.equal(query.includes('👋'), false, fixture.name);
    }
  }
});

test('whole-message slang is informal and is not sent upstream', async () => {
  const cases = [
    ['qué onda', 'en', "what's up"],
    ['lol', 'es', 'jaja'],
    ['ありがとう', 'zh-CN', '谢谢'],
    ['草', 'ja', 'ワロタ'],
    ['vale', 'en', 'ok'],
    ['gonna', 'ja', 'するつもり']
  ];
  for (const [text, target, expected] of cases) {
    resetTranslateRate();
    let called = false;
    const result = await handleTranslate(req(text, target, { ip: '203.0.113.41', now: 30_000 }), {
      fetch: async () => { called = true; return google('NOPE'); },
      env: {}
    });
    assert.equal(called, false, text);
    assert.equal(result.status, 200, text);
    assert.equal(result.body.text, expected);
    assert.equal(matchesTarget(result.body.text, target), true, text);
  }
});

test('every slang row is in the target language', () => {
  for (const [phrase, row] of Object.entries(slangTable)) {
    for (const [target, value] of Object.entries(row)) {
      assert.equal(matchesTarget(value, target), true, phrase + ' -> ' + target + ' [' + value + ']');
    }
  }
});

test('source language is detected per segment', () => {
  const parts = segmentMessage('Hola friend 你好 :sticker:the-boss:', 'ja').filter((part) => part.text.trim());
  assert.deepEqual(parts.map((part) => part.lang), ['es', 'en', 'zh-CN', 'und']);
  assert.equal(parts[3].kind, 'keep');
  assert.match(parts[3].text, /sticker/);
  const same = segmentMessage('Good morning', 'en');
  assert.equal(same.every((part) => part.kind === 'keep'), true);
});

test('text already in the target language is returned unchanged', async () => {
  resetTranslateRate();
  let called = false;
  const result = await handleTranslate(req('Good morning', 'en', { ip: '203.0.113.42', now: 40_000 }), {
    fetch: async () => { called = true; return google('SHOULD NOT'); },
    env: {}
  });
  assert.equal(called, false);
  assert.equal(result.status, 200);
  assert.equal(result.body.text, 'Good morning');
});

test('a wrong-language result is retried once and then rejected', async () => {
  resetTranslateRate();
  let n = 0;
  const bad = await handleTranslate(req('Hello friend', 'es', { ip: '203.0.113.43', now: 50_000 }), {
    fetch: async () => { n += 1; return google('This is still English'); },
    env: {}
  });
  assert.ok(n >= 2);
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error, 'wrong_language');
  assert.equal('text' in bad.body, false);
  assert.equal(JSON.stringify(bad.body).includes('This is still English'), false);

  resetTranslateRate();
  let step = 0;
  const fixed = await handleTranslate(req('Hello friend', 'es', { ip: '203.0.113.44', now: 51_000 }), {
    fetch: async () => google(step++ === 0 ? 'This is still English' : 'Hola amigo'),
    env: {}
  });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.text, 'Hola amigo');
  assert.equal(matchesTarget(fixed.body.text, 'es'), true);
});

test('traditional Chinese is retried into simplified Chinese', async () => {
  resetTranslateRate();
  let step = 0;
  const result = await handleTranslate(req('How are you', 'zh-CN', { ip: '203.0.113.45', now: 60_000 }), {
    fetch: async () => google(step++ === 0 ? '你好嗎' : '你好吗'),
    env: {}
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.text, '你好吗');
  assert.equal(matchesTarget(result.body.text, 'zh-CN'), true);
  assert.equal(matchesTarget('你好嗎', 'zh-CN'), false);
});

test('kanji-only output is not accepted as Japanese', async () => {
  resetTranslateRate();
  const bad = await handleTranslate(req('Hello', 'ja', { ip: '203.0.113.46', now: 70_000 }), {
    fetch: async () => google('你好'),
    env: {}
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error, 'wrong_language');
  resetTranslateRate();
  const ok = await handleTranslate(req('Hello', 'ja', { ip: '203.0.113.47', now: 71_000 }), {
    fetch: async () => google('こんにちは'),
    env: {}
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.text, 'こんにちは');
});

test('timeout, offline, and upstream rate limit stay in English error codes', async () => {
  resetTranslateRate();
  const timeout = await handleTranslate(req('Hello', 'es', { ip: '203.0.113.48', now: 80_000 }), {
    fetch: async () => { const err = new Error('aborted'); err.name = 'AbortError'; throw err; },
    env: {}
  });
  assert.equal(timeout.status, 504);
  assert.equal(timeout.body.error, 'timeout');
  assert.equal('text' in timeout.body, false);

  resetTranslateRate();
  const offline = await handleTranslate(req('Hello', 'es', { ip: '203.0.113.49', now: 81_000 }), {
    fetch: async () => { const err = new Error('network down'); err.name = 'TypeError'; throw err; },
    env: {}
  });
  assert.equal(offline.status, 503);
  assert.equal(offline.body.error, 'offline');

  resetTranslateRate();
  const limited = await handleTranslate(req('Hello', 'es', { ip: '203.0.113.50', now: 82_000 }), {
    fetch: async () => ({ ok: false, status: 429, text: async () => '' }),
    env: {}
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal(JSON.stringify(limited.body).includes('Hello'), false);
});

test('provider keys come from env and are not returned', async () => {
  resetTranslateRate();
  const secret = 'test-translate-key-not-a-real-secret';
  let cloud = null;
  const cloudResult = await handleTranslate(req('Hello', 'es', { ip: '203.0.113.51', now: 90_000 }), {
    env: { GOOGLE_TRANSLATE_API_KEY: secret },
    fetch: async (url, init) => {
      cloud = { url, init };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { translations: [{ translatedText: 'Hola' }] } })
      };
    }
  });
  assert.equal(cloudResult.status, 200);
  assert.equal(cloudResult.body.text, 'Hola');
  assert.match(cloud.url, /^https:\/\/translation\.googleapis\.com\/language\/translate\/v2\?key=/);
  assert.match(cloud.url, new RegExp(secret));
  assert.equal(JSON.stringify(cloudResult.body).includes(secret), false);
  assert.equal(cloud.init.method, 'POST');

  resetTranslateRate();
  let deepl = null;
  const deeplKey = 'deepl-test-key:fx';
  const deeplResult = await handleTranslate(req('Hello', 'ja', { ip: '203.0.113.52', now: 91_000 }), {
    env: { DEEPL_API_KEY: deeplKey },
    fetch: async (url, init) => {
      deepl = { url, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ translations: [{ text: 'こんにちは' }] })
      };
    }
  });
  assert.equal(deeplResult.status, 200);
  assert.equal(deeplResult.body.text, 'こんにちは');
  assert.equal(deepl.url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(deepl.body.target_lang, 'JA');
  assert.equal(deepl.body.formality, 'less');
  assert.equal(JSON.stringify(deeplResult.body).includes(deeplKey), false);
});
