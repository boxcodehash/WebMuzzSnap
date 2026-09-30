import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('custom stickers are local assets and can be sent in chat and private', () => {
  const catalog = read('../www/js/stickers.js');
  const chat = read('../www/chat.html');
  const priv = read('../www/private.html');
  const stickers = [
    ['muzz', 'MUZZ', '../www/stickers/muzz.svg'],
    ['moon', 'To the moon', '../www/stickers/to-the-moon.svg'],
    ['soy-verga', 'Soy verga', '../www/stickers/soy-verga.svg'],
    ['boss', 'The Boss', '../www/stickers/the-boss.svg']
  ];
  for (const [id, label, file] of stickers) {
    assert.match(catalog, new RegExp("id: '" + id + "'"));
    assert.match(catalog, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const svg = read(file);
    assert.match(svg, /<svg/);
    if (id === 'muzz') assert.match(svg, />MUZZ</);
    if (id === 'moon') assert.match(svg, />TO THE MOON</);
    if (id === 'soy-verga') {
      assert.match(svg, />SOY</);
      assert.match(svg, />VERGA</);
    }
    if (id === 'boss') assert.match(svg, />THE BOSS</);
    assert.match(catalog, new RegExp('stickers/' + file.split('/').pop().replace('.', '\\.')));
  }
  assert.match(catalog, /\[\[sticker:/);
  assert.match(chat, /js\/stickers\.js/);
  assert.match(chat, /STICKERS/);
  assert.match(chat, /MuzzStickers\.token/);
  assert.match(chat, /renderRich/);
  assert.match(priv, /js\/stickers\.js/);
  assert.match(priv, /id="emojiBtn"/);
  assert.match(priv, /MuzzStickers\.paint/);
  assert.match(priv, /MuzzStickers\.token/);
  assert.match(read('../www/css/app.css'), /\.muzz-sticker/);
  assert.match(read('../android/app/build.gradle'), /versionName "1\.0\.26"/);
  const manifest = JSON.parse(read('../apk-dl/version.json'));
  assert.equal(manifest.versionName, '1.0.26');
  assert.equal(manifest.versionCode, 26);
});
