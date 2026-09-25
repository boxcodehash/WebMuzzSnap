import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decryptFile,
  encryptFile,
  exportPublicSpki,
  fromB64,
  generateEcdhKeyPair,
  generateSigningKeyPair,
  messageAad,
  open,
  randomBytes,
  seal,
  signPrekey,
  toB64,
  verifyPrekey
} from '../src/crypto.js';

async function pair() {
  const ecdh = await generateEcdhKeyPair();
  const signing = await generateSigningKeyPair();
  return {
    ecdh,
    signing,
    identityPub: await exportPublicSpki(ecdh.publicKey),
    signingPub: await exportPublicSpki(signing.publicKey)
  };
}

function meta(over = {}) {
  return {
    conversationId: '0xaaa__0xbbb',
    messageId: '11111111-2222-4333-8444-555555555555',
    sender: '0xaaa',
    recipient: '0xbbb',
    serverFactorId: '11111111-2222-4333-8444-555555555555_0xbbb',
    ...over
  };
}

test('tres factores: ida y vuelta, y el texto no viaja en claro', async () => {
  const sender = await pair();
  const recipient = await generateEcdhKeyPair();
  const factor = randomBytes(32);
  const aad = messageAad(meta());
  const text = new TextEncoder().encode('hola, mensaje secreto 🔐');
  const sealed = await seal({
    senderIdentityPrivate: sender.ecdh.privateKey,
    recipientPrekeyPublic: recipient.publicKey,
    serverFactor: factor,
    plaintext: text,
    aad
  });
  const packed = JSON.stringify(sealed);
  assert.equal(packed.includes('hola'), false);
  assert.equal(packed.includes(toB64(factor)), false);
  const opened = await open({
    senderEphPub: sealed.senderEphPub,
    senderIdentityPublic: sender.identityPub,
    recipientPrekeyPrivate: recipient.privateKey,
    serverFactor: factor,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    aad
  });
  assert.equal(new TextDecoder().decode(opened), 'hola, mensaje secreto 🔐');
});

test('sin el factor del servidor no se abre', async () => {
  const sender = await pair();
  const recipient = await generateEcdhKeyPair();
  const aad = messageAad(meta());
  const sealed = await seal({
    senderIdentityPrivate: sender.ecdh.privateKey,
    recipientPrekeyPublic: recipient.publicKey,
    serverFactor: randomBytes(32),
    plaintext: new TextEncoder().encode('secreto'),
    aad
  });
  await assert.rejects(() => open({
    senderEphPub: sealed.senderEphPub,
    senderIdentityPublic: sender.identityPub,
    recipientPrekeyPrivate: recipient.privateKey,
    serverFactor: randomBytes(32),
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    aad
  }));
});

test('el servidor, con factor y claves públicas, no puede descifrar', async () => {
  const sender = await pair();
  const recipient = await generateEcdhKeyPair();
  const factor = randomBytes(32);
  const aad = messageAad(meta());
  const sealed = await seal({
    senderIdentityPrivate: sender.ecdh.privateKey,
    recipientPrekeyPublic: recipient.publicKey,
    serverFactor: factor,
    plaintext: new TextEncoder().encode('no leas esto'),
    aad
  });
  const intruso = await generateEcdhKeyPair();
  await assert.rejects(() => open({
    senderEphPub: sealed.senderEphPub,
    senderIdentityPublic: sender.identityPub,
    recipientPrekeyPrivate: intruso.privateKey,
    serverFactor: factor,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    aad
  }));
});

test('otra prekey o otro contexto fallan, y cada mensaje trae efímera nueva', async () => {
  const sender = await pair();
  const prekeyA = await generateEcdhKeyPair();
  const prekeyB = await generateEcdhKeyPair();
  const factor = randomBytes(32);
  const aad = messageAad(meta());
  const sealWith = (publicKey) => seal({
    senderIdentityPrivate: sender.ecdh.privateKey,
    recipientPrekeyPublic: publicKey,
    serverFactor: factor,
    plaintext: new TextEncoder().encode('uno'),
    aad
  });
  const first = await sealWith(prekeyA.publicKey);
  const second = await sealWith(prekeyA.publicKey);
  assert.notEqual(first.senderEphPub, second.senderEphPub);
  await assert.rejects(() => open({
    senderEphPub: first.senderEphPub,
    senderIdentityPublic: sender.identityPub,
    recipientPrekeyPrivate: prekeyB.privateKey,
    serverFactor: factor,
    ciphertext: first.ciphertext,
    iv: first.iv,
    aad
  }));
  await assert.rejects(() => open({
    senderEphPub: first.senderEphPub,
    senderIdentityPublic: sender.identityPub,
    recipientPrekeyPrivate: prekeyA.privateKey,
    serverFactor: factor,
    ciphertext: first.ciphertext,
    iv: first.iv,
    aad: messageAad(meta({ conversationId: 'otra' }))
  }));
  const flipped = fromB64(first.ciphertext);
  flipped[0] ^= 0xff;
  await assert.rejects(() => open({
    senderEphPub: first.senderEphPub,
    senderIdentityPublic: sender.identityPub,
    recipientPrekeyPrivate: prekeyA.privateKey,
    serverFactor: factor,
    ciphertext: toB64(flipped),
    iv: first.iv,
    aad
  }));
});

test('la privada ECDH no se puede exportar y la prekey va firmada', async () => {
  const sender = await pair();
  await assert.rejects(() => crypto.subtle.exportKey('pkcs8', sender.ecdh.privateKey));
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const pub = await exportPublicSpki((await generateEcdhKeyPair()).publicKey);
  const sig = await signPrekey(sender.signing.privateKey, id, pub);
  assert.equal(await verifyPrekey(sender.signingPub, id, pub, sig), true);
  assert.equal(await verifyPrekey(sender.signingPub, id, `${pub}x`, sig), false);
});

test('el adjunto se cifra con una llave que no es la del servidor', async () => {
  const bytes = new TextEncoder().encode('archivo secreto');
  const sealed = await encryptFile(bytes);
  assert.equal(Buffer.from(sealed.ciphertext).includes('archivo secreto'), false);
  const opened = await decryptFile(sealed.ciphertext, sealed.keyB64, sealed.ivB64);
  assert.equal(new TextDecoder().decode(opened), 'archivo secreto');
  await assert.rejects(() => decryptFile(sealed.ciphertext, toB64(randomBytes(32)), sealed.ivB64));
});
