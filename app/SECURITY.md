# MuzzSnap app security

Español: [SECURITY.es.md](SECURITY.es.md).

This document describes balance gating, encryption, and deletion for the app in `/app`. It does not change the current site (`login.html`, `chat.html`, `private.html`): that chat still writes **plaintext** to the Realtime Database of the `pulsari` project. The new app is a separate system, on Firestore.

## What was already there, and what was reused

- The Firebase web config (apiKey, projectId `pulsari`, and the rest) was already public in the HTML. It was copied. **It is not a secret.** A different project must replace it in `www/config.runtime.js`, or with the `MUZZ_FIREBASE_*` variables at build time.
- The contract is the ERC-20 `0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0` on Ethereum mainnet. The old code did not agree across screens: `login.js` asked for 20M, `index.js` for 40M, and private chat for 2M, and the `login.html` that is actually used **does not check the balance**. This app requires **10,000,000 MUZZ**, configurable, and the server decides.
- There was no real encryption, no rules in the repository, and no Cloud Functions. The old site’s admin keys **do not skip** the minimum here.

## Access: wallet and balance only

1. The client asks for a one-time nonce (`createNonce`).
2. The wallet signs a fixed message (SIWE-style, our own format). It is not a transaction and it does not spend gas. The picker is Reown AppKit (EIP-6963 and WalletConnect v2). It only proves key control: the server reads the balance. The Reown project id ends up in the client when the app is published, but it is not committed.
3. `verifyAccess` recovers the address with `ethers.verifyMessage` and checks the nonce, origin, chain id 1, contract, and that the signed minimum is the server’s minimum.
4. It reads `balanceOf` and `decimals` on mainnet. The comparison uses integers (`parseUnits`), not floating point.
5. If the balance meets the minimum, it writes `access/{wallet}` with `active: true` and an expiry, and returns a Firebase **custom token** with claims `muzzAccess: true` and `wallet` equal to the uid.
6. If it does not, it leaves `active: false`, revokes refresh tokens when they exist, and does not issue a token.

Firestore rules require all three at once: an authenticated user, the `muzzAccess` claim, uid equal to `wallet`, and an `access` document that is active and not expired. Without that there is no read and no write. The client cannot write `access`, nonces, or factors. Only the Admin SDK can.

`recheckBalance` (when a session is restored, and on a timer in the app) reads the chain again. If the balance fell below the minimum, it turns access off and revokes the session. An RPC failure does **not** close the session: the function returns 503 and access lasts until the document expires. Change the minimum with the functions variable `MIN_MUZZ`, not by rebuilding the app. The number the user signs is the one the server returns.

## Encryption: three factors per message

Each envelope uses WebCrypto (P-256, HKDF-SHA-256, AES-GCM).

1. **Sender ephemeral key.** A new ECDH pair is generated for that message. The secret is `ECDH(ephemeral_private, recipient_prekey_public)`. The public key travels with the envelope. The private key is not stored: the sender keeps plaintext only on their device, until it expires.
2. **Recipient one-time prekey.** The recipient publishes a batch of ECDH prekeys signed with their ECDSA key. The sender consumes one (`consumed: true`). The secret is `ECDH(sender_identity_private, that_prekey)`. On decrypt, the recipient deletes the private key from IndexedDB. The next message needs another prekey. If none remain, sending fails for that person. There is no degraded mode that sends plaintext.
3. **Server factor.** `issueServerFactor` generates 32 random bytes, stores them in `serverFactors/{messageId}_{recipient}`, and gives them to the sender. They are the **HKDF salt**, together with the two ECDH secrets (separated by the bytes `0x01` and `0x02` so they cannot be swapped).

The AES key does not exist anywhere on its own. It is derived when encrypting and when opening. The AAD binds the envelope to the conversation, the id, the sender, the recipient, and the factor id. If Firebase changes those fields, decryption fails.

```
sender                                              recipient
  |  new ephemeral + recipient prekey public          |
  |  ephemeral ECDH  +  identity ECDH                 |
  |  asks for a factor -----------------------------> Firebase stores the factor
  |  <-----------------------------------------------  32 bytes
  |  HKDF(ecdh1, ecdh2, factor) -> AES-GCM            |
  |  ciphertext ------------------------------------> Firestore
  |                                                   | reads factor + ciphertext
  |                                                   | ECDH with the prekey private
  |                                                   | HKDF + AES-GCM
  |                                                   | deletes the prekey private
```

The group does **not** use one shared key. The sender repeats the scheme for each member (maximum 80). Each person has their own envelope, prekey, and factor. The sender’s server copy does not carry the text, only metadata. The text stays on the device.

Prekeys are signed (`muzzsnap-prekey-v1`). The first time someone is seen, their signing key and identity are stored (TOFU). If they change, the app does not send until the person taps “I trust the new key”.

ECDH and ECDSA private keys are created with `extractable: false` and stored as `CryptoKey` in IndexedDB (`muzzsnap-e2ee`). There is no export button. Logging out does not delete them. “Delete keys on this device” does, and older messages cannot be opened after that.

Attachments are encrypted with AES-GCM and a random file key. That key lives **inside** the encrypted envelope, not beside it. Storage receives only ciphertext (`application/octet-stream`, 8 MB maximum).

## Why Firebase cannot read the message alone

Firebase (rules, the Admin SDK, a backup) can see:

