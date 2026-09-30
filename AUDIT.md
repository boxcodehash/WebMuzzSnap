# MuzzSnap 1.0.25 independent audit

Audited commit: `06a39b6` on `cursor/muzzsnap-app-e2ee` (Capacitor Android app, `www/`, `api/`, Firebase project `pulsari`, Vercel `muzzsnap-app`).

This report does not change that branch. The owner agent applies the fixes and signs the APK.

## Executive summary

**Verdict: FAIL for publishing.**

The shipped login path will not get a Reown Verify **VALID** result inside the Android WebView, and the message the user signs is not EIP-4361. MetaMask, Trust, Coinbase, Rainbow, OKX, and Phantom will see an unverified or domain-mismatch connection. That is the condition that produces “suspicious site” / “deceptive request” warnings. Do not ship the release APK until the wallet fixes in the list below are in the build that gets signed.

The same build also lets any signed-in wallet write the public chat as any other wallet and delete the channel. Realtime Database rules do not bind `wallet` / `username` to `auth.uid`. Private text encryption itself is sound: the server wraps an already encrypted envelope and cannot read it. Photos do not use that scheme.

`npm test` at this commit: **80 pass, 1 fail, 1 skip**. The failure is `test/apk-handoff.test.js` opening `android/app/src/main/assets/capacitor.config.json`, which exists only after `cap sync`. The skip is `test/rules.test.js` because the Firestore emulator is not running. `npm run build` completed. It writes `www/js/app.js` from `src/main.js`. No page loads that file. It was not committed.

Live login is `www/login.html` → `www/js/login-page.js` → `www/js/login.js`, built from `src/login-client.js`. `src/wallet.js` / `src/wc-auth.js` (AppKit, `eth_sign`, one-click SIWE) are not on that path.

## Findings

