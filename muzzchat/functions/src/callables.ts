import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { isRandomId, isWallet, normalizeWallet, PREKEY_MAX_STORED } from "../../shared/constants";
import { hasMuzzAccess, parseMinWhole } from "../../shared/gate";
import {
  assertNoPlaintextFields,
  b64ToBytes,
  deviceBindingMessage,
  type InnerEnvelope,
  prekeyPayload,
  signedPayload,
} from "../../shared/envelope";
import { verifyEd25519 } from "../../shared/ed25519";
import { parseSiweMessage } from "../../shared/siweParse";
import { nextReadAt } from "../../shared/purge";
import { unwrapEnvelope, wrapEnvelope } from "../../shared/wrap";
import "./admin";
import { EthConfigError, EthRpcError, readMuzzBalance, verifyWalletSignature } from "./eth";
import { loadWrapKey } from "./keys";

const REGION = "us-central1";
const callOpts = { region: REGION, timeoutSeconds: 30, memory: "256MiB" as const };

function db(): Firestore {
  return getFirestore();
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function requireMuzz(req: CallableRequest): Promise<{ uid: string; wallet: string }> {
  if (!req.auth) throw new HttpsError("unauthenticated", "Inicia sesión");
  const wallet = normalizeWallet(String(req.auth.token.wallet || ""));
  if (req.auth.token.muzz !== true || !isWallet(wallet) || req.auth.uid !== wallet) {
    throw new HttpsError("permission-denied", "Se requiere saldo MUZZ");
  }
  const holder = await db().collection("holders").doc(wallet).get();
  if (!holder.exists || holder.data()?.muzz !== true) {
    throw new HttpsError("permission-denied", "Acceso revocado");
  }
  return { uid: req.auth.uid, wallet };
}

async function revokeWallet(wallet: string): Promise<void> {
  const ref = db().collection("holders").doc(wallet);
  const snap = await ref.get();
  const uid = (snap.data()?.uid as string | undefined) || wallet;
  try {
    await getAuth().setCustomUserClaims(uid, { wallet, muzz: false });
    await getAuth().revokeRefreshTokens(uid);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") console.error("revoke failed", code || error);
  }
  if (snap.exists) {
    await ref.set({ wallet, uid, muzz: false, revokedAt: Date.now() }, { merge: true });
  }
}

function assertDomain(domain: string): void {
  const raw = process.env.SIWE_ALLOWED_DOMAINS?.trim() ?? "";
  const emulator = process.env.FUNCTIONS_EMULATOR === "true";
  if (!raw) {
    if (emulator) return;
    throw new HttpsError("failed-precondition", "Configura SIWE_ALLOWED_DOMAINS");
  }
  const allowed = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(domain)) throw new HttpsError("permission-denied", "Dominio no permitido");
}

function parseEnvelope(input: unknown): InnerEnvelope {
  if (!input || typeof input !== "object") throw new HttpsError("invalid-argument", "Sobre inválido");
  assertNoPlaintextFields(input);
  const env = input as Partial<InnerEnvelope>;
  if (env.v !== 1) throw new HttpsError("invalid-argument", "Versión de sobre no soportada");
  const messageId = String(env.messageId || "");
  const threadId = String(env.threadId || "");
  const senderWallet = normalizeWallet(String(env.senderWallet || ""));
  const receiverWallet = normalizeWallet(String(env.receiverWallet || ""));
  if (!isRandomId(messageId) || !isRandomId(threadId)) {
    throw new HttpsError("invalid-argument", "Identificador inválido");
  }
  if (!isWallet(senderWallet) || !isWallet(receiverWallet) || senderWallet === receiverWallet) {
    throw new HttpsError("invalid-argument", "Wallets inválidas");
  }
  const envelope: InnerEnvelope = {
    v: 1,
    messageId,
    threadId,
    senderWallet,
    receiverWallet,
    senderIdentityPk: String(env.senderIdentityPk || ""),
    senderIdentityX25519Pk: String(env.senderIdentityX25519Pk || ""),
    ephPk: String(env.ephPk || ""),
    otkId: String(env.otkId || ""),
    otkPk: String(env.otkPk || ""),
    nonce: String(env.nonce || ""),
    ciphertext: String(env.ciphertext || ""),
    signature: String(env.signature || ""),
  };
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  let signature: Uint8Array;
  let senderPk: Uint8Array;
  let senderX: Uint8Array;
  let eph: Uint8Array;
  let otk: Uint8Array;
  try {
    nonce = b64ToBytes(envelope.nonce);
    ciphertext = b64ToBytes(envelope.ciphertext);
    signature = b64ToBytes(envelope.signature);
    senderPk = b64ToBytes(envelope.senderIdentityPk);
    senderX = b64ToBytes(envelope.senderIdentityX25519Pk);
    eph = b64ToBytes(envelope.ephPk);
    otk = b64ToBytes(envelope.otkPk);
  } catch {
    throw new HttpsError("invalid-argument", "Base64 inválido");
  }
  if (
    nonce.length !== 24 ||
    senderPk.length !== 32 ||
    senderX.length !== 32 ||
    eph.length !== 32 ||
    otk.length !== 32 ||
    signature.length !== 64 ||
    !isRandomId(envelope.otkId)
  ) {
    throw new HttpsError("invalid-argument", "Tamaños de clave inválidos");
  }
  if (ciphertext.length < 16 || ciphertext.length > 24_000) {
    throw new HttpsError("invalid-argument", "Cifrado fuera de rango");
  }
  if (!verifyEd25519(senderPk, utf8(signedPayload(envelope)), signature)) {
    throw new HttpsError("permission-denied", "Firma del mensaje inválida");
  }
  return envelope;
}