- the ciphertext, the iv, and the **public** keys
- the 32-byte factor
- who talks to whom, when, and whether there is an attachment

It cannot see the private keys, which never leave the device. Without both ECDH secrets, the factor does not derive the AES key. The reverse is also true: stealing only the ciphertext, without the factor, is not enough. All three are required.

That does **not** mean the Firebase operator is harmless. They can delete messages, refuse to deliver the factor, change metadata (the AAD would make decryption fail), or, on first contact, replace the public prekey before TOFU exists. There is no public key directory and no automatic out-of-band verification.

## Deletion

| Where | When the clock starts | When it is deleted |
| --- | --- | --- |
| Private | When the recipient opens the message (`readAt`) | `expireAt = readAt + 24 h` |
| Each group member’s inbox | When **that** person opens it | `readAt + 24 h` on their envelope. One read does not delete the others |
| Sender’s copy in the group | At send time. There is no separate “read” | 24 h after `sentAt` |
| If nobody opens a private message or a group envelope | At send time, as a cap | 72 h. Once read, `expireAt` becomes read time + 24 h |

The rules window is a little wider (23–25 h, 70–74 h, 22–26 h) for clock skew. The client writes exact 24 h and 72 h. The Firestore TTL field is `expireAt`, on the collection group `messages` (private, inboxes, and the sender copy).

Firestore can take **up to 72 h** to apply TTL. That is why `purgeExpired` also runs every 60 minutes: it deletes documents whose `expireAt` has passed, the matching factor, and the Storage object when `attachmentPath` starts with `attachments/`. On the device, opening the app and a 30 s timer delete IndexedDB rows whose `expireAt` has passed, even if the server is late.

Orphan factors are swept at 96 h, after the unread cap, so a message is not made unreadable too early.

## What this protects

- Text and attachments against anyone who only has the database, including the Firebase admin account, as long as the private keys stay only on the devices.
- Wallet impersonation at sign-in: the nonce signature is required, and the server reads the balance.
- A holder with no balance, or a revoked session, reading or writing Firestore.
- Reusing a prekey. Each incoming message spends one.
- Pasting an envelope into another conversation: the AAD will not match.

## What this does not protect

- **Metadata.** Addresses, times, sizes, who writes to whom, and the fact of an attachment are visible to Firebase.
- **The operator on first contact.** TOFU detects a later change, not a lie in the first key publication.
- **A compromised device.** Anyone who opens IndexedDB or reads the screen while plaintext is cached can see it. Deleted prekeys cannot be recovered. Ones that are still there can. On the APK, `allowBackup` is false so Android does not copy that database to Google backup.
- **Malware in the app itself, or XSS.** Encryption runs in the same JavaScript as the UI. Whoever controls that code controls the keys.
- **Availability.** Without the factor or without Firestore there is no message, even if the keys are fine.
- **Anonymity or hiding the balance.** The balance is read from a public Ethereum RPC. The app does not mix addresses.
- **The old site.** It is still plaintext. This app does not migrate it or turn it off.
- **A huge group.** Fan-out is capped at 80 members on purpose.
- **History after reinstall.** Private keys are not copied anywhere. A new phone cannot open what was already sent.
- **Firestore’s native TTL by itself.** It has to be enabled (see `DEPLOY.md`) and the function is still what deletes on time.

This is not Signal’s Double Ratchet. There is no continuous symmetric chain and no post-compromise recovery beyond throwing away one-time prekeys that were already used. If they run out, the message is not sent. A prekey is not reused in silence.

## What the installable app does today

The Android app and `app/www` are the real site: `login.html`, `chat.html`, and `private.html`, on the same `pulsari` Realtime Database. Messages stay plaintext `{ content, username, role, timestamp }` in `messages/general` and `{ text, from, to, timestamp }` in `privateInbox`. There is no sample chat and no `MUZZ_PREVIEW` in that build.

End-to-end encryption from `app/src/crypto.js` is **not** applied to those messages. The website reads plaintext. Writing ciphertext into the same database would show garbage in `chat.html` and `private.html`. The encryption module stays in the repo for a separate Firestore backend. It is not compatible with the live data.

Deletion 24 hours after a message is seen is **on this device only** (`localStorage`). Deleting the Realtime Database rows would also delete them from the website. That shared purge is not turned on.

The 10,000,000 MUZZ check uses `balanceOf` on a public Ethereum RPC (`app/www/js/muzz-gate.js`) until Cloud Functions are deployed. `app/functions` still has the server check. It is not deployed, so the client check is what the app enforces. There is no guest login and no admin balance bypass in the app copy.

The APK cannot be opened by a wallet, because its origin is `https://localhost`. Wallet buttons open `https://muzzsnap-app.vercel.app/login.html#from=apk` (override with `APP_PUBLIC_URL`). The signed message includes a nonce, a 3-minute expiry, and `Return: apk`. The wallet then opens `muzzsnap://auth?token=...`. The app recovers the address from that signature and reads the balance again. Without Cloud Functions there is no server-side one-time token and no Firebase custom token. The nonce is stored only on the device that accepts the link, so a copied link can be replayed on another phone until it expires. “Continue in this browser” stays on the public page if the custom scheme fails. WalletConnect is the main sign-in inside the APK. The public client id is in `www/config.public.js`. The wallet returns with `muzzsnap://wc`, the signature is checked in the app, and the balance is read again. The public-page handoff above is only the fallback.
