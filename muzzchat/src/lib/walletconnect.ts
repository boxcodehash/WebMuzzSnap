import type { Eip1193Provider } from "./wallets";

export async function connectWalletConnectProvider(projectId: string, origin: string): Promise<Eip1193Provider> {
  const imported = await import("@walletconnect/ethereum-provider");
  const provider = await imported.default.init({
    projectId,
    showQrModal: true,
    optionalChains: [1],
    metadata: {
      name: "MuzzChat",
      description: "Mensajería cifrada para holders de MUZZ",
      url: origin,
      icons: [`${origin}/favicon.svg`],
    },
  });
  await provider.connect();
  return provider as unknown as Eip1193Provider;
}
