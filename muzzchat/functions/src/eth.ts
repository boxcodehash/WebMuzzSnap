import { getAddress, hashMessage, Interface, verifyMessage } from "ethers";
import { MUZZ_TOKEN_ADDRESS } from "../../shared/constants";

const ERC20 = new Interface(["function balanceOf(address) view returns (uint256)"]);
const ERC1271 = new Interface([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
const EIP1271_MAGIC = "0x1626ba7e";

export class EthConfigError extends Error {}
export class EthRpcError extends Error {}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const url = process.env.ETH_RPC_URL?.trim();
  if (!url) throw new EthConfigError("ETH_RPC_URL missing");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new EthRpcError("RPC unreachable");
  }
  if (!response.ok) throw new EthRpcError("RPC status");
  const json = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new EthRpcError("RPC error");
  return json.result;
}

async function ethCall(to: string, data: string): Promise<string> {
  const result = await rpc("eth_call", [{ to, data }, "latest"]);
  if (typeof result !== "string" || !result.startsWith("0x")) throw new EthRpcError("RPC empty");
  return result;
}

export async function readMuzzBalance(wallet: string): Promise<bigint> {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    const override = process.env.MUZZ_DEV_BALANCE_WEI?.trim();
    if (override) {
      if (!/^\d+$/.test(override)) throw new EthConfigError("MUZZ_DEV_BALANCE_WEI");
      return BigInt(override);
    }
  }
  const token = (process.env.MUZZ_TOKEN_ADDRESS || MUZZ_TOKEN_ADDRESS).trim();
  const data = ERC20.encodeFunctionData("balanceOf", [getAddress(wallet)]);
  const result = await ethCall(token, data);
  const decoded = ERC20.decodeFunctionResult("balanceOf", result);
  return BigInt(decoded[0] as bigint);
}

/**
 * Accepts a normal ECDSA personal_sign or an EIP-1271 contract wallet.
 * The hash passed to isValidSignature is the EIP-191 digest of the message.
 */
export async function verifyWalletSignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  let checksum: string;
  try {
    checksum = getAddress(address);
  } catch {
    return false;
  }
  try {
    const recovered = verifyMessage(message, signature);
    if (recovered.toLowerCase() === checksum.toLowerCase()) return true;
  } catch {
    // Contract wallets often produce signatures that are not raw ECDSA.
  }
  try {
    const hash = hashMessage(message);
    const data = ERC1271.encodeFunctionData("isValidSignature", [hash, signature]);
    const result = await ethCall(checksum, data);
    const decoded = ERC1271.decodeFunctionResult("isValidSignature", result);
    return String(decoded[0]).toLowerCase() === EIP1271_MAGIC;
  } catch {
    return false;
  }
}
