import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import privateHandler, { privateOp } from '../api/private.js';
import pushHandler, { pushOp } from '../api/push.js';

const apiDir = new URL('../api/', import.meta.url);
const kept = ['private-expire.js', 'private.js', 'push.js', 'session.js', 'translate.js'];

function mockRes() {
  const out = { status: 0, body: null, ended: false };
  return {
    out,
    setHeader() {},
    status(code) {
      out.status = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
    end() {
      out.ended = true;
    }
  };
}

test('Hobby deploy keeps at most 8 functions and the old URLs', () => {
  const files = readdirSync(apiDir).filter((name) => name.endsWith('.js')).sort();
  assert.deepEqual(files, kept);
  assert.ok(files.length <= 8);
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rewrites = new Map(vercel.rewrites.map((row) => [row.source, row.destination]));
  assert.equal(rewrites.get('/api/private-blob'), '/api/private?op=blob');
  assert.equal(rewrites.get('/api/private-blob-read'), '/api/private?op=read');
  assert.equal(rewrites.get('/api/private-blob-ack'), '/api/private?op=ack');
  assert.equal(rewrites.get('/api/private-blob-delete'), '/api/private?op=delete');
  assert.equal(rewrites.get('/api/private-blob-link'), '/api/private?op=link');
  assert.equal(rewrites.get('/api/photo-mailbox'), '/api/private?op=mailbox');
  assert.equal(rewrites.get('/api/wallet-key'), '/api/private?op=key');
  assert.equal(rewrites.get('/api/wallet-key-read'), '/api/private?op=key-read');
  assert.equal(rewrites.get('/api/notify'), '/api/push?op=notify');
  assert.equal(rewrites.get('/api/notify-self'), '/api/push?op=notify-self');
  assert.equal(rewrites.get('/api/register-token'), '/api/push?op=register');
  assert.equal(rewrites.get('/api/push-config'), '/api/push?op=config');
  assert.equal(vercel.crons[0].path, '/api/private-expire');
  assert.equal(vercel.crons[0].schedule, '0 6 * * *');
  assert.equal(rewrites.has('/api/private-expire'), false);
  const serverNames = readdirSync(new URL('../server/', import.meta.url));
  assert.equal(serverNames.some((name) => name.startsWith('api')), false);
});

test('routers dispatch on op and leave the daily expire file alone', async () => {
  assert.equal(privateOp({ url: '/api/private?op=ack' }), 'ack');
  assert.equal(privateOp({ query: { op: 'mailbox' }, url: '/api/private' }), 'mailbox');
  assert.equal(pushOp({ url: '/api/push?op=notify-self' }), 'notify-self');
  const missing = mockRes();
  await privateHandler({ method: 'POST', url: '/api/private', headers: {}, query: {} }, missing);
  assert.equal(missing.out.status, 404);
  const preflight = mockRes();
  await pushHandler({ method: 'OPTIONS', url: '/api/push?op=notify', headers: {} }, preflight);
  assert.equal(preflight.out.status, 204);
  const config = mockRes();
  await pushHandler({ method: 'GET', url: '/api/push?op=config', headers: {} }, config);
  assert.equal(config.out.status, 200);
  assert.equal(typeof config.out.body.vapidKey, 'string');
  const expire = readFileSync(new URL('../api/private-expire.js', import.meta.url), 'utf8');
  assert.match(expire, /handlePrivateExpire/);
});