| Sev | Area | Where | Evidence | Fix |
| --- | --- | --- | --- | --- |
| Critical | Wallet Verify status | `app/capacitor.config.json:5-7`, `app/src/login-client.js:152-160`, `app/src/login-client.js:249-262` | Android scheme is `https` and `server.hostname` is unset, so the WebView origin is `https://localhost`. WalletConnect Verify v3 registers that origin: `@walletconnect/core` `Verify.register` loads `…/attestation?origin=` + `window.location.origin`. Metadata `url` is rewritten to `https://muzzsnap-app.vercel.app` whenever the host is localhost. Attestation origin and the URL shown to the wallet differ. Wallets set **INVALID** when those origins differ (domain mismatch / suspicious site) and **UNKNOWN** when the origin is not a verified project domain. **VALID** requires both to be `https://muzzsnap-app.vercel.app` and that host allowlisted on project `8ff03dad157892146048cfe2b4e381ca`. `https://muzzsnap-app.vercel.app/.well-known/assetlinks.json` returns **404**. | Set `server.androidScheme` to `https` and `server.hostname` to `muzzsnap-app.vercel.app` so `location.origin` equals metadata `url`. Keep that exact origin on the Reown allowlist. Keep `redirect.native` as `muzzsnap://wc`. Do not add a universal link that opens the site inside the wallet. Confirm `isVerified: true` and origin match on a phone (see the phone list). |
| Critical | Sign-in message is not EIP-4361 | `app/src/login-client.js:17-18`, `app/server/login-proof.js:30-39`, `app/server/push.js:267-277` | The message that is signed is three lines: `MuzzSnap`, `Wallet: 0x…`, `Nonce: …`. No domain, URI, chain id, issued-at, expiration, or human statement. MetaMask cannot bind it to `muzzsnap-app.vercel.app`. The server accepts this “short” form. A second parser accepts any first line that ends with `wants you to sign in with your Ethereum account:` and does not require the domain to be `muzzsnap-app.vercel.app` (`login-proof.js:47-53`). `Chain ID` may be `1` or `56` (`login-proof.js:6`). | Sign one EIP-4361 `personal_sign` and reject every other shape. Exact text is in the fix list. |
| Critical | Group chat impersonation and wipe | `app/database.rules.json:5-9`, `app/database.rules.json:24-31`, `app/www/chat.html:896-904`, `app/www/chat.html:922-926` | `messages/$channel` read/write is `auth != null`. The payload’s `wallet`, `username`, `role`, and `userId` are not checked. Any holder can push a message that displays as RYASHU, ITZUKI, or Esteban, and can `set(null)` on the channel. `muted` and `banned` are the same: any signed-in user can write them. Client `requireAdmin()` is not a control. | Rules must require `newData.child('wallet').val() == auth.uid` (and the same for username/role derived from that uid), deny channel-wide deletes except a server admin, and restrict `muted` / `banned` to admin wallets. Deploy the rules to `pulsari` before the APK. |
| High | Session asks for BNB Chain | `app/src/login-client.js:252-256` | Shipped proposal is `chains: [1]`, `optionalChains: [56]`, methods `personal_sign`, `eth_requestAccounts`, `eth_accounts`. Wallets show a second chain. `src/wc-auth.js:4-5` and `src/wallet.js:137-147` still add `eip155:56` and `eth_sign` on the unused AppKit path. `npm run build` emits that path as `www/js/app.js`. | Live proposal: required namespace `eip155:1` only, methods `personal_sign` plus the account methods WalletConnect needs to return the address (`eth_requestAccounts`, `eth_accounts`). Remove `optionalChains: [56]`. Delete `eth_sign` from `AUTH_METHODS`. Do not load `www/js/app.js`. |
| High | Server accepts a foreign SIWE domain and chain 56 | `app/server/login-proof.js:6`, `app/server/login-proof.js:47-53` | The EIP-4361-shaped branch checks that some line matches the SIWE suffix. It never checks the domain. `CHAINS` is `1` and `56`. | Accept only domain `muzzsnap-app.vercel.app`, URI `https://muzzsnap-app.vercel.app/login.html`, chain id `1`, and a nonce that was issued by `GET /api/session?op=nonce`. |
| High | Balance is not enforced again after login | `app/server/push.js:283-293`, `app/www/js/login-page.js:164-170`, `app/www/chat.html:638-646` | `/api/session` does call `balanceOf` (18 decimals confirmed on-chain: `decimals()` returns `0x12`) and exempts `0xbeec8f1fee64627f83f0188eae621f367a6bcb8a`. After that, `resumeIfSignedIn` and `signInForChat` keep the Firebase user. Chat re-reads balance in the browser only. Opening private chat uses the same client RPC (`chat.html:860-865`). A refresh token keeps working after the balance drops, and a modified client can skip the RPC. | On each chat/private load, require a server check (session re-verify or a small authenticated `balance` op) before Firebase access is treated as enough. Keep the exempt wallet server-side. |
| High | Anonymous sign-in fallback | `app/www/js/fcm-client.js:74-81`, `app/www/js/fcm-client.js:204-212`, `app/www/chat.html:659-667` | If session exchange returns 5xx or throws, `signInForChat` calls `signInAnonymously()`. Chat treats any user without `needsSign` as logged in and then writes `me.wallet` from `localStorage`. Combined with the open `messages` rule, an anonymous session can post as whatever address is stored. The current 3-line proof is not reused (`muzz-gate.js:586-592` requires an `Expires:` line), so a fresh login redirects instead. The fallback is still in the APK. | Remove `anonymousFallback` from the wallet path. If exchange fails, return `needsSign` and stay on login. Never call `signInAnonymously` for chat. |
| High | Private inbox: the other person can delete your message | `app/database.rules.json:70-78` | Thread `.write` is any participant. `$msgId` validate allows `!newData.exists()`, so a delete of the other person’s message succeeds. | Allow delete only when `auth.uid == data.child('from').val()`, or only via the admin SDK expire job. |
| High | Photos are not the 3-key scheme | `app/www/js/private-e2ee.js:139-156`, `app/www/js/private-e2ee.js:218-236`, `app/www/private.html:966` | Text uses v2: ephemeral P-256, one-time prekey, HKDF bound to both wallets and the message id, random content key, unique IVs (`private-e2ee.js:457-520`). Photos call `loadOrCreate()`, a long-term key in `localStorage` (`muzz_e2ee_priv`), then ECDH against the peer’s **published v2 identity** with a 16-byte zero HKDF salt. Those two key pairs are not the same, so the recipient’s `openPhoto` (old private key × sender’s old public key) does not match what the sender encrypted. The server still cannot read the bytes. | Send photos through `sealMessage` (v2) and the same relay/unwrap path as text. Stop calling `sealPhoto` / `preparePhoto`. |
| Medium | Login nonce is not atomic | `app/server/push.js:232-294` | Nonce issuance has no rate limit. Consume is GET `loginNonces/{nonce}` then PUT. Two parallel posts can both pass before either write lands. `loginIssued` is not deleted. | Use an RTDB transaction (or a conditional update) so a nonce can be consumed once. Rate-limit `GET /api/session?op=nonce` and `POST /api/session` per IP. |
| Medium | Prekey claim is not atomic | `app/server/blob.js:256-266` | `handlePrekeyClaim` copies `walletKeys`, deletes one prekey, and PUTs the parent record. Two senders can be handed the same prekey. The private key still never reaches the server. | Claim with a transaction that removes that prekey id only if it still exists. |
| Medium | Translate API is public | `app/server/translate.js:508-519`, `app/server/http.js:1-4` | `POST /api/translate` has no Firebase auth. The rate limit is an in-memory map (20/minute/IP) and does not survive a new serverless instance. CORS echoes any `Origin`. | Require the Firebase ID token. Put the rate limit in RTDB. Allow only `https://muzzsnap-app.vercel.app` and `https://localhost` (or the hostname you set above). |
| Medium | No Content-Security-Policy | `app/www/login.html`, `app/www/chat.html`, `app/www/private.html` | No CSP meta or header. Chat and private rendering of messages, names, `[[sticker:id]]`, and translation output does **not** use `innerHTML` with raw user text (React text nodes in chat; `escapeHtml` + `MuzzStickers.paint` text nodes in private; translate writes `input.value` / React state). CSP is still missing. | Add a CSP that allows only the script/style hosts you actually use (`www.gstatic.com`, `cdnjs.cloudflare.com`, `fonts.googleapis.com`, `fonts.gstatic.com`) and `default-src 'self'`. No `unsafe-eval`. |
| Medium | Group history is not deleted | `app/www/js/muzz-gate.js:88-106` | `visible()` hides a group message on that device 24h after first seen. The RTDB row stays. Private messages do expire: receipt sets `expireAt = readAt + 24h` (`blob.js` `handlePrivateReceipt`), unread `expireAt = sentAt + 24h` (`handlePrivateRelay`), and `/api/private-expire` deletes due `privateInbox` rows. | If group chat must disappear, delete server-side on the same clock. Otherwise document that only private messages expire. |
| Medium | E2EE private keys are exportable | `app/www/js/private-e2ee.js:101-123`, `app/www/js/private-e2ee.js:398-421` | Identity and prekey PKCS8 are written to `localStorage` (`extractable: true`). They do not leave the device by themselves. Any script that can run in the WebView can read them. `allowBackup` is false, which blocks Android backup. | Generate non-extractable keys and keep them in IndexedDB or the Android Keystore via a plugin. If you must persist PKCS8, it stays only in memory after import (`extractable: false`). |
| Low | Unused AppKit path still requests `eth_sign` | `app/src/wc-auth.js:4-5`, `app/src/wallet.js:226-235` | Not loaded by `login.html`. If it is wired up later, methods include `eth_sign`, chains include `eip155:56`, and the icon is `new URL('icons/icon-512.png', location.href)`, which is `https://localhost/icons/…` inside the APK and not reachable by the wallet. | Keep this path out of the APK or make its metadata identical to `login-client.js`. |
| Low | `muzzsnap://auth` still delivered | `app/android/app/src/main/AndroidManifest.xml:37-42`, `app/android/app/src/main/java/app/muzzsnap/chat/MainActivity.java:298-333` | The live login returns with `muzzsnap://wc` and does not mint `muzzsnap://auth?token=`. The activity still injects a `token` query into the page. Custom schemes can be claimed by another app. | Remove the `auth` intent filter and `deliverAuth` if the handoff is retired. |
| Low | Popup can navigate the main WebView | `app/android/app/src/main/java/app/muzzsnap/chat/WalletLinks.java:188-198` | `capturePopup` loads a non-wallet `https` URL into the parent WebView. | Ignore popup URLs that are not `muzzsnap` or a wallet scheme. |
| Info | Project id, icons, deep links, names, secrets, API count | See notes | Project id `8ff03dad157892146048cfe2b4e381ca` is in `www/config.public.js`. `https://muzzsnap-app.vercel.app/icons/icon-512.png` is **HTTP 200** `image/png`, and the live metadata icon is that URL. No `metamask.app.link/dapp/` or `metamask://dapp/` in app source. Android rewrites `/dapp`, `/browse`, and `/open_url` (`WalletLinks.java:118-126`, `walletLinks.js:13-18`). The WalletConnect bundle still contains a Solana Phantom `/ul/browse/` helper; the Android hook blocks `/browse` before navigation. Admin names: ITZUKI `0x3e1c…e501`, RYASHU `0x2081…92ff`, Esteban `0x875c…30ec`, case-insensitive, shown to self and others (`www/js/muzz-names.js:7-48`). Exempt wallet has no personal name; it renders `Node_6bcb8a`. No service-account JSON or `PRIVATE_SERVER_KEY` in the repo. Firebase web config and `google-services.json` API key are public client keys. `api/` has exactly `session.js`, `push.js`, `translate.js`, `private.js`, `private-expire.js`. UI strings “Send test notification” and “Check for updates” are absent from `www/` and from dialogs (`UpdateChecker` title is “Update available”). The phrase “Check for updates” appears only in a Java comment (`UpdateChecker.java:24`). Release manifest: `allowBackup=false`, `usesCleartextTraffic=false`, exported launcher only, FileProvider not exported. Debug network config allows cleartext to localhost / 10.0.2.2 only. | No code change required for these, except delete the comment if you want the phrase gone from the tree. Deployed RTDB rules must be checked in the Firebase console; this audit read the repo file. |

