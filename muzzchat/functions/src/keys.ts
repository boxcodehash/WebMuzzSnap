import { createHash } from "node:crypto";

const EMULATOR_KEY_MATERIAL = "muzzchat-emulator-only-wrap-key";

/** 32-byte AES-GCM key. The emulator accepts a placeholder; production must set a real key. */
export function loadWrapKey(): Buffer {
  const raw = process.env.SERVER_WRAP_KEY?.trim();
  const emulator = process.env.FUNCTIONS_EMULATOR === "true";
  if (!raw || raw === "replace-me") {
    if (emulator) {
      console.warn("MuzzChat: usando la clave de envoltura solo-emulador. No vale para producción.");
      return createHash("sha256").update(EMULATOR_KEY_MATERIAL).digest();
    }
    throw new Error("SERVER_WRAP_KEY is required");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SERVER_WRAP_KEY must decode to 32 bytes");
  return key;
}
