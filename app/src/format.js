export function formatMuzz(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '0';
  const negative = raw.startsWith('-');
  const clean = raw.replace('-', '');
  const [wholeRaw, fracRaw = ''] = clean.split('.');
  const digits = wholeRaw.replace(/\D/g, '') || '0';
  const whole = digits.replace(/^0+(?=\d)/, '') || '0';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = fracRaw.replace(/\D/g, '').slice(0, 2).replace(/0+$/, '');
  const body = frac ? `${grouped}.${frac}` : grouped;
  return negative ? `-${body}` : body;
}

export function formatTime(ms) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function dayLabel(ms) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(date);
}

export function remainingLabel(message) {
  if (!message) return '';
  if (!message.readAt && message.kind !== 'sender-copy') return 'Unread';
  if (typeof message.expireAt !== 'number') return '';
  const leftMs = message.expireAt - Date.now();
  if (leftMs <= 0) return 'Expired';
  const hours = Math.floor(leftMs / 3600000);
  const minutes = Math.max(1, Math.floor((leftMs % 3600000) / 60000));
  const left = hours >= 1 ? `${hours} h` : `${minutes} min`;
  if (message.kind === 'sender-copy') return `Deletes in ${left}`;
  return `Read · ${left}`;
}

export function metaLine(message) {
  const time = formatTime(message.sentAt);
  const extra = remainingLabel(message);
  return extra ? `${time} · ${extra}` : time;
}
