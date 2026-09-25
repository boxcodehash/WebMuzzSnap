import { useEffect, useState } from "react";
import { usingEmulators } from "../lib/firebase";
import { connectWalletConnect, discoverInjectedWallets, type AnnouncedWallet, type Eip1193Provider } from "../lib/wallets";

type Props = {
  busy: boolean;
  error: string | null;
  onConnect: (provider: Eip1193Provider) => Promise<void>;
};

export function LoginScreen({ busy, error, onConnect }: Props) {
  const [wallets, setWallets] = useState<AnnouncedWallet[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

  useEffect(() => discoverInjectedWallets(setWallets), []);

  async function connect(provider: Eip1193Provider) {
    setLocalError(null);
    try {
      await onConnect(provider);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "No se pudo conectar.");
    }
  }

  return (
    <main className="gate">
      <section className="gate-card">
        <p className="eyebrow">Holders de MUZZ</p>
        <h1>MuzzChat</h1>
        <p className="lede">
          Mensajes cifrados de extremo a extremo. Hace falta una wallet en Ethereum con al menos 10 millones de MUZZ.
        </p>
        {usingEmulators ? <p className="pill">Emulador local</p> : null}
        <div className="wallet-list" role="list">
          {wallets.length === 0 ? (
            <p className="muted">No aparece ninguna wallet inyectada. Abre esta página en un navegador con MetaMask u otra wallet EIP-6963.</p>
          ) : (
            wallets.map((wallet) => (
              <button
                key={wallet.info.uuid}
                type="button"
                className="wallet-row"
                disabled={busy}
                onClick={() => void connect(wallet.provider)}
              >
                <img src={wallet.info.icon} alt="" width={36} height={36} />
                <span>
                  <strong>{wallet.info.name}</strong>
                  <small>EIP-6963</small>
                </span>
              </button>
            ))
          )}
          <button
            type="button"
            className="wallet-row"
            disabled={busy || !projectId}
            onClick={() => void connectWalletConnect().then(connect).catch((err: unknown) => {
              setLocalError(err instanceof Error ? err.message : "WalletConnect no está disponible.");
            })}
          >
            <span className="wc-mark" aria-hidden="true">WC</span>
            <span>
              <strong>WalletConnect</strong>
              <small>{projectId ? "Código QR" : "Falta VITE_WALLETCONNECT_PROJECT_ID"}</small>
            </span>
          </button>
        </div>
        {error || localError ? <p className="error" role="alert">{error || localError}</p> : null}
        <p className="fine">
          Firmar el acceso no gasta gas. El servidor comprueba la firma, el saldo y entrega una sesión. El texto de los
          mensajes no sale de los dispositivos.
        </p>
      </section>
    </main>
  );
}
