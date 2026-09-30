import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd || root,
    env: opts.env || process.env
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['scripts/sync-shared.mjs']);
run(process.execPath, ['scripts/build.mjs']);
run(process.execPath, ['scripts/write-local-config.mjs'], {
  env: { ...process.env, MUZZ_PREVIEW: '1' }
});
run('npx', ['cap', 'sync', 'android']);

const gradleEnv = { ...process.env };
if (androidHome) {
  gradleEnv.ANDROID_HOME = androidHome;
  gradleEnv.ANDROID_SDK_ROOT = androidHome;
}
run('./gradlew', ['assembleDebug'], { cwd: join(root, 'android'), env: gradleEnv });

run(process.execPath, ['scripts/write-local-config.mjs'], {
  env: { ...process.env, MUZZ_PREVIEW: '0' }
});

console.log('APK debug (preview) en android/app/build/outputs/apk/debug/app-debug.apk');
