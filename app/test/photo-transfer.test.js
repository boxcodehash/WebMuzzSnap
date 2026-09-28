import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const alice = '0x' + 'aa'.repeat(20);
const bob = '0x' + 'bb'.repeat(20);

function bootTransfer() {
  const src = readFileSync(new URL('../www/js/photo-transfer.js', import.meta.url), 'utf8');
  let mailboxCalls = 0;
  const sandbox = {
    crypto: globalThis.crypto,
    atob,
    btoa,
    console,
    CustomEvent: class CustomEvent {},
    MuzzE2EE: {
      preparePhoto: async () => ({
        iv: 'aXY=',
        ct: Buffer.from('photo-bytes').toString('base64'),
        from: alice,
        to: bob,
        fromPub: 'A'.repeat(80),
        toPub: 'B'.repeat(80)
      }),
      uploadMailbox: async (box) => {
        mailboxCalls += 1;
        return { v: 1, kind: 'photo', id: 'server' + mailboxCalls, iv: box.iv, fromPub: box.fromPub, toPub: box.toPub };
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: 'photo-transfer.js' });
  sandbox.mailboxCalls = () => mailboxCalls;
  return sandbox;
}

test('offline photos use the mailbox, and a failed direct link falls back to it', async () => {
  const page = bootTransfer();
  const client = readFileSync(new URL('../www/js/photo-transfer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /BLOB_READ_WRITE_TOKEN|BEGIN PRIVATE KEY|turn:/i);
  assert.match(client, /stun:stun\.l\.google\.com:19302/);
  const offline = await page.MuzzTransfer.send({
    me: alice,
    peer: bob,
    bytes: new Uint8Array([1, 2, 3]),
    online: false
  });
  assert.equal(offline.via, 'mailbox');
  assert.equal(page.mailboxCalls(), 1);

  page.MuzzTransfer.directSend = async () => {
    throw Object.assign(new Error('timeout'), { code: 'timeout' });
  };
  const fallback = await page.MuzzTransfer.send({
    me: alice,
    peer: bob,
    bytes: new Uint8Array([1]),
    online: true,
    db: {}
  });
  assert.equal(fallback.via, 'mailbox');
  assert.equal(page.mailboxCalls(), 2);

  page.MuzzTransfer.directSend = async () => ({ via: 'direct' });
  const live = await page.MuzzTransfer.send({
    me: alice,
    peer: bob,
    bytes: new Uint8Array([9]),
    online: true,
    db: {}
  });
  assert.equal(live.via, 'direct');
  assert.equal(page.mailboxCalls(), 2);
  const saved = await page.MuzzTransfer.readLocal(live.id);
  assert.equal(Buffer.from(saved.ct, 'base64').toString(), 'photo-bytes');
  const listed = await page.MuzzTransfer.listLocal();
  assert.equal(listed.some((row) => row.id === live.id), true);
  const chat = readFileSync(new URL('../www/private.html', import.meta.url), 'utf8');
  assert.match(chat, /listLocal/);
  assert.match(chat, /via === 'direct'/);
  assert.match(chat, />Auto delete 24hr</);
  assert.doesNotMatch(chat, />\s*Verify\b|safety number|safety-number/i);
  const rules = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  assert.match(rules, /photoMailbox/);
  assert.match(rules, /privateSignal/);
  assert.match(rules, /privateBlobs/);
  assert.match(rules, /"\.read": false/);
});
