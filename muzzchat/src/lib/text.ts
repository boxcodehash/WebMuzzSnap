export function humanError(error: unknown): string {
  if (!(error instanceof Error)) return "Algo salió mal.";
  const code = (error as { code?: string }).code || "";
  const message = error.message
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/\s*\(functions\/[a-z0-9-]+\)\.?$/i, "")
    .trim();
  if (code === "functions/unavailable" || /failed to fetch|network|internal/i.test(message)) {
    return "No hay conexión con las funciones. Si estás en local, arranca el emulador (puertos 5001 y 9099).";
  }
  if (code === "functions/unauthenticated") return "La sesión caducó. Entra otra vez.";
  return message || "Algo salió mal.";
}

export function shortWallet(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatWhen(ts: number, now = Date.now()): string {
  const date = new Date(ts);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  if (sameDay) return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date);
}
