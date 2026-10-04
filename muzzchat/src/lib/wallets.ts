import { hexlify, toUtf8Bytes } from "ethers";

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  connect?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
};

export type AnnouncedWallet = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

export function discoverInjectedWallets(onChange: (wallets: AnnouncedWallet[]) => void): () => void {
  const found = new Map<string, AnnouncedWallet>();
  const emit = () => onChange([...found.values()]);
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<AnnouncedWallet>).detail;
    if (!detail?.info?.uuid || !detail.provider) return;
    found.set(detail.info.uuid, detail);
    emit();
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
}

export async function requestAccount(provider: Eip1193Provider): Promise<string> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("La wallet no devolvió una cuenta.");
  }
  return accounts[0];
}

export async function ensureMainnet(provider: Eip1193Provider): Promise<void> {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId === "0x1") return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
  } catch {
    throw new Error("Cambia la wallet a Ethereum mainnet. MUZZ vive en esa red.");
  }
}

export async function personalSign(provider: Eip1193Provider, message: string, address: string): Promise<string> {
  const hex = hexlify(toUtf8Bytes(message));
  const signature = await provider.request({ method: "personal_sign", params: [hex, address] });
  if (typeof signature !== "string" || !signature.startsWith("0x")) throw new Error("La wallet no firmó el mensaje.");
  return signature;
}

export async function connectWalletConnect(): Promise<Eip1193Provider> {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("Falta VITE_WALLETCONNECT_PROJECT_ID para usar WalletConnect.");
  }
  const { connectWalletConnectProvider } = await import("./walletconnect");
  return connectWalletConnectProvider(projectId, window.location.origin);
}
