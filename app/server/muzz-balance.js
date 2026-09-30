export const MUZZ_TOKEN = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';
export const MUZZ_MIN_WHOLE = 10_000_000n;
export const MUZZ_EXEMPT = '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a';

const RPCS = [
  'https://ethereum.publicnode.com',
  'https://eth.drpc.org',
  'https://rpc.ankr.com/eth'
];

function padAddress(address) {
  return String(address || '').toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

async function ethCall(fetchImpl, to, data) {
  let last = 'rpc';
  for (const url of RPCS) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest']
        })
      });
      const json = await res.json();
      if (json && typeof json.result === 'string' && /^0x[0-9a-fA-F]+$/.test(json.result)) return json.result;
      last = (json && json.error && (json.error.message || json.error)) || 'rpc';
    } catch (err) {
      last = err && err.message ? err.message : 'rpc';
    }
  }
  const error = new Error(String(last || 'RPC unreachable'));
  error.code = 'balance_unavailable';
  throw error;
}

/** Public Ethereum read. The exempt wallet skips the call. MUZZ decimals come from the contract. */
export async function readMuzzHolding(address, fetchImpl = fetch) {
  const wallet = String(address || '').toLowerCase();
  if (wallet === MUZZ_EXEMPT) return { ok: true, exempt: true, formatted: 'exempt' };
  const decimals = BigInt(await ethCall(fetchImpl, MUZZ_TOKEN, '0x313ce567'));
  const raw = BigInt(await ethCall(fetchImpl, MUZZ_TOKEN, '0x70a08231' + padAddress(wallet)));
  const min = MUZZ_MIN_WHOLE * (10n ** decimals);
  const whole = raw / (10n ** decimals);
  return {
    ok: raw >= min,
    raw: raw.toString(),
    decimals: Number(decimals),
    formatted: whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  };
}