export const requestNonce = onCall(callOpts, async () => {
  const nonce = randomBytes(16).toString("hex");
  const now = Date.now();
  await db().collection("nonces").doc(nonce).set({
    createdAt: now,
    expiresAt: now + 10 * 60_000,
    used: false,
  });
  return { nonce };
});

export const verifyLogin = onCall(callOpts, async (req) => {
  const message = String(req.data?.message || "");
  const signature = String(req.data?.signature || "");
  if (!message || !signature) throw new HttpsError("invalid-argument", "Faltan el mensaje y la firma");

  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    throw new HttpsError("invalid-argument", "Mensaje SIWE inválido");
  }
  if (parsed.version !== "1") throw new HttpsError("invalid-argument", "Versión SIWE");
  if (parsed.chainId !== 1) throw new HttpsError("failed-precondition", "Usa Ethereum mainnet");
  if (!parsed.statement.includes("MuzzChat")) {
    throw new HttpsError("invalid-argument", "El mensaje SIWE no es de MuzzChat");
  }
  if (!/^[a-f0-9]{32}$/.test(parsed.nonce)) throw new HttpsError("invalid-argument", "Nonce inválido");
  assertDomain(parsed.domain);

  const issued = Date.parse(parsed.issuedAt);
  const now = Date.now();
  if (!Number.isFinite(issued)) throw new HttpsError("invalid-argument", "issuedAt inválido");
  if (issued > now + 60_000) throw new HttpsError("invalid-argument", "El mensaje está fechado en el futuro");
  if (now - issued > 10 * 60_000) throw new HttpsError("deadline-exceeded", "El mensaje SIWE caducó");

  const wallet = normalizeWallet(parsed.address);
  if (!isWallet(wallet)) throw new HttpsError("invalid-argument", "Wallet inválida");

  await db().runTransaction(async (tx) => {
    const ref = db().collection("nonces").doc(parsed.nonce);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("permission-denied", "Nonce desconocido");
    const data = snap.data()!;
    if (data.used === true) throw new HttpsError("permission-denied", "Nonce ya usado");
    if (Number(data.expiresAt) < now) throw new HttpsError("deadline-exceeded", "Nonce caducado");
    tx.update(ref, { used: true, usedBy: wallet, usedAt: now });
  });

  const signed = await verifyWalletSignature(wallet, message, signature);
  if (!signed) throw new HttpsError("permission-denied", "Firma inválida");

  let balance: bigint;
  try {
    balance = await readMuzzBalance(wallet);
  } catch (error) {
    if (error instanceof EthConfigError) {
      throw new HttpsError("failed-precondition", "Falta ETH_RPC_URL para leer el saldo MUZZ.");
    }
    if (error instanceof EthRpcError) {
      throw new HttpsError("unavailable", "No se pudo consultar el saldo MUZZ.");
    }
    throw new HttpsError("unavailable", "No se pudo consultar el saldo MUZZ.");
  }

  let minWhole: bigint;
  try {
    minWhole = parseMinWhole(process.env.MIN_MUZZ_WHOLE);
  } catch {
    throw new HttpsError("failed-precondition", "MIN_MUZZ_WHOLE mal configurado");
  }
  if (!hasMuzzAccess(balance, minWhole)) {
    await revokeWallet(wallet);
    throw new HttpsError("permission-denied", "Saldo MUZZ insuficiente");
  }

  await db().collection("holders").doc(wallet).set(
    { uid: wallet, wallet, muzz: true, updatedAt: now },
    { merge: true },
  );
  const token = await getAuth().createCustomToken(wallet, { wallet, muzz: true });
  return { token };
});

