# Despliegue de la app MuzzSnap

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

El emulador de reglas (hace falta Java):

```bash
cd app
npm run test:rules
```

No contacta con `pulsari`. Usa el proyecto ficticio `demo-muzz`.

## 5. PWA

Con `npm run build`, `www/` es instalable: `manifest.webmanifest` y `sw.js`. El service worker guarda el cascarón (HTML, CSS, JS, iconos). No guarda mensajes. En el APK no se registra, para no pelearse con el WebView.

Sirve `www/` por HTTPS. Si el sitio actual se publica entero por GitHub Pages, al **fusionar** este PR la app quedará en una ruta del tipo `/app/www/`. Este trabajo no fusiona ni cambia el workflow de Pages. Si no quieres publicarla todavía, no fusiones.

En el móvil: Safari o Chrome → Añadir a la pantalla de inicio. MetaMask en el móvil puede abrir la PWA con el enlace `metamask.app.link` que enseña la propia pantalla si no detecta wallet.

## 6. APK de depuración

El proyecto Android se genera con Capacitor (`android/`). No lleva una keystore de publicación.

```bash
cd app
npm install
npm run android:debug
```

Eso hace el build web, `cap sync` y `./gradlew assembleDebug`. El APK queda en:

```text
app/android/app/build/outputs/apk/debug/app-debug.apk
```

Hace falta `ANDROID_HOME` con platform android-35 y build-tools. Si Gradle no encuentra el SDK, Android Studio lo instala la primera vez que abres `app/android/`.

El id de aplicación es `app.muzzsnap.chat`. El WebView usa `https://localhost`, así que ese origen tiene que estar en `APP_ORIGINS` (ya está en la lista por defecto). Dentro del APK no hay MetaMask inyectado: hace falta WalletConnect con `walletConnectProjectId`, o instalar la PWA dentro del navegador de MetaMask.

No firmes este APK de debug para Play Store. Para una release hace falta una keystore tuya, que no debe subirse al repo.

## 7. Qué revisar después del primer despliegue

- Auth → Sign-in method: el custom token no pide un proveedor extra, pero el proyecto tiene que tener Authentication activado.
- Firestore y Storage creados (modo producción; las reglas de este repo ya cierran el acceso).
- Que una wallet por debajo del mínimo recibe `below_minimum` y no un token.
- Que un usuario sin claim no puede leer `users` ni `messages` (las reglas lo niegan).
- Logs de `purgeExpired` al día siguiente.
- Que `functions/.env` no aparece en git (`git status`).
