const KNOWN = {
  '0x208157b5ec396759e8754058108ecf53e32392ff': 'Ryachu',
  '0xfab5835ca14fb3f9f978c5e4d733734e6394e03f': 'Itsuki',
  '0x875c5a7794b601f273da58e3c1d10671d16130ec': 'Esteban'
};

export function displayName(wallet, me) {
  const id = String(wallet || '').toLowerCase();
  if (me && id === String(me).toLowerCase()) return 'You';
  if (KNOWN[id]) return KNOWN[id];
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
