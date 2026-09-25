# MuzzSnap app

Español: [README.es.md](README.es.md).

Group chat and private messages for MUZZ holders. This folder is the whole app. It does not change `login.html`, `chat.html`, `private.html`, or the current site config.

The interface is English. Sign in with MetaMask, Trust Wallet, Coinbase Wallet, Rainbow, OKX, Phantom (Ethereum mode), or any WalletConnect v2 wallet. You sign a nonce and the server checks that you hold at least 10,000,000 MUZZ (`0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0` on Ethereum). Change the minimum with `MIN_MUZZ`. The WalletConnect project id belongs in `WALLETCONNECT_PROJECT_ID`, not in the repo.

Each message is encrypted with an ephemeral key, a one-time prekey, and a server factor. Firebase cannot open it alone. After it is read, it is deleted 24 hours later. Limits: [SECURITY.md](SECURITY.md).

PWA (`www/`) and a Capacitor Android project. Deploy without touching production from here: [DEPLOY.md](DEPLOY.md).

## Try it locally

```bash
cd app
npm install
npm test
npm run build
npm run serve
```

- App: http://127.0.0.1:4173/
- Sample UI, no wallet and no Firebase: http://127.0.0.1:4173/?demo=1&view=login (also `view=chat` and `view=hilo&peer=0x4c1e90aa77b3d81264c00000000000000000a91f`). That shortcut only answers on `127.0.0.1`.

Real sign-in needs the Cloud Functions. Until then the login screen says so.

Rules against the emulator (Java, does not use the real project):

```bash
npm run test:rules
```

## Test build without Firebase

`dist/` is gitignored. The sample chat does not call Firebase.

```bash
npm run build:preview
npm run android:preview
```

- Static site: `app/dist`
- Debug APK: `app/android/app/build/outputs/apk/debug/app-debug.apk`

To publish only this app on Vercel, create a new project and set Root Directory to `app`. Do not add a `vercel.json` at the repo root. Variables: [DEPLOY.md](DEPLOY.md).
