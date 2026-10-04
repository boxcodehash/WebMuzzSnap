import { httpsCallable } from "firebase/functions";
import type { InnerEnvelope } from "../../shared/envelope";
import { functions } from "./firebase";

export type RemoteMessage = {
  messageId: string;
  threadId: string;
  senderWallet: string;
  receiverWallet: string;
  createdAt: number;
  readAt: number | null;
  envelope: InnerEnvelope;
};

export type RemoteThread = {
  threadId: string;
  peer: string;
  createdAt: number;
  updatedAt: number;
};

export type DeviceRecord = {
  wallet: string;
  identityPublicKey: string;
  identityX25519PublicKey: string;
  bindingMessage: string;
  walletSignature: string;
  updatedAt: number;
};

export type ClaimedPrekey = {
  identityPublicKey: string;
  identityX25519PublicKey: string;
  bindingMessage: string;
  walletSignature: string;
  prekey: { id: string; publicKey: string; signature: string };
};

async function call<T>(name: string, data?: object): Promise<T> {
  const fn = httpsCallable<unknown, T>(functions, name);
  const result = await fn(data ?? {});
  return result.data;
}

export const api = {
  requestNonce: () => call<{ nonce: string }>("requestNonce"),
  verifyLogin: (message: string, signature: string) => call<{ token: string }>("verifyLogin", { message, signature }),
  registerDevice: (input: {
    identityPublicKey: string;
    identityX25519PublicKey: string;
    bindingMessage: string;
    walletSignature: string;
  }) => call<{ ok: boolean }>("registerDevice", input),
  publishPrekeys: (prekeys: { id: string; publicKey: string; signature: string }[]) =>
    call<{ ok: boolean }>("publishPrekeys", { prekeys }),
  claimPrekey: (wallet: string) => call<ClaimedPrekey>("claimPrekey", { wallet }),
  sendMessage: (input: { messageId: string; threadId: string; receiverWallet: string; envelope: InnerEnvelope }) =>
    call<{ ok: boolean }>("sendMessage", input),
  fetchMessages: (sentSince: number, receivedSince: number) =>
    call<{ messages: RemoteMessage[]; sentSince: number; receivedSince: number }>("fetchMessages", {
      sentSince,
      receivedSince,
    }),
  markRead: (messageId: string) => call<{ readAt: number }>("markRead", { messageId }),
  listThreads: () => call<{ threads: RemoteThread[] }>("listThreads"),
  getDevice: async (wallet: string) => {
    const result = await call<{ device: DeviceRecord | null }>("getDevice", { wallet });
    return result.device;
  },
  prekeyStatus: () => call<{ available: number }>("prekeyStatus"),
};
