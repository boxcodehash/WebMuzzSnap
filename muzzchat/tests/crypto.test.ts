import { describe, expect, it } from "vitest";
import { b64ToBytes, bytesToB64, randomId } from "../shared/envelope";
import {
  decryptMessage,
  encryptMessage,
  generateIdentity,
  generatePrekey,
  MemoryPrekeys,
  openMessage,
} from "../src/lib/crypto";

const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function fixture(plaintext = "hola muzz") {
  const alice = await generateIdentity();
  const bob = await generateIdentity();
  const otk = await generatePrekey(bob);
  const envelope = await encryptMessage({
    messageId: randomId(),
    threadId: randomId(),
    senderWallet: ALICE,
    receiverWallet: BOB,
    sender: alice,
    receiverIdentityPk: bob.edPk,
    otk,
    plaintext,
  });
  return { alice, bob, otk, envelope, plaintext };
}

describe("e2ee", () => {
  it("roundtrips a message with ephemeral, one-time, and identity DH", async () => {
    const { otk, envelope, plaintext } = await fixture("los tres claves abren esto");
    const plain = await decryptMessage(envelope, otk.privateKey);
    expect(plain).toBe("los tres claves abren esto");
    expect(envelope.ciphertext).not.toContain(plaintext);
    expect(envelope.v).toBe(1);
  });

  it("rejects a tampered ciphertext", async () => {
    const { otk, envelope } = await fixture();
    const bytes = b64ToBytes(envelope.ciphertext);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    envelope.ciphertext = bytesToB64(bytes);
    await expect(decryptMessage(envelope, otk.privateKey)).rejects.toThrow(/BAD_SIGNATURE|DECRYPT_FAILED/);
  });

  it("rejects the wrong one-time private key", async () => {
    const { bob, envelope } = await fixture();
    const other = await generatePrekey(bob);
    await expect(decryptMessage(envelope, other.privateKey)).rejects.toThrow("DECRYPT_FAILED");
  });

  it("deletes the one-time private key and refuses reuse", async () => {
    const { otk, envelope } = await fixture("una sola vez");
    const store = new MemoryPrekeys();
    store.add(otk.id, otk.privateKey);

    await expect(openMessage(store, envelope)).resolves.toBe("una sola vez");
    expect(store.has(otk.id)).toBe(false);
    await expect(openMessage(store, envelope)).rejects.toThrow("PREKEY_REUSE");
  });
});
