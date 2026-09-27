import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function googleServicesPresent(dir = root) {
  const file = join(dir, 'android', 'app', 'google-services.json');
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').trim().startsWith('{');
}

export function stripGradlePush(text) {
  return String(text)
    .replace(/\n+include ':capacitor-push-notifications'\r?\nproject\(':capacitor-push-notifications'\)\.projectDir = new File\('[^']*'\)\r?\n?/g, '\n')
    .replace(/\n+[ \t]*implementation project\(':capacitor-push-notifications'\)\r?\n?/g, '\n');
}

export function stripPluginJson(text) {
  const list = JSON.parse(text).filter((item) => !item || item.pkg !== '@capacitor/push-notifications');
  return JSON.stringify(list, null, '\t') + '\n';
}

export function installGoogleServices(dir = root) {
  const dest = join(dir, 'android', 'app', 'google-services.json');
  if (googleServicesPresent(dir)) return dest;
  const candidates = [
    join(dir, '..', 'uploads', 'google-services.json'),
    join(dir, 'uploads', 'google-services.json')
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.trim().startsWith('{')) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text.endsWith('\n') ? text : text + '\n');
    return dest;
  }
  return '';
}

export function applyAndroidPush(dir = root) {
  installGoogleServices(dir);
  if (googleServicesPresent(dir)) return 'fcm';
  for (const file of [
    join(dir, 'android', 'capacitor.settings.gradle'),
    join(dir, 'android', 'app', 'capacitor.build.gradle')
  ]) {
    if (!existsSync(file)) continue;
    const current = readFileSync(file, 'utf8');
    const next = stripGradlePush(current);
    if (next !== current) writeFileSync(file, next);
  }
  const plugins = join(dir, 'android', 'app', 'src', 'main', 'assets', 'capacitor.plugins.json');
  if (existsSync(plugins)) writeFileSync(plugins, stripPluginJson(readFileSync(plugins, 'utf8')));
  return 'local';
}

if (process.argv[1] && process.argv[1].endsWith('android-push.mjs')) {
  const mode = applyAndroidPush(root);
  if (mode === 'fcm') {
    console.log('google-services.json found. The FCM plugin stays in the Android build.');
  } else {
    console.log('google-services.json missing. FCM plugin left out so the APK still launches. Local notifications stay on.');
  }
}
