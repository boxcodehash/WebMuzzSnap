import { verifyMessage } from "ethers";
import { PREKEY_LOW_WATER, PREKEY_TARGET } from "../../shared/constants";
import { b64ToBytes, bytesToB64, randomId } from "../../shared/envelope";
import { localCopyDueForDeletion } from "../../shared/purge";
import { api, type RemoteMessage } from "./api";
import { encryptMessage, generatePrekey, openMessage, verifyPrekey, type Identity } from "./crypto";
import { idb, idbSecrets, type LocalMessage, type LocalThread } from "./idb";

const senderDevices = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function publishPending(): Promise<void> {
  const pending = (await idb.allPrekeys()).filter((row) => !row.published && !row.consumed && row.privateKey);
  if (!pending.length) return;
  await api.publishPrekeys(pending.map((row) => ({ id: row.id, publicKey: row.publicKey, signature: row.signature })));
  await idb.markPrekeysPublished(pending.map((row) => row.id));
}

export function replenish(identity: Identity, floor = PREKEY_LOW_WATER): Promise<number> {
  return enqueue(async () => {
    await publishPending();
    const live = (await idb.allPrekeys()).filter((row) => !row.consumed);
    if (live.length >= floor) return live.length;
    const need = PREKEY_TARGET - live.length;
    const fresh = [];
    for (let i = 0; i < need; i++) fresh.push(await generatePrekey(identity));
    for (const prekey of fresh) {
      await idb.savePrekey({
        id: prekey.id,
        publicKey: bytesToB64(prekey.publicKey),
        privateKey: bytesToB64(prekey.privateKey),
        signature: bytesToB64(prekey.signature),
        published: false,
        consumed: false,
      });
      prekey.privateKey.fill(0);
    }
    await publishPending();
    return (await idb.allPrekeys()).filter((row) => !row.consumed && row.published).length;
  });
}

function assertRecipientBinding(input: {
  peer: string;
  bindingMessage: string;
  walletSignature: string;
  identityPublicKey: string;
  identityX25519PublicKey: string;
}) {
  const bound =
    input.bindingMessage.toLowerCase().includes(input.peer) &&
    input.bindingMessage.includes(input.identityPublicKey) &&
    input.bindingMessage.includes(input.identityX25519PublicKey);
  if (!bound) throw new Error("La identidad del destinatario no está vinculada a su wallet.");
  const eoa = /^0x[0-9a-fA-F]{130}$/.test(input.walletSignature);
  if (!eoa) return;
  const recovered = verifyMessage(input.bindingMessage, input.walletSignature);
  if (recovered.toLowerCase() !== input.peer) {
    throw new Error("La firma de la wallet del destinatario no coincide.");
  }
}

export async function sendText(input: {
  identity: Identity;
  senderWallet: string;
  peer: string;
  threadId: string;
  text: string;
}): Promise<LocalMessage> {
  const claim = await api.claimPrekey(input.peer);
  assertRecipientBinding({
    peer: input.peer,
    bindingMessage: claim.bindingMessage,
    walletSignature: claim.walletSignature,
    identityPublicKey: claim.identityPublicKey,
    identityX25519PublicKey: claim.identityX25519PublicKey,
  });
  const receiverPk = b64ToBytes(claim.identityPublicKey);
  const otkPk = b64ToBytes(claim.prekey.publicKey);
  const otkSig = b64ToBytes(claim.prekey.signature);
  if (!(await verifyPrekey(receiverPk, claim.prekey.id, otkPk, otkSig))) {
    throw new Error("La clave de un solo uso del destinatario no es válida.");
  }
  const messageId = randomId();
  const envelope = await encryptMessage({
    messageId,
    threadId: input.threadId,
    senderWallet: input.senderWallet,
    receiverWallet: input.peer,
    sender: input.identity,
    receiverIdentityPk: receiverPk,
    otk: { id: claim.prekey.id, publicKey: otkPk, signature: otkSig },
    plaintext: input.text,
  });
  const local: LocalMessage = {
    messageId,
    threadId: input.threadId,
    senderWallet: input.senderWallet,
    receiverWallet: input.peer,
    plaintext: input.text,
    createdAt: Date.now(),
    readAt: null,
    pending: true,
    kind: "ok",
  };
  await idb.saveMessage(local);
  await idb.saveThread({ threadId: input.threadId, peer: input.peer, updatedAt: local.createdAt });
  try {
    await api.sendMessage({ messageId, threadId: input.threadId, receiverWallet: input.peer, envelope });
  } catch (error) {
    await idb.deleteMessage(messageId);
    throw error;
  }
  const saved = { ...local, pending: false };
  await idb.saveMessage(saved);
  return saved;
}

