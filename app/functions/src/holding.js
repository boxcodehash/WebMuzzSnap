import { ethers } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

/** Lectura on-chain que usa verifyAccess. No decide el acceso por sí sola. */
export async function readHolding({ rpcUrl, chainId, tokenAddress, address }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [balance, decimals] = await Promise.all([
    contract.balanceOf(address),
    contract.decimals()
  ]);
  return { balance, decimals: Number(decimals) };
}
