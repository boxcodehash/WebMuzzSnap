import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ethers } from 'ethers';
import { hasEnoughBalance, recoverAccess } from '../functions/src/accessLogic.js';
import { readHolding } from '../functions/src/holding.js';
import { buildLoginMessage } from '../shared/loginMessage.js';
import { TOKEN_ADDRESS } from '../shared/policy.js';

const RPCS = ['https://ethereum.publicnode.com', 'https://eth.drpc.org', 'https://rpc.ankr.com/eth'];
const HOLDER = '0xd6a07b8065f9e8386a9a5bba6a754a10a9cd1074';
const EMPTY = '0x0000000000000000000000000000000000000001';
const MIN = '10000000';

async function holdingOf(address) {
  let last;
  for (const rpcUrl of RPCS) {
    try {
      return await readHolding({
        rpcUrl,
        chainId: 1,
        tokenAddress: TOKEN_ADDRESS,
        address
      });
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

test('el servidor verifica la firma y el saldo real de MUZZ', { timeout: 40000 }, async () => {
  const wallet = ethers.Wallet.createRandom();
  const issuedAt = new Date().toISOString();
  const message = buildLoginMessage({
    address: wallet.address,
    nonce: 'ab'.repeat(16),
    issuedAt,
    uri: 'http://127.0.0.1:4173',
    chainId: 1,
    tokenAddress: TOKEN_ADDRESS,
    minMuzz: MIN
  });
  const signature = await wallet.signMessage(message);
  const access = recoverAccess(message, signature, {
    tokenAddress: TOKEN_ADDRESS,
    minMuzz: MIN
  }, Date.parse(issuedAt));
  assert.equal(access.recovered, wallet.address.toLowerCase());
  assert.throws(() => recoverAccess(message, `0x${'ab'.repeat(65)}`, {
    tokenAddress: TOKEN_ADDRESS,
    minMuzz: MIN
  }, Date.parse(issuedAt)));

  const fresh = await holdingOf(wallet.address);
  const holder = await holdingOf(HOLDER);
  const empty = await holdingOf(EMPTY);
  assert.equal(fresh.decimals, 18);
  assert.equal(holder.decimals, 18);
  assert.equal(hasEnoughBalance(fresh.balance, fresh.decimals, MIN), false);
  assert.equal(hasEnoughBalance(holder.balance, holder.decimals, MIN), true);
  assert.equal(hasEnoughBalance(empty.balance, empty.decimals, MIN), false);
  assert.ok(holder.balance > empty.balance);
});
