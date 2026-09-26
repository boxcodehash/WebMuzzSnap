# Seguridad de la app MuzzSnap

English: [SECURITY.md](SECURITY.md).

Este documento describe el acceso por saldo, el cifrado y el borrado de la app que vive en `/app`. No cambia el sitio actual (`login.html`, `chat.html`, `private.html`): ese chat sigue escribiendo **texto plano** en Realtime Database del proyecto `pulsari`. La app nueva es un sistema aparte, sobre Firestore.

## Qué había en el sitio y qué se reutilizó

- La config web de Firebase (apiKey, projectId `pulsari`, etc.) ya estaba publicada en el HTML. Se copió. **No es un secreto.** Quien despliegue en otro proyecto debe sustituirla en `www/config.runtime.js`.
- El contrato es el ERC-20 `0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0` en Ethereum mainnet. El código viejo no coincidía entre pantallas: `login.js` pedía 20M, `index.js` 40M y el privado 2M, y el `login.html` que realmente se usa **no comprueba saldo**. La app exige **10.000.000 MUZZ**, configurable, y la decisión la toma el servidor.
- No había cifrado real, ni reglas en el repositorio, ni Cloud Functions. Las llaves de admin del sitio viejo **no saltan** el mínimo en la app.

## Acceso: solo con wallet y saldo

1. El cliente pide un nonce de un solo uso (`createNonce`).
2. La wallet firma un mensaje fijo (estilo SIWE, formato propio). No es una transacción y no gasta gas. El selector es Reown AppKit (EIP-6963 y WalletConnect v2). Solo demuestra que controlas la clave: el saldo lo lee el servidor. El project id de Reown acaba en el cliente cuando se publica, pero no se commitea.
3. `verifyAccess` recupera la dirección con `ethers.verifyMessage`, comprueba nonce, origen, chain id 1, contrato y que el mínimo firmado sea el del servidor.
4. Lee `balanceOf` y `decimals` en mainnet. Compara enteros (`parseUnits`), no números con decimales flotantes.
5. Si llega al mínimo, escribe `access/{wallet}` con `active: true` y una caducidad, y devuelve un **custom token** de Firebase con los claims `muzzAccess: true` y `wallet` igual al uid.
6. Si no llega, deja `active: false`, revoca los refresh tokens si existían y no entrega token.

Las reglas de Firestore exigen las tres cosas a la vez: usuario autenticado, claim `muzzAccess`, uid igual a `wallet`, y documento `access` activo y no caducado. Sin eso no hay lectura ni escritura. El cliente no puede escribir `access`, los nonces ni los factores: solo el Admin SDK.

`recheckBalance` (al abrir una sesión ya iniciada y cada cierto tiempo desde la app) vuelve a leer la cadena. Si el saldo bajó del mínimo, desactiva el acceso y revoca la sesión. Un fallo del RPC **no** cierra la sesión: responde 503 y el acceso sigue hasta que caduque el documento. El mínimo se cambia con la variable `MIN_MUZZ` de las functions, no recompilando la app. El número que firma el usuario es el que devuelve el servidor.

## Cifrado: tres factores por mensaje

Cada sobre usa WebCrypto (P-256, HKDF-SHA-256, AES-GCM).

1. **Llave efímera del emisor.** Se genera un par ECDH nuevo para ese mensaje. El secreto es `ECDH(efímera_privada, prekey_pública_del_receptor)`. La pública viaja con el sobre. La privada no se guarda: el emisor conserva el texto en claro solo en su dispositivo, hasta que caduca.
2. **Prekey del receptor, de un solo uso.** El receptor publica un lote de prekeys ECDH firmadas con su llave ECDSA. El emisor consume una (`consumed: true`) y el secreto es `ECDH(identidad_privada_del_emisor, esa_prekey)`. Al descifrar, el receptor borra la privada de IndexedDB. La siguiente vez hace falta otra prekey. Si no quedan, el envío falla para esa persona; no hay un modo degradado que mande el texto en claro.
3. **Factor del servidor.** La function `issueServerFactor` genera 32 bytes aleatorios, los guarda en `serverFactors/{messageId}_{receptor}` y se los da al emisor. Entran como **salt del HKDF**, junto con los dos secretos ECDH (separados con los bytes `0x01` y `0x02` para que no se puedan intercambiar).

