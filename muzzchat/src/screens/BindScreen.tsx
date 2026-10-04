import { useEffect, useState } from "react";
import { usingEmulators } from "../lib/firebase";
import { shortWallet } from "../lib/text";
import { connectWalletConnect, discoverInjectedWallets, type AnnouncedWallet, type Eip1193Provider } from "../lib/wallets";

type Props = {
  wallet: string;
  busy: boolean;
  error: string | null;
  onBind: (provider: Eip1193Provider) => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function BindScreen({ wallet, busy, error, onBind, onSignOut }: Props) {
  const [wallets, setWallets] = useState<AnnouncedWallet[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => discoverInjectedWallets(setWallets), []);

  return (
    <main className="gate">
      <section className="gate-card">
        <p className="eyebrow">{shortWallet(wallet)}</p>
        <h1>Vincula este dispositivo</h1>
        <p className="lede">
          Este navegador crea una identidad Ed25519 que no sale de aquí. Firma con tu wallet para atarla a la dirección.
          Si ya vinculaste otro navegador, esta firma lo sustituye.
        </p>
        {usingEmulators ? <p className="pill">Emulador local</p> : null}
        <div className="wallet-list">
          {wallets.length === 0 ? (
            <p className="muted">No aparece ninguna wallet inyectada. Ábrelo en un navegador con una wallet EIP-6963.</p>
          ) : null}
          {wallets.map((item) => (
            <button key={item.info.uuid} type="button" className="wallet-row" disabled={busy} onClick={() => void onBind(item.provider)}>
              <img src={item.info.icon} alt="" width={36} height={36} />
              <span>
                <strong>Firmar con {item.info.name}</strong>
                <small>Misma wallet de la sesión</small>
              </span>
            </button>
          ))}
          <button
            type="button"
            className="wallet-row"
            disabled={busy || !import.meta.env.VITE_WALLETCONNECT_PROJECT_ID}
            onClick={() => {
            setLocalError(null);
            void connectWalletConnect()
              .then((provider) => onBind(provider))
              .catch((err: unknown) => {
                setLocalError(err instanceof Error ? err.message : "WalletConnect no está disponible.");
              });
          }}
          >
            <span className="wc-mark" aria-hidden="true">WC</span>
            <span>
              <strong>Firmar con WalletConnect</strong>
              <small>Misma wallet de la sesión</small>
            </span>
          </button>
        </div>
        {error || localError ? <p className="error" role="alert">{error || localError}</p> : null}
        <button type="button" className="text-button" onClick={() => void onSignOut()}>
          Cerrar sesión
        </button>
      </section>
    </main>
  );
}
