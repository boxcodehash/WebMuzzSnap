# Deploying the MuzzSnap app

Español: [DEPLOY.es.md](DEPLOY.es.md).

Nothing here has been deployed, and production Firebase has not been touched. The current site is unchanged. Freddie has to run these steps, in the project he chooses.

## Before anything else

The app, as it sits in the repo, **cannot really sign in**: `www/config.runtime.js` leaves `functionsBase` empty on purpose. Until the Cloud Functions exist, the sign-in screen says so and does not ask for a signature.

You need:

- The **Blaze** plan (scheduled functions and TTL are not on the free plan).
- `firebase-tools`, `gcloud`, and an account that can deploy.
- Node 20 or newer.
- For the APK: Android Studio or the Android SDK (API 35) and a JDK 17 or 21.
- Optional: a WalletConnect project id (it is public, but it belongs to your account at https://cloud.reown.com). Without it, injected wallets still work. WalletConnect shows a notice.

### Which project

The default config points at **`pulsari`**, the same project as the current site, because that apiKey is already public in `chat.html`. Deploying there does **not** rewrite the Realtime Database or the site HTML, but it does create Firestore, Storage, Auth custom tokens, and functions in that project. That is production.

If you do not want to touch it:

1. Create a new Firebase project.
2. In `www/config.runtime.js`, fill `firebase` with that project’s web config (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). `databaseURL` can stay empty. Or set the `MUZZ_FIREBASE_*` variables and run `npm run config`.
3. You do not have to recompile for `config.runtime.js`: it is read at startup. Env vars are written into `config.local.json` at build time.
4. Deploy the functions **to that same project**. The custom token and the client have to be the same project.

Do not commit `functions/.env`, service accounts, or the WalletConnect project id. `.env` is in `.gitignore`. The example is `functions/.env.example` and `app/.env.example`.

## 1. Variables

From `app/`:

```bash
cp functions/.env.example functions/.env
cp .env.example .env
```

Edit `functions/.env`:

| Variable | What it is for | Default |
| --- | --- | --- |
| `MIN_MUZZ` | Minimum whole tokens | `10000000` |
| `TOKEN_ADDRESS` | ERC-20. Do not change it unless the contract is different | `0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0` |
| `ETH_RPC_URL` | Ethereum mainnet RPC, without a key if you can | `https://ethereum.publicnode.com` |
| `ACCESS_TTL_MINUTES` | How often the balance must be proven again | `60` |
| `APP_ORIGINS` | Allowed origins. If you set it, it **replaces** the list. It does not append | local, `https://localhost`, `capacitor://localhost` |

Chain id is not configurable. It is mainnet (1).

### Client variables (`app/.env`)

`npm run config`, `npm run build`, and `npm run serve` write `www/config.local.json`. That file is gitignored. The script does not print the values.

| Variable | Required for a visual preview | What it does |
| --- | --- | --- |
| `MUZZ_PREVIEW` | No. The installable app does not use it | Leave it empty. The shipped pages are the real chat |
| `WALLETCONNECT_PROJECT_ID` | No | 32 hex. QR and WalletConnect. Do not commit it |
| `MUZZ_FUNCTIONS_BASE` | No | Functions URL, no trailing slash. Required for a real `?login=1` |
| `MUZZ_MIN_MUZZ` | No | Integer shown before the server answers. The functions `MIN_MUZZ` is the one that counts |
| `MUZZ_FIREBASE_API_KEY` | No | Set all six, or none. They replace the public `pulsari` web config |
| `MUZZ_FIREBASE_AUTH_DOMAIN` | No | |
| `MUZZ_FIREBASE_PROJECT_ID` | No | |
| `MUZZ_FIREBASE_STORAGE_BUCKET` | No | |
| `MUZZ_FIREBASE_MESSAGING_SENDER_ID` | No | |
| `MUZZ_FIREBASE_APP_ID` | No | |
| `MUZZ_FIREBASE_DATABASE_URL` | No | Optional |

Do not put the project id or `preview: true` in `www/config.runtime.js`. That file is committed.

### WalletConnect project id (Reown)

Needed for the QR code on a computer, and for the phone to open MetaMask, Trust Wallet, Coinbase Wallet, Rainbow, OKX, Phantom, or another wallet over WalletConnect v2 and return to the app. Without the id, only wallets already injected in the browser work (an extension, or the wallet’s in-app browser).

The id is public once the app is published (the browser can see it), but **it is not committed**.

1. Go to https://cloud.reown.com (https://cloud.walletconnect.com is the same dashboard) and create a free account.
2. New project. The name can be MuzzSnap.
3. Copy the **Project ID** (32 hex characters).
4. Under allowed domains / origins, add the real origins: `http://127.0.0.1:4173`, `https://localhost` (the APK), and, if you publish the PWA, the Vercel domain or `https://boxcodehash.github.io`.
5. In `app/.env`:

```bash
WALLETCONNECT_PROJECT_ID=your_32_hex_id
```

6. From `app/`:

```bash
npm run config
```

Phantom must be in Ethereum mode. Solana does not work. The MUZZ contract is on mainnet.

If you publish the PWA, add the real origin to `APP_ORIGINS` on the functions as well. The Capacitor APK uses `https://localhost`. Example:

```bash
APP_ORIGINS=http://127.0.0.1:4173,http://localhost:4173,https://localhost,capacitor://localhost,https://your-project.vercel.app
```

## 2. The installable app

`app/www` is the real login, group chat, and private chat. It talks to the same `pulsari` Realtime Database as the website. There is no sample chat in this build.

The 10,000,000 MUZZ check is `balanceOf` on a public RPC (`www/js/muzz-gate.js`) until you deploy functions. No env var is required for that. The APK opens `https://muzzsnap-app.vercel.app/login.html#from=apk` inside MetaMask, Trust, Coinbase, Rainbow, OKX, and Phantom (`APP_PUBLIC_URL` overrides it). `WALLETCONNECT_PROJECT_ID` is optional: without it there is no WalletConnect button. With it, signing stays inside the APK.

### Publish only this app on Vercel

This does not touch GitHub Pages or the site at the repo root. Create a **new** Vercel project. Set Root Directory to `app`. `app/vercel.json` serves `www`. Do not add a `vercel.json` at the repo root.

## 3. Functions, rules, and indexes

From `app/`, with the project already chosen (`firebase use YOUR_PROJECT` or `--project`):

```bash
cd app
npm install
npm install --prefix functions
firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project YOUR_PROJECT
```

That publishes:

- `createNonce`, `verifyAccess`, `recheckBalance`, `issueServerFactor`
- `purgeExpired` (every 60 minutes)
- `firestore.rules` and `storage.rules`
- the collection-group index on `messages.expireAt`

HTTPS functions must be invokable without Google IAM (`invoker: public` is already in the code). Authorization is the custom token, not that IAM. `createNonce` is public on purpose: it only hands out a nonce.

When it finishes, copy the base URL **without** the function name and **without** a trailing slash. It is usually:

```text
https://us-central1-YOUR_PROJECT.cloudfunctions.net
```

Put it in `www/config.runtime.js`, or in `MUZZ_FUNCTIONS_BASE` and run `npm run config`:

```js
window.MUZZ_RUNTIME = {
  functionsBase: 'https://us-central1-YOUR_PROJECT.cloudfunctions.net',
  walletConnectProjectId: '',
  minMuzz: 10000000,
  firebase: null
};
```

Leave `walletConnectProjectId` empty. The id comes from `WALLETCONNECT_PROJECT_ID`, not from here.

`minMuzz` here is only the number shown before the server answers. The one that counts is the function’s `MIN_MUZZ`. They should match.

If you change the minimum later: edit `functions/.env`, redeploy **only** functions, and update the number on the screen. The rules do not need a change.

## 4. TTL policy

The function already deletes every hour. Firestore TTL is the backup if the function is down. In the console: Firestore → Time-to-live → field `expireAt`, scope **collection group** `messages`.

Or with gcloud:

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=messages \
  --enable-ttl \
  --project=YOUR_PROJECT
```

That covers private messages, each group member’s inbox, and the sender copy, because all three collections are named `messages`. It can take a while to turn on. Native deletion can lag by up to 72 h. It does not replace `purgeExpired`.

The first `purgeExpired` run may ask for an index if `firestore.indexes.json` was not deployed. The link is in the function log. Do not ignore it.

## 5. Try it in the browser

```bash
cd app
npm test
npm run build
npm run serve
```

Open `http://127.0.0.1:4173/`. Without `functionsBase` you will see the notice and you will not get in. With the functions deployed and the URL set:

1. MetaMask on Ethereum mainnet.
2. Sign the message.
3. If the wallet holds at least the minimum, you enter the chat. If not, the app shows the balance and there is no session.
4. From another browser or device, with another wallet that also passes the minimum, open a private thread.
5. After it is read, Firestore should show `readAt` and `expireAt` about 24 h later.
6. To test the balance cutoff you need a wallet that falls below the minimum, or set `MIN_MUZZ` above its balance and sign in again. `recheckBalance` also runs when the app is reopened.

`?demo=1` exists only on `127.0.0.1` and checks nothing. Do not use it as a security test.

Rules emulator (Java required):

```bash
cd app
npm run test:rules
```

It does not contact `pulsari`. It uses the fake project `demo-muzz`.

## 6. PWA

`www/` is the installable site: `login.html`, `chat.html`, `private.html`, and `manifest.webmanifest`. If the current site is published as a whole by GitHub Pages, **merging** this PR would also publish `/app/www/`. This work does not merge and does not change the Pages workflow. If you do not want it public yet, do not merge.

The UI is English. On a phone: Safari or Chrome → Add to Home Screen. “Open in wallet” loads the page in MetaMask, Trust, Coinbase, Rainbow, OKX, or Phantom.

## 7. Debug APK

```bash
cd app
npm install
npm run android:debug
```

The APK is `app/android/app/build/outputs/apk/debug/app-debug.apk`. It is not committed. It packages `www/` (the real pages), not a sample chat.

`ANDROID_HOME` needs platform android-35 and build-tools. The application id is `app.muzzsnap.chat`. The WebView origin is `https://localhost`.

There is no injected wallet inside the APK, and the WebView origin is `https://localhost`. A wallet cannot open that page, so the logo does not use the MetaMask SDK against localhost. MetaMask, Trust, Coinbase, Rainbow, OKX, and Phantom open `APP_PUBLIC_URL/login.html#from=apk` (default `https://muzzsnap-app.vercel.app/login.html#from=apk`) inside the wallet browser, where `window.ethereum` exists. After the signature and the 10,000,000 MUZZ check, the wallet returns with `muzzsnap://auth?token=...`. The APK checks the signature, a 3-minute expiry, and the balance again, then enters chat. The same page also offers “Continue in this browser” if the custom scheme does not open the app.

That return token is the signature itself. Cloud Functions are not deployed, so there is no server one-time token and no Firebase custom token. The nonce is remembered only on the device that consumes it. Someone who copies the link could replay it on another phone for those 3 minutes. WalletConnect v2 (Reown AppKit) avoids the handoff: set `WALLETCONNECT_PROJECT_ID`, rebuild, and “Connect with WalletConnect” signs inside the APK. Without that id the button stays hidden. `muzzsnap://wc` remains the native return for WalletConnect. The public metadata URL is `APP_PUBLIC_URL`, not `https://localhost`.

Publish `app/www` as its own Vercel project (Root Directory `app`, output `www`). Do not add a root `vercel.json` and do not change the current site.

Do not ship this debug APK to the Play Store. A release needs your own keystore, and that keystore must not be committed.

## 8. What to check after the first deploy

- Auth → Sign-in method: a custom token does not need an extra provider, but Authentication has to be enabled.
- Firestore and Storage created (production mode; the rules in this repo already close access).
- A wallet under the minimum gets `below_minimum` and no token.
- A user without the claim cannot read `users` or `messages` (the rules deny it).
- `purgeExpired` logs the next day.
- `functions/.env` does not show up in git (`git status`).
