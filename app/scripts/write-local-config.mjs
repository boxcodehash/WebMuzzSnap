import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2]
  ? (isAbsolute(process.argv[2]) ? process.argv[2] : join(root, process.argv[2]))
  : join(root, 'www', 'config.local.json');

function readDotEnv(path) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cut = trimmed.indexOf('=');
    if (cut < 1) continue;
    let value = trimmed.slice(cut + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, cut).trim()] = value;
  }
  return out;
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

const fileEnv = readDotEnv(join(root, '.env'));

function pick(name) {
  if (Object.prototype.hasOwnProperty.call(process.env, name) && String(process.env[name]).trim() !== '') {
    return String(process.env[name]).trim();
  }
  return String(fileEnv[name] || '').trim();
}

const projectId = pick('WALLETCONNECT_PROJECT_ID');
const preview = Object.prototype.hasOwnProperty.call(process.env, 'MUZZ_PREVIEW')
  ? truthy(process.env.MUZZ_PREVIEW)
  : truthy(fileEnv.MUZZ_PREVIEW);
const functionsBase = pick('MUZZ_FUNCTIONS_BASE').replace(/\/$/, '');
const minRaw = pick('MUZZ_MIN_MUZZ');

const firebaseKeys = {
  MUZZ_FIREBASE_API_KEY: 'apiKey',
  MUZZ_FIREBASE_AUTH_DOMAIN: 'authDomain',
  MUZZ_FIREBASE_PROJECT_ID: 'projectId',
  MUZZ_FIREBASE_STORAGE_BUCKET: 'storageBucket',
  MUZZ_FIREBASE_MESSAGING_SENDER_ID: 'messagingSenderId',
  MUZZ_FIREBASE_APP_ID: 'appId',
  MUZZ_FIREBASE_DATABASE_URL: 'databaseURL'
};
const firebase = {};
for (const [envName, key] of Object.entries(firebaseKeys)) {
  const value = pick(envName);
  if (value) firebase[key] = value;
}

if (projectId && !/^[a-f0-9]{32}$/i.test(projectId)) {
  console.error('WALLETCONNECT_PROJECT_ID no tiene 32 hexadecimales. No se escribe config.local.json.');
  process.exitCode = 1;
} else if (Object.keys(firebase).length) {
  const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  const missing = required.filter((key) => !firebase[key]);
  if (missing.length) {
    console.error(`Faltan variables de Firebase: ${missing.join(', ')}. No se escribe config.local.json.`);
    process.exitCode = 1;
  }
}

if (!process.exitCode && minRaw && !/^\d+$/.test(minRaw)) {
  console.error('MUZZ_MIN_MUZZ tiene que ser un entero. No se escribe config.local.json.');
  process.exitCode = 1;
}

if (!process.exitCode) {
  const payload = {
    walletConnectProjectId: projectId || '',
    preview
  };
  if (functionsBase) payload.functionsBase = functionsBase;
  if (minRaw) payload.minMuzz = Number(minRaw);
  if (Object.keys(firebase).length) payload.firebase = firebase;
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`config.local.json escrito (preview=${preview ? 'yes' : 'no'}, projectId=${projectId ? 'yes' : 'no'}, functionsBase=${functionsBase ? 'yes' : 'no'}). No se imprimen los valores.`);
}
