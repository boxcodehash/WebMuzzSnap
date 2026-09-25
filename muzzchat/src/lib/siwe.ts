import { getAddress } from "ethers";
import { SiweMessage } from "siwe";

export function buildSiweMessage(address: string, nonce: string): string {
  return new SiweMessage({
    domain: window.location.host,
    address: getAddress(address),
    statement: "Entra a MuzzChat. Comprobaremos tu saldo de MUZZ en Ethereum.",
    uri: window.location.origin,
    version: "1",
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();
}