export const registerDevice = onCall(callOpts, async (req) => {
  const { wallet } = await requireMuzz(req);
  const identityPublicKey = String(req.data?.identityPublicKey || "");
  const identityX25519PublicKey = String(req.data?.identityX25519PublicKey || "");
  const bindingMessage = String(req.data?.bindingMessage || "");
  const walletSignature = String(req.data?.walletSignature || "");
  let ed: Uint8Array;
  let x: Uint8Array;
  try {
    ed = b64ToBytes(identityPublicKey);
    x = b64ToBytes(identityX25519PublicKey);
  } catch {
    throw new HttpsError("invalid-argument", "Claves inválidas");
  }
  if (ed.length !== 32 || x.length !== 32) throw new HttpsError("invalid-argument", "Claves inválidas");
  const expected = deviceBindingMessage({
    wallet,
    identityPublicKey,
    identityX25519PublicKey,
    issuedAt: (bindingMessage.match(/^Fecha: (.+)$/m)?.[1] || "").trim(),
  });
  if (bindingMessage !== expected) {
    throw new HttpsError("invalid-argument", "El mensaje de vinculación no coincide");
  }
  const issued = Date.parse(bindingMessage.match(/^Fecha: (.+)$/m)?.[1] || "");
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) {
    throw new HttpsError("deadline-exceeded", "La vinculación caducó. Firma otra vez.");
  }
  const ok = await verifyWalletSignature(wallet, bindingMessage, walletSignature);
  if (!ok) throw new HttpsError("permission-denied", "Firma de vinculación inválida");

  const ref = db().collection("devices").doc(wallet);
  const prev = await ref.get();
  if (prev.exists && prev.data()?.identityPublicKey !== identityPublicKey) {
    const stale = await db().collection("prekeys").doc(wallet).collection("items").where("consumed", "==", false).get();
    const batch = db().batch();
    stale.docs.forEach((doc) => batch.delete(doc.ref));
    if (!stale.empty) await batch.commit();
  }
  await ref.set({
    wallet,
    identityPublicKey,
    identityX25519PublicKey,
    bindingMessage,
    walletSignature,
    updatedAt: Date.now(),
  });
  return { ok: true };
});

export const publishPrekeys = onCall(callOpts, async (req) => {
  const { wallet } = await requireMuzz(req);
  const device = await db().collection("devices").doc(wallet).get();
  if (!device.exists) throw new HttpsError("failed-precondition", "Registra el dispositivo antes de publicar claves");
  const identityPk = String(device.data()?.identityPublicKey || "");
  const list = req.data?.prekeys;
  if (!Array.isArray(list) || list.length === 0 || list.length > 40) {
    throw new HttpsError("invalid-argument", "Lote de claves inválido");
  }
  const unused = await db().collection("prekeys").doc(wallet).collection("items").where("consumed", "==", false).get();
  if (unused.size + list.length > PREKEY_MAX_STORED) {
    throw new HttpsError("resource-exhausted", "Demasiadas claves publicadas");
  }

  const batch = db().batch();
  let writes = 0;
  for (const item of list) {
    const id = String(item?.id || "");
    const publicKey = String(item?.publicKey || "");
    const signature = String(item?.signature || "");
    if (!isRandomId(id)) throw new HttpsError("invalid-argument", "Id de prekey inválido");
    let pk: Uint8Array;
    let sig: Uint8Array;
    try {
      pk = b64ToBytes(publicKey);
      sig = b64ToBytes(signature);
    } catch {
      throw new HttpsError("invalid-argument", "Prekey inválida");
    }
    if (pk.length !== 32 || sig.length !== 64) throw new HttpsError("invalid-argument", "Prekey inválida");
    if (!verifyEd25519(b64ToBytes(identityPk), utf8(prekeyPayload(id, publicKey)), sig)) {
      throw new HttpsError("permission-denied", "Firma de prekey inválida");
    }
    const ref = db().collection("prekeys").doc(wallet).collection("items").doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      const data = existing.data()!;
      if (data.consumed === true) throw new HttpsError("already-exists", "Prekey ya usada");
      if (data.publicKey !== publicKey) throw new HttpsError("already-exists", "Id de prekey repetido");
      continue;
    }
    batch.set(ref, {
      id,
      publicKey,
      signature,
      consumed: false,
      consumedAt: null,
      consumedBy: null,
      createdAt: Date.now(),
    });
    writes += 1;
  }
  if (writes) await batch.commit();
  return { ok: true, stored: writes };
});