async function rememberThread(message: RemoteMessage, myWallet: string) {
  const peer = message.senderWallet === myWallet ? message.receiverWallet : message.senderWallet;
  const current = (await idb.allThreads()).find((thread) => thread.threadId === message.threadId);
  const updatedAt = Math.max(current?.updatedAt ?? 0, message.createdAt);
  await idb.saveThread({ threadId: message.threadId, peer, updatedAt });
}

export async function syncInbox(myWallet: string): Promise<void> {
  const sentSince = await idb.getNumber(`cursor:sent:${myWallet}`);
  const receivedSince = await idb.getNumber(`cursor:recv:${myWallet}`);
  const page = await api.fetchMessages(sentSince, receivedSince);
  const messages = page.messages;
  for (const message of messages) {
    await rememberThread(message, myWallet);
    const existing = await idb.getMessage(message.messageId);
    if (existing) {
      if (message.readAt != null && existing.readAt == null) await idb.setReadAt(message.messageId, message.readAt);
      continue;
    }
    const base: LocalMessage = {
      messageId: message.messageId,
      threadId: message.threadId,
      senderWallet: message.senderWallet,
      receiverWallet: message.receiverWallet,
      plaintext: null,
      createdAt: message.createdAt,
      readAt: message.readAt,
      pending: false,
      kind: "ok",
    };
    if (message.senderWallet === myWallet) {
      await idb.saveMessage({ ...base, kind: "other-session" });
      continue;
    }
    try {
      let registered = senderDevices.get(message.senderWallet);
      if (!registered) {
        const device = await api.getDevice(message.senderWallet);
        if (!device) throw new Error("SENDER_DEVICE");
        registered = device.identityPublicKey;
        senderDevices.set(message.senderWallet, registered);
      }
      if (message.envelope.senderIdentityPk !== registered) throw new Error("SENDER_DEVICE");
      const plaintext = await openMessage(idbSecrets, message.envelope);
      await idb.saveMessage({ ...base, plaintext, kind: "ok" });
    } catch {
      await idb.saveMessage({ ...base, kind: "failed" });
    }
  }
  if (page.sentSince > sentSince) await idb.setNumber(`cursor:sent:${myWallet}`, page.sentSince);
  if (page.receivedSince > receivedSince) await idb.setNumber(`cursor:recv:${myWallet}`, page.receivedSince);
}

export async function markThreadRead(threadId: string, myWallet: string): Promise<void> {
  const messages = (await idb.allMessages()).filter((message) => message.threadId === threadId);
  for (const message of messages) {
    if (message.receiverWallet !== myWallet || message.readAt != null || message.kind !== "ok" || message.pending) continue;
    const { readAt } = await api.markRead(message.messageId);
    await idb.setReadAt(message.messageId, readAt);
  }
}

export async function purgeLocal(now = Date.now()): Promise<void> {
  const messages = await idb.allMessages();
  for (const message of messages) {
    if (localCopyDueForDeletion(message, now)) await idb.deleteMessage(message.messageId);
  }
}

export async function loadChat(): Promise<{ threads: LocalThread[]; messages: LocalMessage[] }> {
  const [threads, messages] = await Promise.all([idb.allThreads(), idb.allMessages()]);
  threads.sort((a, b) => b.updatedAt - a.updatedAt);
  return { threads, messages };
}
