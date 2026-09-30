import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Timestamp, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';
const MESSAGE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function hoursFromNow(hours) {
  return Timestamp.fromMillis(Date.now() + hours * 60 * 60 * 1000);
}

function message(sender, recipient, thread) {
  return {
    sender,
    recipient,
    conversationId: thread,
    messageId: MESSAGE,
    ciphertext: 'c'.repeat(48),
    iv: 'iv-value',
    senderEphPub: 'e'.repeat(48),
    senderIdentityPub: 'i'.repeat(48),
    recipientPrekeyId: '11111111-2222-4333-8444-555555555555',
    serverFactorId: `${MESSAGE}_${recipient}`,
    sentAt: Timestamp.now(),
    readAt: null,
    expireAt: hoursFromNow(72)
  };
}

test('reglas de Firestore', { skip: enabled ? false : 'emulador apagado' }, async (t) => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-muzz',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host,
      port: Number(port)
    }
  });
  t.after(async () => env.cleanup());

  const thread = `${A}__${B}`;
  const as = (uid, claims = { muzzAccess: true, wallet: uid }) => env.authenticatedContext(uid, claims).firestore();

  async function allow(uid) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'access', uid), {
        active: true,
        expiresAt: hoursFromNow(1)
      });
    });
  }

  await t.test('sin claim no se lee nada', async () => {
    await env.clearFirestore();
    await allow(A);
    const stranger = env.authenticatedContext(A, { muzzAccess: false, wallet: A }).firestore();
    await assertFails(getDoc(doc(stranger, 'users', A)));
  });

  await t.test('el claim no basta si el acceso está caducado', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'access', A), {
        active: true,
        expiresAt: Timestamp.fromMillis(Date.now() - 1000)
      });
    });
    await assertFails(getDoc(doc(as(A), 'users', B)));
  });

  await t.test('nadie escribe access, nonces ni factores', async () => {
    await env.clearFirestore();
    await allow(A);
    const db = as(A);
    await assertFails(setDoc(doc(db, 'access', A), { active: true, expiresAt: hoursFromNow(1) }));
    await assertFails(setDoc(doc(db, 'nonces', 'ab'.repeat(16)), { used: false }));
    await assertFails(setDoc(doc(db, 'serverFactors', 'x'), { sender: A, recipient: B, factor: 'z' }));
  });

  await t.test('el mensaje privado rechaza texto plano y lo lee solo quien participa', async () => {
    await env.clearFirestore();
    await allow(A);
    await allow(B);
    await allow(C);
    const payload = message(A, B, thread);
    await assertSucceeds(setDoc(doc(as(A), 'privateThreads', thread, 'messages', MESSAGE), payload));
    await assertFails(setDoc(doc(as(A), 'privateThreads', thread, 'messages', 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'), {
      ...message(A, B, thread),
      messageId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      serverFactorId: `bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee_${B}`,
      text: 'en claro'
    }));
    await assertSucceeds(getDoc(doc(as(B), 'privateThreads', thread, 'messages', MESSAGE)));
    await assertFails(getDoc(doc(as(C), 'privateThreads', thread, 'messages', MESSAGE)));
    await assertFails(updateDoc(doc(as(A), 'privateThreads', thread, 'messages', MESSAGE), {
      readAt: Timestamp.now(),
      expireAt: hoursFromNow(24)
    }));
    await assertSucceeds(updateDoc(doc(as(B), 'privateThreads', thread, 'messages', MESSAGE), {
      readAt: Timestamp.now(),
      expireAt: hoursFromNow(24)
    }));
  });

  await t.test('el receptor del grupo marca la lectura; el emisor no alarga su copia', async () => {
    await env.clearFirestore();
    await allow(A);
    await allow(B);
    const payload = message(A, B, 'general');
    await assertSucceeds(setDoc(doc(as(A), 'groups', 'general', 'inbox', B, 'messages', MESSAGE), payload));
    await assertFails(getDoc(doc(as(A), 'groups', 'general', 'inbox', B, 'messages', MESSAGE)));
    await assertSucceeds(updateDoc(doc(as(B), 'groups', 'general', 'inbox', B, 'messages', MESSAGE), {
      readAt: Timestamp.now(),
      expireAt: hoursFromNow(24)
    }));
    await assertSucceeds(setDoc(doc(as(A), 'groups', 'general', 'outbox', A, 'messages', MESSAGE), {
      sender: A,
      messageId: MESSAGE,
      conversationId: 'general',
      sentAt: Timestamp.now(),
      expireAt: hoursFromNow(24),
      recipients: [B]
    }));
    await assertFails(setDoc(doc(as(A), 'groups', 'general', 'outbox', A, 'messages', 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee'), {
      sender: A,
      messageId: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      conversationId: 'general',
      sentAt: Timestamp.now(),
      expireAt: hoursFromNow(24),
      recipients: [B],
      text: 'no'
    }));
  });
});