### What already matches the wallet requirements

- One `personal_sign` on the live path (`login-client.js:587`). No `eth_sendTransaction`, `eth_sign`, approval, or permit in that path.
- `redirect.native` is `muzzsnap://wc` inside the APK (`login-client.js:124-128`, `walletCatalog.js:2`). `MainActivity.deliverWalletReturn` only accepts `muzzsnap://wc` and fires `muzz-wc-return`.
- Disconnect / Change wallet calls `disconnectWallet()` (IndexedDB `WALLET_CONNECT_V2_INDEXED_DB` plus local/session keys) and `signOut()` (`login-page.js:178-199`, `login-client.js:446-469`).
- A stored 3-line proof is not posted again: `proofReusable` requires an `Expires:` line the short message does not have.
- MUZZ token `0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0`, mainnet, threshold 10,000,000 whole tokens. Server uses on-chain `decimals()` (18 today) and `balanceOf`. Exempt wallet skips the RPC on the server.
- Private **text**: server AES-GCM-wraps the v2 envelope with `PRIVATE_SERVER_KEY` (`server-key.js:30-44`). Unwrap returns the envelope to the two participants only (`blob.js:315-341`). The content key is wrapped to the prekey. The server does not have that private key. Tests `el servidor, con factor y claves públicas, no puede descifrar` and `prove the server cannot read` passed.
- Read messages: `expireAt = readAt + 24h`. Unread private messages: `sentAt + 24h`. Cron `/api/private-expire` requires `CRON_SECRET`.

