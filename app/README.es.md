# MuzzSnap app

English: [README.md](README.md).

Chat grupal y mensajes privados para holders de MUZZ. Vive solo en esta carpeta. No modifica `login.html`, `chat.html`, `private.html` ni la config del sitio.

- La interfaz está en inglés. Entras con MetaMask, Trust Wallet, Coinbase Wallet, Rainbow, OKX, Phantom (en Ethereum) o cualquier wallet de WalletConnect v2. Firmas un nonce y el servidor comprueba que tengas al menos 10.000.000 MUZZ (`0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0` en Ethereum). El mínimo se cambia con `MIN_MUZZ`. El project id de WalletConnect va en `WALLETCONNECT_PROJECT_ID`, no en el repo.
- Cada mensaje va cifrado con una llave efímera, una prekey de un solo uso y un factor del servidor. Firebase no puede abrirlo solo.
- Al leerse, se borra 24 h después. Detalle y límites en [SECURITY.es.md](SECURITY.es.md).
- PWA (`www/`) y proyecto Android con Capacitor.

Cómo desplegar, sin tocar producción desde aquí: [DEPLOY.es.md](DEPLOY.es.md).

## Probar en local

```bash
cd app
npm install
npm test
npm run build
npm run serve
```

- App: http://127.0.0.1:4173/
- Interfaz de ejemplo, sin wallet ni Firebase: http://127.0.0.1:4173/?demo=1&view=login (también `view=chat` y `view=hilo&peer=0x4c1e90aa77b3d81264c00000000000000000a91f`). Solo responde en `127.0.0.1`.

El acceso real necesita las Cloud Functions. Hasta entonces la pantalla de login lo explica.

La app instalable es el login, el chat y el privado reales (copiados del sitio, con el mínimo de 10.000.000 MUZZ). No hay chat de muestra.

```bash
npm run android:debug
```

El APK queda en `app/android/app/build/outputs/apk/debug/app-debug.apk`.

En el APK, los botones de wallet abren `https://muzzsnap-app.vercel.app/login.html` (`APP_PUBLIC_URL`) dentro de la wallet y vuelven con `muzzsnap://auth`. WalletConnect solo aparece si defines `WALLETCONNECT_PROJECT_ID` y reconstruyes el APK.

Para publicarla en Vercel sin tocar el sitio actual, el Root Directory del proyecto nuevo tiene que ser `app`. La salida es `www`.

Reglas contra el emulador (Java, no usa el proyecto real):

```bash
npm run test:rules
```

APK de debug, con el SDK de Android instalado:

```bash
npm run android:debug
```
