import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function html(file) {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

function policyOf(source) {
  const match = source.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(match, 'page has a CSP');
  const parts = {};
  for (const chunk of match[1].split(';')) {
    const bits = chunk.trim().split(/\s+/);
    if (!bits[0]) continue;
    parts[bits[0]] = bits.slice(1);
  }
  return parts;
}

function origin(url) {
  return new URL(url).origin;
}

function allows(list, url) {
  const host = new URL(url).host;
  const scheme = new URL(url).protocol;
  return list.some((token) => {
    if (token === origin(url)) return true;
    if (token === scheme + '//' + host) return true;
    if (token.startsWith(scheme + '//*.')) {
      const suffix = token.slice((scheme + '//*.').length);
      return host === suffix || host.endsWith('.' + suffix);
    }
    return false;
  });
}

function externalUrls(source, rel) {
  const urls = [];
  const re = /<(script|link)\b[^>]*>/gi;
  let tag;
  while ((tag = re.exec(source))) {
    const el = tag[0];
    const src = el.match(/\b(?:src|href)="(https:\/\/[^"]+)"/i);
    if (!src) continue;
    if (rel === 'script' && !/^<script/i.test(el)) continue;
    if (rel === 'style' && !/rel="stylesheet"/i.test(el)) continue;
    if (rel === 'preconnect' && !/rel="preconnect"/i.test(el)) continue;
    urls.push(src[1]);
  }
  return urls;
}

test('chat CSP allows every external host the page loads, including icon fonts', () => {
  const source = html('../www/chat.html');
  const policy = policyOf(source);
  for (const url of externalUrls(source, 'script')) {
    assert.ok(allows(policy['script-src'], url), 'script-src missing ' + url);
  }
  for (const url of externalUrls(source, 'style')) {
    assert.ok(allows(policy['style-src'], url), 'style-src missing ' + url);
  }
  for (const url of externalUrls(source, 'preconnect')) {
    assert.ok(allows(policy['connect-src'] || [], url), 'connect-src missing ' + url);
  }
  assert.ok(allows(policy['style-src'], 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css'));
  assert.ok(allows(policy['font-src'], 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.woff2'));
  assert.match(source, /fa-laugh-beam/);
  assert.match(source, /fa-paper-plane/);
  assert.match(source, /fa-sun/);
  assert.match(source, /aria-label="Emoji"/);
  assert.match(source, /aria-label="Send"/);
  assert.match(source, /aria-label="Toggle theme"/);
});

test('login and private CSP allow the hosts those pages load', () => {
  for (const file of ['../www/login.html', '../www/private.html']) {
    const source = html(file);
    const policy = policyOf(source);
    for (const url of externalUrls(source, 'script')) {
      assert.ok(allows(policy['script-src'], url), file + ' script-src missing ' + url);
    }
    for (const url of externalUrls(source, 'style')) {
      assert.ok(allows(policy['style-src'], url), file + ' style-src missing ' + url);
    }
    for (const url of externalUrls(source, 'preconnect')) {
      assert.ok(allows(policy['connect-src'] || [], url), file + ' connect-src missing ' + url);
    }
  }
});