### XSS

Reviewed `www/chat.html` `renderRich` (React children, sticker id `[a-z0-9-]+` only), `www/private.html` message list (`escapeHtml` on names, `MuzzStickers.paint` clears the node and uses text nodes), and `www/js/translate.js` (result goes to the input / React state, errors use `textContent`). No `dangerouslySetInnerHTML`. No finding above Info, apart from the missing CSP.

## Fixes the owner agent must apply before the release APK

Apply these on `cursor/muzzsnap-app-e2ee`, then rebuild `www/js/login.js` and sync Capacitor. Do not ship `www/js/app.js`.

1. **Make Verify origin match the domain.** In `capacitor.config.json`:

   ```json
   "server": {
     "androidScheme": "https",
     "hostname": "muzzsnap-app.vercel.app"
   }
   ```

   Metadata `url` and `icons` stay `https://muzzsnap-app.vercel.app` and `https://muzzsnap-app.vercel.app/icons/icon-512.png`. `redirect` on the native app stays `{ native: "muzzsnap://wc" }` only. In the Reown dashboard for project `8ff03dad157892146048cfe2b4e381ca`, the allowlist must include `https://muzzsnap-app.vercel.app` (exact origin the WebView will send).

2. **Replace the 3-line message** in `src/login-client.js` `buildLoginMessage` with one EIP-4361 string, nonce and times from `GET /api/session?op=nonce` (`nonce`, `exp`):

   ```text
   muzzsnap-app.vercel.app wants you to sign in with your Ethereum account:
   0x<checksum address>

   Sign in to MuzzSnap. This request does not spend gas or approve a token.

   URI: https://muzzsnap-app.vercel.app/login.html
   Version: 1
   Chain ID: 1
   Nonce: <32 hex chars from the server>
   Issued At: <ISO-8601 now>
   Expiration Time: <ISO-8601 of exp>
   ```

   No resources, no hex blobs, no token address inside the signed text. Ask for this signature once.

