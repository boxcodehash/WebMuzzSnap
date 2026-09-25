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
    firebase
  };
}

export function demoAllowed() {
  if (typeof location === 'undefined') return false;
  const host = location.hostname;
  if (host !== '127.0.0.1') return false;
  return new URLSearchParams(location.search).get('demo') === '1';
}
