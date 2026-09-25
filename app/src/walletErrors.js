export function walletError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

const MESSAGES = {
  NO_WALLET: 'No hay una wallet instalada en este navegador. Instala MetaMask, Trust Wallet, Coinbase Wallet, Rainbow, OKX o Phantom, o conecta otra con WalletConnect.',
  NO_PROJECT_ID: 'Falta el project id de WalletConnect. Créalo gratis en cloud.reown.com y ponlo en WALLETCONNECT_PROJECT_ID. No lo subas al repo.',
  rejected: 'Rechazaste la conexión o la firma en la wallet.',
  chain: 'La wallet está en otra red. Acepta el cambio a Ethereum mainnet e inténtalo otra vez.',
  disconnected: 'La wallet se desconectó. Vuelve a conectarla para continuar.',
  account_changed: 'Cambiaste de cuenta en la wallet. Entra otra vez y firma con la cuenta nueva.',
  pending: 'Ya hay una solicitud abierta en la wallet. Ábrela y termínala.',
  wc_load: 'No se pudo abrir el selector de wallets. Revisa la conexión e inténtalo otra vez.'
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