3. **Server: accept only that message.** In `server/login-proof.js`, reject the short form and the loose “MuzzSnap Login” form. Require domain `muzzsnap-app.vercel.app`, the URI above, version `1`, chain id `1`, the issued nonce, and `Expiration Time` within the 10-minute issued window. Keep signature recovery equal to the address line. Consume the nonce with a transaction. Delete `loginIssued/{nonce}` in the same transaction.

4. **Namespaces.** `providerOptions`: `chains: [1]`, no `optionalChains`, methods `personal_sign`, `eth_requestAccounts`, `eth_accounts` only. Remove `eth_sign` from `src/wc-auth.js`. Stop emitting or referencing `www/js/app.js`.

5. **RTDB rules** (deploy to `pulsari`):
   - `messages/$channel`: create only, `auth.uid` matches `newData.child('wallet').val()`, `username` / `role` match the server’s name table or are the node label, no update of another user’s row, no `.set(null)` on the channel.
   - `muted` and `banned`: write only for the three admin uids.
   - `privateInbox/.../messages/$msgId`: delete only if `auth.uid == data.child('from').val()`; the expire job uses the admin SDK.

6. **Remove anonymous auth** in `fcm-client.js`. Failed exchange → `needsSign` only.

7. **Re-check 10,000,000 MUZZ on the server** when chat and private open, not only inside `readMuzzBalance` in the page. Keep the exempt address on the server.

8. **Photos:** route them through `sealMessage` + `/api/private?op=relay`. Delete the `loadOrCreate` / zero-salt photo path.

9. **CSP** on `login.html`, `chat.html`, and `private.html`.

10. **Rate-limit** `/api/session` and require auth on `/api/translate`. Tighten CORS to the app origin.

11. **Prekey claim** as a transaction.

12. Rebuild the login bundle, `cap sync android`, and confirm `android/app/src/main/assets/capacitor.config.json` has the hostname above and no `server.url`. Then run `npm test` (the apk-handoff failure should clear once that asset exists).

## Verify on a real phone with MetaMask

These cannot be proven from the repo:

- Session proposal `verifyContext.verified.validation` is **VALID**, `isScam` is false, and the origin shown is `https://muzzsnap-app.vercel.app`. Repeat with Trust, Coinbase, Rainbow, OKX, and Phantom.
- The wallet UI shows the EIP-4361 domain line, chain 1, and a single signature. It does not show a BNB Chain permission, `eth_sign`, or a token approval.
- Approving the connection does not open `https://muzzsnap-app.vercel.app` inside the wallet browser (`/dapp/`, `/browse`, `/open_url`).
- After signing, the wallet returns to the APK via `muzzsnap://wc` and chat opens. A second tap does not ask for a second signature while the Firebase session is still valid.
- Disconnect / Change wallet clears the session. The next Connect is a new pairing, not a dead session.
- With the wallet on a non-mainnet chain, the signature still verifies and the balance read stays on Ethereum mainnet.
- Exempt wallet `0xbeec…cb8a` enters without a balance error and is labeled `Node_6bcb8a`. ITZUKI, RYASHU, and Esteban see their names on their own messages and on other phones.
- A private text sent from phone A opens only on phone B, is gone from the server 24h after read, and an unread one is gone 24h after send.
- Firebase console: the deployed Realtime Database rules match the file after the fix, not the current open `messages` rule.

## Test and build log

| Command | Result |
| --- | --- |
| `npm test` in `app/` | 80 pass, 1 fail, 1 skip. Fail: missing `android/app/src/main/assets/capacitor.config.json` (needs `cap sync`). Skip: Firestore rules emulator. |
| `npm run build` in `app/` | Exit 0. Writes unused `www/js/app.js`. |
| `GET https://muzzsnap-app.vercel.app/icons/icon-512.png` | 200 `image/png` |
| `GET https://muzzsnap-app.vercel.app/.well-known/assetlinks.json` | 404 |
| `eth_call decimals()` on `0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0` | `0x12` (18) |
