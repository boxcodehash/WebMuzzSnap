const KNOWN = {
  '0x208157b5ec396759e8754058108ecf53e32392ff': 'RYASHU',
  '0x3e1c5e792fc73e8a2b72df4b0a8a8a462b2ce501': 'ITZUKI',
  '0x875c5a7794b601f273da58e3c1d10671d16130ec': 'Esteban'
};
const WHITELIST = '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a';

export function displayName(wallet, me) {
  const id = String(wallet || '').toLowerCase();
  if (me && id === String(me).toLowerCase()) return 'You';
  if (KNOWN[id]) return KNOWN[id];
  if (id === WHITELIST) return 'Node_' + id.slice(-6);
  if (id.length < 6) return 'Node';
  return `Node ${id.slice(-4)}`;
}

export function shortAddr(wallet) {
  const id = String(wallet || '');
  if (id.length < 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function avatarText(wallet) {
  const id = String(wallet || '').toLowerCase();
  const known = KNOWN[id];
  if (known) return known.slice(0, 2).toUpperCase();
  return id.slice(-2).toUpperCase() || '··';
}

export function avatarColor(wallet) {
  let n = 0;
  for (const ch of String(wallet || '')) n = (n * 33 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 32% 28%)`;
}