La clave AES no existe en ningún sitio. Se deriva al cifrar y al abrir. El AAD ata el sobre a la conversación, el id, el emisor, el receptor y el id del factor: si Firebase altera esos campos, el descifrado falla.

```
emisor                                              receptor
  |  efímera nueva + prekey pública del receptor       |
  |  ECDH efímero  +  ECDH de identidad                |
  |  pide factor ------------------------------------> Firebase guarda el factor
  |  <-----------------------------------------------  32 bytes
  |  HKDF(ecdh1, ecdh2, factor) -> AES-GCM             |
  |  ciphertext -------------------------------------> Firestore
  |                                                    | lee factor + ciphertext
  |                                                    | ECDH con la prekey privada
  |                                                    | HKDF + AES-GCM
  |                                                    | borra la prekey privada
```

El grupo **no** usa una sola clave compartida. El emisor repite el esquema para cada miembro (máximo 80): cada uno tiene su sobre, su prekey y su factor. La copia del emisor en el servidor no lleva el texto, solo metadatos; el texto queda en el dispositivo.

Las prekeys van firmadas (`muzzsnap-prekey-v1`). La primera vez que se ve a alguien se guarda su llave de firma y su identidad (TOFU). Si cambian, la app no envía hasta que la persona pulse «Confío en la llave nueva».

Las privadas ECDH y ECDSA se crean con `extractable: false` y se guardan como `CryptoKey` en IndexedDB (`muzzsnap-e2ee`). No hay botón de exportar. Cerrar sesión no las borra. «Borrar llaves de este dispositivo» sí, y a partir de ahí los mensajes viejos no se pueden abrir.

Los adjuntos se cifran con AES-GCM y una llave de archivo aleatoria. Esa llave va **dentro** del texto cifrado del sobre, no al lado. A Storage solo sube el ciphertext (`application/octet-stream`, máximo 8 MB).

## Por qué Firebase no puede leer el mensaje solo

Firebase (reglas, Admin SDK, una copia de seguridad) puede ver:

- el ciphertext, el iv y las claves **públicas**
- el factor de 32 bytes
- quién habla con quién, cuándo, y si hay adjunto

No puede ver las privadas, que no salen del dispositivo. Sin los dos ECDH, el factor no deriva la clave AES. Al revés igual: robar solo el ciphertext, sin el factor, tampoco basta. Hacen falta los tres.

Eso **no** significa que el operador de Firebase sea inofensivo. Puede borrar mensajes, no entregar el factor, cambiar metadatos (el AAD haría fallar el descifrado) o, en el primer contacto, sustituir la prekey pública antes de que exista TOFU. No hay registro público de llaves ni verificación fuera de banda automática.

## Borrado

| Dónde | Cuándo empieza el reloj | Cuándo se borra |
| --- | --- | --- |
| Privado | Cuando el receptor abre el mensaje (`readAt`) | `expireAt = readAt + 24 h` |
| Bandeja de cada miembro del grupo | Cuando **esa** persona lo abre | `readAt + 24 h` de su sobre. La lectura de uno no borra el de los demás |
| Copia del emisor en el grupo | En el envío. No hay una «lectura» distinta | 24 h después de `sentAt` |
| Si nadie abre un privado o un sobre de grupo | En el envío, como tope | 72 h. Al leerse, el `expireAt` pasa a ser la lectura + 24 h |

La ventana de las reglas es un poco más ancha (23–25 h, 70–74 h, 22–26 h) para el desfase del reloj. El cliente escribe 24 h y 72 h exactas. El campo que usa la política TTL de Firestore es `expireAt`, en el grupo de colecciones `messages` (privados, bandejas y copias del emisor).

