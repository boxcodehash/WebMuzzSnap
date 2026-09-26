export function walletError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

const MESSAGES = {
  NO_WALLET: 'Wallet not installed. Install MetaMask, Trust Wallet, Coinbase Wallet, Rainbow, OKX, or Phantom, or connect another wallet with WalletConnect.',
  NO_PROJECT_ID: 'WalletConnect project id is missing. Create one for free at cloud.reown.com and set WALLETCONNECT_PROJECT_ID. Do not commit it.',
  rejected: 'Signature rejected. The wallet cancelled the connection or the signature.',
  chain: 'Wrong network. Accept the switch to Ethereum mainnet and try again.',
  disconnected: 'The wallet disconnected. Connect it again to continue.',
  account_changed: 'You switched accounts in the wallet. Sign in again with the new account.',
  pending: 'A request is already open in the wallet. Finish it there.',
  wc_load: 'The wallet picker could not be opened. Check your connection and try again.'
};

export function walletMessage(code) {
  return MESSAGES[code] || '';
}

export function mapWalletError(err) {
  if (err && err.code && MESSAGES[err.code]) return err;
  const code = err && err.code;
  const msg = String((err && (err.message || err.reason)) || '');
  if (code === 4001 || code === 'ACTION_REJECTED' || /user rejected|user denied|rejected the|denied|cancel/i.test(msg)) {
    return walletError('rejected');
  }
  if (code === -32002 || /already pending|request already/i.test(msg)) return walletError('pending');
  if (code === 4902 || /chain|network|4902|unrecognized chain|unsupported chain/i.test(msg)) {
    return walletError('chain');
  }
  return err || walletError('wc_load');
}
