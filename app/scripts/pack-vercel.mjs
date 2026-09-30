import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SLIM_PACKAGE = {
  name: 'muzzsnap-app',
  private: true,
  version: '1.0.27',
  description: 'MuzzSnap site and /api/notify. FIREBASE_SERVICE_ACCOUNT is read from process.env and is not in this folder.',
  type: 'module',
  engines: { node: '>=20' },
  dependencies: { ethers: '6.17.0' }
};

const SKIP = new Set(['config.local.json', 'app.js', 'app.js.map']);

function copyFiltered(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyFiltered(from, to);
    else cpSync(from, to);
  }
}

export function stageVercelProject(dest, source = appRoot) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(source, 'api'), join(dest, 'api'), { recursive: true });
  cpSync(join(source, 'server'), join(dest, 'server'), { recursive: true });
  copyFiltered(join(source, 'www'), join(dest, 'www'));
  writeFileSync(join(dest, 'package.json'), JSON.stringify(SLIM_PACKAGE, null, 2) + '\n');
  cpSync(join(source, 'vercel.json'), join(dest, 'vercel.json'));
  return dest;
}

export function zipDirectory(dir, zipPath) {
  const result = spawnSync('python3', ['-c', [
    'import os, sys, zipfile',
    'root, out = sys.argv[1], sys.argv[2]',
    'z = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)',
    'for dirpath, dirnames, filenames in os.walk(root):',
    '    dirnames[:] = [d for d in dirnames if d != "node_modules"]',
    '    for name in filenames:',
    '        full = os.path.join(dirpath, name)',
    '        rel = os.path.relpath(full, root).replace(os.sep, "/")',
    '        z.write(full, rel)',
    'print(len(z.namelist()))',
    'z.close()'
  ].join('\n'), dir, zipPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'zip failed');
  }
  return Number(String(result.stdout).trim().split('\n').pop());
}

if (process.argv[1] && process.argv[1].endsWith('pack-vercel.mjs')) {
  const dest = process.argv[2] || join(appRoot, '..', 'www-deploy');
  const zip = process.argv[3] || '';
  stageVercelProject(dest);
  console.log('staged ' + dest);
  if (zip) console.log('entries ' + zipDirectory(dest, zip));
}
