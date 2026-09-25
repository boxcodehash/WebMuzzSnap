/** Wallets que el selector debe enseñar primero. El id de WalletConnect es público (explorer). */
export const NATIVE_RETURN = 'muzzsnap://wc';

export const SUPPORTED_WALLETS = [
  {
    id: 'metamask',
    name: 'MetaMask',
    rdns: 'io.metamask',
    match: ['metamask'],
    wcId: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96'
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    rdns: 'com.trustwallet.app',
    match: ['trust wallet', 'trustwallet'],
    wcId: '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0'
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    rdns: 'com.coinbase.wallet',
    match: ['coinbase'],
    wcId: 'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa'
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    rdns: 'me.rainbow',
    match: ['rainbow'],
    wcId: '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369'
  },
  {
    id: 'okx',
    name: 'OKX Wallet',
    rdns: 'com.okex.wallet',
    match: ['okx', 'okex'],
    wcId: '971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709'
  },
  {
    id: 'phantom',
    name: 'Phantom',
    rdns: 'app.phantom',
    match: ['phantom'],
    wcId: 'a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393'
  }
];

export function matchWalletId(rdns, name) {
  const blob = `${rdns || ''} ${name || ''}`.toLowerCase();
  for (const wallet of SUPPORTED_WALLETS) {
    if (wallet.rdns && blob.includes(wallet.rdns)) return wallet.id;
    if (wallet.match.some((token) => blob.includes(token))) return wallet.id;
  }
  return 'injected';
}

export function walletById(id) {
  return SUPPORTED_WALLETS.find((wallet) => wallet.id === id) || null;
}
