import { Buffer as PolyfillBuffer } from 'buffer';

// WalletConnect encodes the pairing URI with Buffer. The Android WebView has
// no Node Buffer, so the wallet list threw "Buffer is not defined" before a
// wallet was chosen. This runs before AppKit loads.
const root = globalThis;
if (typeof root.Buffer === 'undefined') root.Buffer = PolyfillBuffer;
if (typeof root.process === 'undefined') root.process = { env: {} };
else if (!root.process.env) root.process.env = {};
if (typeof window !== 'undefined') {
  if (!window.Buffer) window.Buffer = PolyfillBuffer;
  if (!window.global) window.global = window;
  if (!window.process) window.process = root.process;
  else if (!window.process.env) window.process.env = root.process.env;
}
root.__muzzBufferPolyfill = 'muzz-buffer-polyfill';

export { PolyfillBuffer as Buffer };
