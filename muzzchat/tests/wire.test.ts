import { readFileSync } from "node:fs";
import { getAddress } from "ethers";
import { describe, expect, it } from "vitest";
import { SiweMessage } from "siwe";
import { bytesToB64, prekeyPayload } from "../shared/envelope";
import { verifyEd25519 } from "../shared/ed25519";
import { parseSiweMessage } from "../shared/siweParse";
import { generateIdentity, generatePrekey } from "../src/lib/crypto";

describe("wire formats", () => {
  it("parses the SIWE message the client asks the wallet to sign", () => {
    const address = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const prepared = new SiweMessage({
      domain: "localhost:5173",
      address,
      statement: "Entra a MuzzChat. Comprobaremos tu saldo de MUZZ en Ethereum.",
      uri: "http://localhost:5173",
      version: "1",
      chainId: 1,
      nonce: "ab".repeat(16),
      issuedAt: "2026-09-25T12:00:00.000Z",
    }).prepareMessage();
    const parsed = parseSiweMessage(prepared);
    expect(parsed.domain).toBe("localhost:5173");
    expect(parsed.chainId).toBe(1);
    expect(parsed.nonce).toBe("ab".repeat(16));
    expect(parsed.statement).toContain("MuzzChat");
    expect(parsed.address.toLowerCase()).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("verifies libsodium Ed25519 signatures with the server implementation", async () => {
    const identity = await generateIdentity();
    const prekey = await generatePrekey(identity);
    const payload = new TextEncoder().encode(prekeyPayload(prekey.id, bytesToB64(prekey.publicKey)));
    expect(verifyEd25519(identity.edPk, payload, prekey.signature)).toBe(true);
    payload[0] = payload[0]! ^ 1;
    expect(verifyEd25519(identity.edPk, payload, prekey.signature)).toBe(false);
  });

  it("does not point Firebase at pulsari", () => {
    const rc = readFileSync(new URL("../.firebaserc", import.meta.url), "utf8");
    const clientEnv = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    expect(rc).not.toContain("pulsari");
    expect(clientEnv).not.toContain("pulsari");
    expect(rc).toContain("demo-muzzchat");
  });
});
