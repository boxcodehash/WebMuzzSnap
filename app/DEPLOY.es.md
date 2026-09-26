# Despliegue de la app MuzzSnap

English: [DEPLOY.md](DEPLOY.md).

No se ha desplegado nada ni se ha tocado el Firebase de producción. El sitio actual sigue igual. Estos pasos los tiene que hacer Freddie, en el proyecto que él elija.

## Antes de nada

La app, tal como está en el repo, **no puede iniciar sesión de verdad**: `www/config.runtime.js` tiene `functionsBase` vacío a propósito. Hasta que no existan las Cloud Functions, la pantalla de acceso lo dice y no pide la firma.

Hace falta:

- Plan **Blaze** (las functions programadas y el TTL no entran en el plan gratis).
- `firebase-tools`, `gcloud` y una cuenta con permiso para desplegar.
- Node 20 o superior.
- Para el APK: Android Studio o el SDK de Android (API 35) y un JDK 17 o 21.
- Opcional: un project id de WalletConnect (es público, pero es de tu cuenta de https://cloud.walletconnect.com). Sin él, MetaMask sigue funcionando; WalletConnect muestra un aviso.

### Qué proyecto usar

La config por defecto apunta al proyecto **`pulsari`**, el mismo del sitio actual, porque esa apiKey ya es pública en `chat.html`. Desplegar ahí **no reescribe** el Realtime Database ni el HTML del sitio, pero sí crea Firestore, Storage, Auth custom tokens y functions en ese proyecto. Eso es producción.

Si no quieres tocarlo:

1. Crea un proyecto Firebase nuevo.
2. En `www/config.runtime.js` rellena `firebase` con la config web de ese proyecto (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). Puedes dejar `databaseURL` vacío.
3. No hace falta recompilar: ese archivo se lee al arrancar.
4. Despliega las functions **en ese mismo proyecto**. El custom token y el cliente tienen que ser del mismo sitio.

No subas `functions/.env`, cuentas de servicio ni el project id de WalletConnect si prefieres tratarlo como dato de tu cuenta. `.env` está en `.gitignore`. El ejemplo está en `functions/.env.example`.

## 1. Variables

Desde `app/`:

```bash
cp functions/.env.example functions/.env
```

Edita `functions/.env`:

| Variable | Para qué | Por defecto |
| --- | --- | --- |
| `MIN_MUZZ` | Mínimo de tokens enteros | `10000000` |
| `TOKEN_ADDRESS` | ERC-20. No lo cambies salvo que el contrato sea otro | `0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0` |
| `ETH_RPC_URL` | RPC de Ethereum mainnet, sin clave si puede ser | `https://ethereum.publicnode.com` |
| `ACCESS_TTL_MINUTES` | Cada cuánto hay que volver a demostrar el saldo | `60` |
| `APP_ORIGINS` | Orígenes permitidos. Si la pones, **sustituye** la lista, no se suma | local, `https://localhost`, `capacitor://localhost` |

La chain id no es configurable: es mainnet (1).

### Project id de WalletConnect (Reown)

Hace falta para el código QR en el ordenador y para que el móvil abra MetaMask, Trust Wallet, Coinbase Wallet, Rainbow, OKX, Phantom u otra wallet por WalletConnect v2 y vuelva a la app. Sin ese id, solo funcionan las wallets ya inyectadas en el navegador (extensión o navegador interno de la wallet).

El id es público cuando la app está publicada (el navegador lo ve), pero **no se sube al repo**.

1. Entra en https://cloud.reown.com (también vale https://cloud.walletconnect.com: es el mismo panel) y crea una cuenta gratis.
2. New project. El nombre puede ser MuzzSnap.
3. Copia el **Project ID** (32 hexadecimales).
4. En el proyecto, en Allowed domains / origins, añade los orígenes reales: `http://127.0.0.1:4173`, `https://localhost` (el APK) y, si publicas la PWA, `https://boxcodehash.github.io`.
5. En `app/.env` (cópialo de `.env.example`, no lo commitees):

```bash
WALLETCONNECT_PROJECT_ID=tu_id_de_32_hex
```

6. Desde `app/`:

```bash
npm run config
```

Eso escribe `www/config.local.json`. Está en `.gitignore`. El script no imprime el id. Si el valor no son 32 hex, no lo escribe.

No lo pongas en `www/config.runtime.js`: ese archivo sí se commitea. `npm run build` y `npm run serve` generan el json solos si el `.env` existe.

Phantom tiene que estar en modo Ethereum. Solana no sirve: el contrato de MUZZ está en mainnet.

Si publicas la PWA en GitHub Pages, añade el origen real, por ejemplo `https://boxcodehash.github.io`. El APK con Capacitor usa `https://localhost`. Ejemplo:

```bash
APP_ORIGINS=http://127.0.0.1:4173,http://localhost:4173,https://localhost,capacitor://localhost,https://boxcodehash.github.io
```

## 2. Functions, reglas e índices

Desde `app/`, con el proyecto ya elegido (`firebase use TU_PROYECTO` o `--project`):

```bash
cd app
npm install
npm install --prefix functions
firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project TU_PROYECTO
```

Eso publica:

- `createNonce`, `verifyAccess`, `recheckBalance`, `issueServerFactor`
- `purgeExpired` (cada 60 minutos)
- `firestore.rules` y `storage.rules`
- el índice de grupo de colecciones sobre `messages.expireAt`

Las functions HTTPS tienen que poder invocarse sin IAM de Google (`invoker: public` ya va en el código). La autorización es el custom token, no ese IAM. `createNonce` es público a propósito: solo entrega un nonce.

Cuando termine, copia la URL base **sin** el nombre de la function y **sin** barra final. Suele ser:

```text
https://us-central1-TU_PROYECTO.cloudfunctions.net
```

Pégala en `www/config.runtime.js`:

```js
window.MUZZ_RUNTIME = {
  functionsBase: 'https://us-central1-TU_PROYECTO.cloudfunctions.net',
  walletConnectProjectId: '',
  minMuzz: 10000000,
  firebase: null
};
```

Deja `walletConnectProjectId` vacío. El id va por `WALLETCONNECT_PROJECT_ID`, no aquí.

`minMuzz` aquí solo es el número que se enseña antes de hablar con el servidor. El que manda es `MIN_MUZZ` de la function. Conviene que coincidan.

Si cambias el mínimo más adelante: edita `functions/.env`, vuelve a desplegar **solo** functions y actualiza el número de la pantalla. No hace falta tocar las reglas.

## 3. Política TTL

La function ya borra cada hora. La TTL de Firestore es la red de seguridad si la function está parada. En consola: Firestore → Time-to-live → campo `expireAt`, ámbito **grupo de colecciones** `messages`.

O con gcloud:

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=messages \
  --enable-ttl \
  --project=TU_PROYECTO
```

Eso cubre los mensajes privados, la bandeja de cada miembro del grupo y la copia del emisor, porque las tres colecciones se llaman `messages`. Puede tardar en activarse. El borrado nativo puede ir con hasta 72 h de retraso; no sustituye a `purgeExpired`.

La primera ejecución de `purgeExpired` puede pedir un índice si el de `firestore.indexes.json` no se desplegó. El enlace sale en el log de la function. No lo ignores.

## 4. Probar en el navegador

```bash
cd app
npm test
npm run build
npm run serve
```

Abre `http://127.0.0.1:4173/`. Sin `functionsBase` verás el aviso y no entrarás. Con las functions desplegadas y la URL puesta:

1. MetaMask en Ethereum mainnet.
2. Firma del mensaje.
3. Si la wallet tiene al menos el mínimo, entras al chat. Si no, la app dice el saldo y no hay sesión.
4. Desde otro navegador o dispositivo, con otra wallet que también pase el mínimo, abre un privado.
5. Al leer, en Firestore deben aparecer `readAt` y `expireAt` unas 24 h después.
6. Para probar el cierre por saldo hace falta una wallet que baje del mínimo, o bajar `MIN_MUZZ` por encima de su saldo y volver a entrar. `recheckBalance` también corre al reabrir la app.

La vista `?demo=1` solo existe en `127.0.0.1` y no comprueba nada. No la uses como prueba de seguridad.

### App instalable

`app/www` es el login, el chat y el privado reales, contra el mismo Realtime Database `pulsari`. No hay chat de muestra. El mínimo de 10.000.000 MUZZ se lee con `balanceOf` en un RPC público hasta que despliegues las functions. No hace falta ninguna variable para eso.

Sin `WALLETCONNECT_PROJECT_ID` no hay código QR. El APK usa el deeplink de MetaMask, igual que `login.html`, y enlaces a Trust, Coinbase, Rainbow, OKX y Phantom.

### Publicar solo esta app en Vercel

No toca GitHub Pages ni el sitio de la raíz. Crea un proyecto de Vercel **nuevo**. Root Directory: `app`. El `vercel.json` sirve `www`. No añadas un `vercel.json` en la raíz del repo.

El emulador de reglas (hace falta Java):

```bash
cd app
npm run test:rules
```

No contacta con `pulsari`. Usa el proyecto ficticio `demo-muzz`.

## 5. PWA

Con `npm run build`, `www/` es instalable: `manifest.webmanifest` y `sw.js`. El service worker guarda el cascarón (HTML, CSS, JS, iconos). No guarda mensajes. En el APK no se registra, para no pelearse con el WebView.

Sirve `www/` por HTTPS. Si el sitio actual se publica entero por GitHub Pages, al **fusionar** este PR la app quedará en una ruta del tipo `/app/www/`. Este trabajo no fusiona ni cambia el workflow de Pages. Si no quieres publicarla todavía, no fusiones.

La interfaz de la app está en inglés. En el móvil: Safari o Chrome → Añadir a la pantalla de inicio. Si el navegador no tiene extensión, “Open in wallet” carga la página en MetaMask, Trust, Coinbase, Rainbow, OKX o Phantom. Con el project id, “Connect wallet” abre el modal de Reown AppKit: QR en escritorio y deep link en el móvil, y al aprobar la wallet vuelve a esta página.

## 6. APK de depuración

El proyecto Android se genera con Capacitor (`android/`). No lleva una keystore de publicación.

```bash
cd app
npm install
npm run android:debug
```

Eso copia `www/` (las páginas reales) y genera el APK en:

```text
app/android/app/build/outputs/apk/debug/app-debug.apk
```

Hace falta `ANDROID_HOME` con platform android-35 y build-tools. El id es `app.muzzsnap.chat`. El WebView es `https://localhost`.

Dentro del APK no hay wallet inyectada. El logo usa el deeplink de MetaMask, el mismo de `login.html`. Las otras wallets son enlaces. Esos enlaces abren la página dentro de la wallet solo si la página tiene una URL pública; `https://localhost` no carga el APK. El QR de WalletConnect necesita `WALLETCONNECT_PROJECT_ID` y no va en este build. `muzzsnap://wc` sigue en el manifest para cuando exista ese id.

No firmes este APK de debug para Play Store. Para una release hace falta una keystore tuya, que no debe subirse al repo.

## 7. Qué revisar después del primer despliegue

- Auth → Sign-in method: el custom token no pide un proveedor extra, pero el proyecto tiene que tener Authentication activado.
- Firestore y Storage creados (modo producción; las reglas de este repo ya cierran el acceso).
- Que una wallet por debajo del mínimo recibe `below_minimum` y no un token.
- Que un usuario sin claim no puede leer `users` ni `messages` (las reglas lo niegan).
- Logs de `purgeExpired` al día siguiente.
- Que `functions/.env` no aparece en git (`git status`).
