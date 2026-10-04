export type InnerEnvelope = {
  v: 1;
  messageId: string;
  threadId: string;
  senderWallet: string;
  receiverWallet: string;
  senderIdentityPk: string;
  senderIdentityX25519Pk: string;
  ephPk: string;
  otkId: string;
  otkPk: string;
  nonce: string;
  ciphertext: string;
  signature: string;
};

const FORBIDDEN_FIELDS = ["text", "plaintext", "body", "preview", "content"] as const;

export function signedPayload(env: InnerEnvelope): string {
  return [
    "muzzchat-msg-v1",
    String(env.v),
    env.messageId,
    env.threadId,
    env.senderWallet.toLowerCase(),
    env.receiverWallet.toLowerCase(),
    env.senderIdentityPk,
    env.senderIdentityX25519Pk,
    env.ephPk,
    env.otkId,
    env.otkPk,
    env.nonce,
    env.ciphertext,
  ].join("\n");
}

export function aadPayload(env: InnerEnvelope): string {
  return [
    "muzzchat-aad-v1",
    String(env.v),
    env.messageId,
    env.threadId,
    env.senderWallet.toLowerCase(),
    env.receiverWallet.toLowerCase(),
    env.senderIdentityPk,
    env.senderIdentityX25519Pk,
    env.ephPk,
    env.otkId,
    env.otkPk,
  ].join("\n");
}

export function prekeyPayload(id: string, publicKeyB64: string): string {
  return `muzzchat-prekey-v1|${id}|${publicKeyB64}`;
}

export function deviceBindingMessage(input: {
  wallet: string;
  identityPublicKey: string;
  identityX25519PublicKey: string;
  issuedAt: string;
}): string {
  return [
    "MuzzChat vincula este dispositivo a tu wallet.",
    `Wallet: ${input.wallet.toLowerCase()}`,
    `Ed25519: ${input.identityPublicKey}`,
    `X25519: ${input.identityX25519PublicKey}`,
    `Fecha: ${input.issuedAt}`,
  ].join("\n");
}

export function assertNoPlaintextFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const key of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error("PLAINTEXT_FIELD");
    }
  }
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