Firestore puede tardar **hasta 72 h** en aplicar la TTL. Por eso hay además `purgeExpired`, cada 60 minutos: borra los documentos con `expireAt` ya pasado, el factor asociado y el objeto de Storage si `attachmentPath` empieza por `attachments/`. En el dispositivo, al abrir la app y cada 30 s se borran de IndexedDB las entradas cuyo `expireAt` ya pasó, aunque el servidor vaya con retraso.

Los factores huérfanos se barren a las 96 h, después del tope de no leídos, para no dejar un mensaje ilegible antes de tiempo.

## Qué sí protege

- El texto y los adjuntos frente a quien solo tiene la base de datos, incluida la cuenta de administración de Firebase, mientras las privadas sigan solo en los dispositivos.
- La suplantación de la wallet en el acceso: hace falta la firma del nonce y el saldo lo mira el servidor.
- Que un holder sin saldo, o con la sesión revocada, lea o escriba en Firestore.
- Reutilizar una prekey. Cada mensaje de entrada gasta una.
- Pegar un sobre en otra conversación: el AAD no coincide.

## Qué no protege

- **Metadatos.** Direcciones, horas, tamaño, el grafo de quién escribe a quién y el hecho de que haya un adjunto son visibles para Firebase.
- **El operador en el primer contacto.** TOFU detecta un cambio posterior, no un engaño en la primera publicación de llaves.
- **Un dispositivo comprometido.** Si alguien abre IndexedDB o lee la pantalla mientras el texto está en caché, lo ve. Las prekeys ya borradas no se recuperan; las que siguen ahí, sí. En el APK, `allowBackup` está en false para que Android no copie esa base a la copia de seguridad de Google.
- **Malware en la propia app o XSS.** El cifrado corre en el mismo JavaScript que la interfaz. Quien controle ese código controla las llaves.
- **Disponibilidad.** Sin el factor o sin Firestore no hay mensaje, aunque las llaves estén bien.
- **Anonimato ni ocultación del saldo.** El saldo se consulta en un RPC público de Ethereum. La app no mezcla direcciones.
- **El sitio viejo.** Sigue en claro. Esta app no lo migra ni lo apaga.
- **Un grupo enorme.** El fan-out está limitado a 80 miembros a propósito.
- **Historial al reinstalar.** Las privadas no se copian a ningún sitio. Un teléfono nuevo no abre lo ya enviado.
- **La TTL nativa de Firestore por sí sola.** Hay que activarla (ver `DEPLOY.md`) y aun así la function es la que borra a la hora.

No es el Double Ratchet de Signal. No hay cadena simétrica continua ni recuperación post-compromiso más allá de tirar las prekeys de un solo uso que ya se usaron. Si se agotan, no se manda el mensaje: no se reutiliza una prekey en silencio.

## Qué hace hoy la app instalable

La app Android y `app/www` son el sitio real: `login.html`, `chat.html` y `private.html`, sobre el mismo Realtime Database de `pulsari`. Los mensajes siguen en claro (`content` en `messages/general`, `text` en `privateInbox`). Ese build no lleva chat de muestra ni `MUZZ_PREVIEW`.

El cifrado de `app/src/crypto.js` **no** se aplica a esos mensajes. La web lee texto plano. Escribir ciphertext en la misma base rompería `chat.html` y `private.html`. El módulo sigue en el repo para un backend aparte en Firestore. No es compatible con los datos actuales.

El borrado a las 24 h de ver un mensaje es **solo en este dispositivo** (`localStorage`). Borrar las filas del Realtime Database también las quitaría de la web. Esa purga compartida no está activada.

Los 10.000.000 MUZZ se comprueban con `balanceOf` en un RPC público de Ethereum (`app/www/js/muzz-gate.js`) hasta que se desplieguen las Cloud Functions. `app/functions` ya tiene la comprobación de servidor y no está desplegada. En la copia de la app no hay invitado ni salto de saldo para admins.
