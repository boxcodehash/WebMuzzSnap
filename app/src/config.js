import { CHAIN_ID, DEFAULT_MIN_MUZZ, TOKEN_ADDRESS } from '../shared/policy.js';

/**
 * apiKey y el resto son la config web PÚBLICA ya presente en chat.html / private.html
 * (proyecto pulsari). No es un secreto: la seguridad está en las reglas y en el custom token.
 * Para otro proyecto, rellena MUZZ_RUNTIME.firebase en www/config.runtime.js.
 */
const PUBLIC_FIREBASE = {
  apiKey: 'AIzaSyAe1-JfNde0NKIMdE7phfEXlm9JaqUH0jY',
  authDomain: 'pulsari.firebaseapp.com',
  databaseURL: 'https://pulsari-default-rtdb.firebaseio.com',
  projectId: 'pulsari',
  storageBucket: 'pulsari.firebasestorage.app',
  messagingSenderId: '824306321233',
  appId: '1:824306321233:web:2c9bfa02170a17d560b570'
};

export function getConfig() {
  const runtime = globalThis.MUZZ_RUNTIME || {};
  const min = Number(runtime.minMuzz || DEFAULT_MIN_MUZZ);
  const firebase = {
    ...PUBLIC_FIREBASE,
    ...(runtime.firebase && typeof runtime.firebase === 'object' ? runtime.firebase : {})
  };
  return {
    minMuzz: Number.isFinite(min) && min > 0 ? min : DEFAULT_MIN_MUZZ,
    tokenAddress: TOKEN_ADDRESS,
    chainId: CHAIN_ID,
    functionsBase: String(runtime.functionsBase || '').replace(/\/$/, ''),
    walletConnectProjectId: String(runtime.walletConnectProjectId || '').trim(),
    preview: runtime.preview === true,
    firebase
  };
}

/**
 * Sample UI only. It never talks to Firebase.
 * - 127.0.0.1 + ?demo=1 always (local screenshots).
 * - MUZZ_PREVIEW=1, written into config.local.json, on any host (Vercel / APK test).
 * ?login=1 or ?demo=0 shows the real sign-in screen instead.
 */
export function demoAllowed(loc = globalThis.location, runtime = globalThis.MUZZ_RUNTIME) {
  if (!loc || typeof loc.hostname !== 'string') return false;
  const params = new URLSearchParams(loc.search || '');
  if (params.get('demo') === '0' || params.get('login') === '1') return false;
  if (runtime && runtime.preview === true) return true;
  return loc.hostname === '127.0.0.1' && params.get('demo') === '1';
}
