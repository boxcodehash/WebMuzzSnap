import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const fromEnv = String(process.env.WALLETCONNECT_PROJECT_ID || '').trim();
const fromFile = String(readDotEnv(join(root, '.env')).WALLETCONNECT_PROJECT_ID || '').trim();
const projectId = fromEnv || fromFile;
const target = join(root, 'www', 'config.local.json');

if (projectId && !/^[a-f0-9]{32}$/i.test(projectId)) {
  console.error('WALLETCONNECT_PROJECT_ID no tiene 32 hexadecimales. No se escribe config.local.json.');
  process.exitCode = 1;
} else {
  writeFileSync(target, `${JSON.stringify({ walletConnectProjectId: projectId }, null, 2)}\n`);
  console.log(projectId ? 'config.local.json actualizado (no se imprime el id).' : 'config.local.json sin project id.');
}