export const claimPrekey = onCall(callOpts, async (req) => {
  const { wallet: caller } = await requireMuzz(req);
  const peer = normalizeWallet(String(req.data?.wallet || ""));
  if (!isWallet(peer) || peer === caller) throw new HttpsError("invalid-argument", "Wallet de destino inválida");
  const device = await db().collection("devices").doc(peer).get();
  if (!device.exists) throw new HttpsError("not-found", "Esa wallet no tiene un dispositivo");

  const hour = Math.floor(Date.now() / 3_600_000);
  const claimed = await db().runTransaction(async (tx) => {
    const quotaRef = db().collection("claimQuota").doc(`${caller}_${hour}`);
    const quotaSnap = await tx.get(quotaRef);
    const query = db()
      .collection("prekeys")
      .doc(peer)
      .collection("items")
      .where("consumed", "==", false)
      .limit(1);
    const snap = await tx.get(query);
    const count = quotaSnap.exists ? Number(quotaSnap.data()?.count || 0) : 0;
    if (count >= 40) throw new HttpsError("resource-exhausted", "Demasiadas reclamaciones de claves");
    if (snap.empty) return null;
    const doc = snap.docs[0]!;
    tx.set(quotaRef, {
      count: count + 1,
      wallet: caller,
      hour,
      expiresAt: Date.now() + 48 * 3_600_000,
    });
    tx.update(doc.ref, { consumed: true, consumedAt: Date.now(), consumedBy: caller });
    return { id: doc.id, publicKey: doc.data().publicKey as string, signature: doc.data().signature as string };
  });
  if (!claimed) throw new HttpsError("not-found", "No hay claves de un solo uso. Pide que abran MuzzChat.");

  const data = device.data()!;
  return {
    identityPublicKey: data.identityPublicKey as string,
    identityX25519PublicKey: data.identityX25519PublicKey as string,
    bindingMessage: data.bindingMessage as string,
    walletSignature: data.walletSignature as string,
    prekey: claimed,
  };
});

export const sendMessage = onCall(callOpts, async (req) => {
  const { wallet } = await requireMuzz(req);
  const messageId = String(req.data?.messageId || "");
  const threadId = String(req.data?.threadId || "");
  const receiverWallet = normalizeWallet(String(req.data?.receiverWallet || ""));
  const envelope = parseEnvelope(req.data?.envelope);
  if (envelope.senderWallet !== wallet || envelope.messageId !== messageId || envelope.threadId !== threadId) {
    throw new HttpsError("permission-denied", "El sobre no coincide con el emisor");
  }
  if (envelope.receiverWallet !== receiverWallet) {
    throw new HttpsError("invalid-argument", "Destinatario inválido");
  }
  const device = await db().collection("devices").doc(wallet).get();
  if (!device.exists || device.data()?.identityPublicKey !== envelope.senderIdentityPk) {
    throw new HttpsError("failed-precondition", "La identidad no está vinculada a esta wallet");
  }

  const wrapped = wrapEnvelope(Buffer.from(JSON.stringify(envelope), "utf8"), loadWrapKey());
  const now = Date.now();
  await db().runTransaction(async (tx) => {
    const otkRef = db().collection("prekeys").doc(receiverWallet).collection("items").doc(envelope.otkId);
    const threadRef = db().collection("threads").doc(threadId);
    const msgRef = db().collection("messages").doc(messageId);
    const otkSnap = await tx.get(otkRef);
    const threadSnap = await tx.get(threadRef);
    const msgSnap = await tx.get(msgRef);
    if (msgSnap.exists) throw new HttpsError("already-exists", "Mensaje duplicado");
    if (!otkSnap.exists) throw new HttpsError("failed-precondition", "La clave de un solo uso no existe");
    const otk = otkSnap.data()!;
    if (otk.consumed !== true || otk.consumedBy !== wallet || otk.publicKey !== envelope.otkPk) {
      throw new HttpsError("failed-precondition", "La clave de un solo uso no está reservada para ti");
    }
    const members = [wallet, receiverWallet].sort();
    if (!threadSnap.exists) {
      tx.set(threadRef, { threadId, members, createdAt: now, updatedAt: now });
    } else {
      const existing = (threadSnap.data()?.members || []) as string[];
      if (existing.length !== 2 || !existing.includes(wallet) || !existing.includes(receiverWallet)) {
        throw new HttpsError("permission-denied", "No perteneces a este hilo");
      }
      tx.update(threadRef, { updatedAt: now });
    }
    tx.set(msgRef, {
      messageId,
      threadId,
      senderWallet: wallet,
      receiverWallet,
      iv: wrapped.iv,
      data: wrapped.data,
      createdAt: now,
      readAt: null,
    });
  });
  return { ok: true, messageId, threadId };
});

