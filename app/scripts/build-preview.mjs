import { cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'www'), dist, {
  recursive: true,
  filter: (src) => !src.endsWith('.map')
});

const result = spawnSync(process.execPath, ['scripts/write-local-config.mjs', 'dist/config.local.json'], {
  cwd: root,
  env: { ...process.env, MUZZ_PREVIEW: '1' },
  stdio: 'inherit'
});

if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Preview estático en app/dist (MUZZ_PREVIEW=1). No se sube a git.');
