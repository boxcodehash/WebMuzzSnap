import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { guessSource, handleTranslate, resetTranslateRate } from '../server/translate.js';

function google(text) {
  return { ok: true, text: async () => JSON.stringify([[[text, '', '']]]) };
}

test('translate rejects empty, unknown language, and long text without calling out', async () => {
  resetTranslateRate();
  let called = false;
  const fetchImpl = async () => { called = true; return google('x'); };
  const deps = { fetch: fetchImpl };
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
  const src = readFileSync(new URL('../server/translate.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /console\.(log|info|debug|error|warn)/);
});

test('translate rate limit is per IP and does not include the message', async () => {
  resetTranslateRate();
  const fetchImpl = async () => google('Hello');
  const req = () => handleTranslate({
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9' },
    body: { text: 'Hola', target: 'en' },
    now: 1_000
  }, { fetch: fetchImpl });
  for (let i = 0; i < 20; i += 1) {
    const ok = await req();
    assert.equal(ok.status, 200);
    assert.equal(ok.body.text, 'Hello');
  }
  const limited = await req();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal('text' in limited.body, false);
});

test('es to en, en to zh-CN, zh to ja, and ja to es', async () => {
  resetTranslateRate();
  const cases = [
    ['Buenos días', 'en', /morning|good|hello/i],
    ['Good morning', 'zh-CN', /[\u4e00-\u9fff]/],
    ['你好', 'ja', /[\u3040-\u30ff]/],
    ['こんにちは', 'es', /[A-Za-zÁÉÍÓÚáéíóúñ]/]
  ];
  for (const [text, target, pattern] of cases) {
    const result = await handleTranslate({
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.' + target.length },
      body: { text, target },
      now: 5_000
    });
    assert.equal(result.status, 200, target);
    assert.match(result.body.text, pattern);
    assert.notEqual(result.body.text, text);
  }
});