export const fetchMessages = onCall(callOpts, async (req) => {
  const { wallet } = await requireMuzz(req);
  const sentSince = Number(req.data?.sentSince || 0);
  const receivedSince = Number(req.data?.receivedSince || 0);
  if (![sentSince, receivedSince].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new HttpsError("invalid-argument", "Cursor inválido");
  }
  const key = loadWrapKey();
  const sent = await db()
    .collection("messages")
    .where("senderWallet", "==", wallet)
    .where("createdAt", ">=", sentSince)
    .orderBy("createdAt", "asc")
    .limit(100)
    .get();
  const received = await db()
    .collection("messages")
    .where("receiverWallet", "==", wallet)
    .where("createdAt", ">=", receivedSince)
    .orderBy("createdAt", "asc")
    .limit(100)
    .get();
  const docs = new Map(sent.docs.map((doc) => [doc.id, doc]));
  for (const doc of received.docs) docs.set(doc.id, doc);

  const messages = [];
  for (const doc of docs.values()) {
    const data = doc.data();
    if (data.senderWallet !== wallet && data.receiverWallet !== wallet) continue;
    let envelope: InnerEnvelope;
    try {
      envelope = JSON.parse(unwrapEnvelope(String(data.iv), String(data.data), key).toString("utf8")) as InnerEnvelope;
    } catch {
      continue;
    }
    if (envelope.senderWallet !== data.senderWallet || envelope.receiverWallet !== data.receiverWallet) continue;
    messages.push({
      messageId: data.messageId as string,
      threadId: data.threadId as string,
      senderWallet: data.senderWallet as string,
      receiverWallet: data.receiverWallet as string,
      createdAt: data.createdAt as number,
      readAt: (data.readAt ?? null) as number | null,
      envelope,
    });
  }
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return {
    messages,
    sentSince: sent.empty ? sentSince : Number(sent.docs[sent.docs.length - 1]!.data().createdAt),
    receivedSince: received.empty ? receivedSince : Number(received.docs[received.docs.length - 1]!.data().createdAt),
  };
});

export const markRead = onCall(callOpts, async (req) => {
  const { wallet } = await requireMuzz(req);
  const messageId = String(req.data?.messageId || "");
  if (!isRandomId(messageId)) throw new HttpsError("invalid-argument", "Mensaje inválido");
  const readAt = await db().runTransaction(async (tx) => {
    const ref = db().collection("messages").doc(messageId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Mensaje no encontrado");
    const data = snap.data()!;
    if (data.receiverWallet !== wallet) throw new HttpsError("permission-denied", "Solo quien recibe puede marcar leído");
    const current = (data.readAt ?? null) as number | null;
    const next = nextReadAt(current, Date.now());
    if (current == null) tx.update(ref, { readAt: next });
    return next;
  });
  return { readAt };
});

export const listThreads = onCall(callOpts, async (req) => {
  const { wallet } = await requireMuzz(req);
  const snap = await db().collection("threads").where("members", "array-contains", wallet).get();
  const threads = snap.docs
    .map((doc) => {
      const data = doc.data();
      const members = (data.members || []) as string[];
      return {
        threadId: doc.id,
        peer: members.find((member) => member !== wallet) || "",
        createdAt: data.createdAt as number,
        updatedAt: data.updatedAt as number,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { threads };
});

export const getDevice = onCall(callOpts, async (req) => {
  const { wallet: caller } = await requireMuzz(req);
  const wallet = normalizeWallet(String(req.data?.wallet || caller));
  if (!isWallet(wallet)) throw new HttpsError("invalid-argument", "Wallet inválida");
  const snap = await db().collection("devices").doc(wallet).get();
  if (!snap.exists) return { device: null };
  const data = snap.data()!;
  return {
    device: {
      wallet,
      identityPublicKey: data.identityPublicKey as string,
      identityX25519PublicKey: data.identityX25519PublicKey as string,
      bindingMessage: data.bindingMessage as string,
      walletSignature: data.walletSignature as string,
      updatedAt: data.updatedAt as number,
    },
  };
});

export const prekeyStatus = onCall(callOpts, async (req) => {
  const { wallet } = await requireMuzz(req);
  const snap = await db().collection("prekeys").doc(wallet).collection("items").where("consumed", "==", false).get();
  return { available: snap.size };
});
