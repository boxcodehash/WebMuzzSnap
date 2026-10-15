import { useEffect, useState } from "react";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { normalizeWallet } from "../../shared/constants";
import { bytesToB64, deviceBindingMessage } from "../../shared/envelope";
import { api } from "./api";
import { auth } from "./firebase";
import { loadOrCreateIdentity } from "./idb";
import { replenish } from "./protocol";
import { buildSiweMessage } from "./siwe";
import { humanError } from "./text";
import { ensureMainnet, personalSign, requestAccount, type Eip1193Provider } from "./wallets";

export type SessionStatus = "loading" | "signed-out" | "revoked" | "needs-device" | "ready";

export function useSession() {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [wallet, setWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unsub = auth.onAuthStateChanged((user) => {
      void (async () => {
        if (!user) {
          if (cancelled) return;
          setWallet(null);
          setStatus("signed-out");
          return;
        }
        try {
          const token = await user.getIdTokenResult();
          const current = normalizeWallet(String(token.claims.wallet || ""));
          const allowed = token.claims.muzz === true && current.startsWith("0x");
          if (cancelled) return;
          setWallet(current || null);
          if (!allowed) {
            setStatus("revoked");
            return;
          }
          const identity = await loadOrCreateIdentity(current);
          const remote = await api.getDevice(current);
          if (cancelled) return;
          if (!remote || remote.identityPublicKey !== bytesToB64(identity.edPk)) {
            setStatus("needs-device");
            return;
          }
          await replenish(identity);
          if (!cancelled) setStatus("ready");
        } catch (err) {
          if (cancelled) return;
          setError(humanError(err));
          setStatus("signed-out");
          await signOut(auth).catch(() => undefined);
        }
      })();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  async function signIn(provider: Eip1193Provider) {
    setBusy(true);
    setError(null);
    try {
      await ensureMainnet(provider);
      const address = normalizeWallet(await requestAccount(provider));
      const { nonce } = await api.requestNonce();
      const message = buildSiweMessage(address, nonce);
      const signature = await personalSign(provider, message, address);
      const { token } = await api.verifyLogin(message, signature);
      await signInWithCustomToken(auth, token);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function bind(provider: Eip1193Provider) {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      await ensureMainnet(provider);
      const address = normalizeWallet(await requestAccount(provider));
      if (address !== wallet) throw new Error("Conecta la misma wallet con la que entraste.");
      const identity = await loadOrCreateIdentity(wallet);
      const issuedAt = new Date().toISOString();
      const message = deviceBindingMessage({
        wallet,
        identityPublicKey: bytesToB64(identity.edPk),
        identityX25519PublicKey: bytesToB64(identity.xPk),
        issuedAt,
      });
      const signature = await personalSign(provider, message, address);
      await api.registerDevice({
        identityPublicKey: bytesToB64(identity.edPk),
        identityX25519PublicKey: bytesToB64(identity.xPk),
        bindingMessage: message,
        walletSignature: signature,
      });
      await replenish(identity);
      setStatus("ready");
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    setError(null);
    await signOut(auth);
  }

  return { status, wallet, error, busy, signIn, bind, signOut: endSession, setError };
}
