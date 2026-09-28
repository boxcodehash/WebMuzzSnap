import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('private database rules keep other users out of a conversation', () => {
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  assert.equal(rules.privateBlobs['.read'], false);
  assert.equal(rules.privateBlobs['.write'], false);
  assert.match(rules.photoMailbox.$wallet['.read'], /auth\.uid == \$wallet/);
  assert.equal(rules.photoMailbox.$wallet['.write'], false);
  assert.match(rules.privateSignal.$to.$from['.read'], /auth\.uid == \$to \|\| auth\.uid == \$from/);
  assert.match(rules.privateInbox.$thread['.read'], /\$thread\.length === 85/);
  assert.match(rules.privateIndex.$owner['.read'], /auth\.uid == \$owner/);
  assert.match(rules.privateIndex.$owner.$peer['.write'], /auth\.uid == \$owner \|\| auth\.uid == \$peer/);
  assert.match(rules.walletKeys.$wallet['.write'], /auth\.uid == \$wallet/);
  assert.equal(rules.fcmTokens.$wallet['.read'].includes('auth.uid == $wallet'), true);
  assert.equal(rules.notifyRate['.read'], false);
  assert.equal(rules.loginNonces['.write'], false);
  const firebase = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.equal(firebase.database, undefined);
});
