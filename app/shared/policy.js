/** Constantes compartidas. El mínimo real lo impone la Cloud Function (MIN_MUZZ). */

export const DEFAULT_MIN_MUZZ = 10_000_000;
export const TOKEN_ADDRESS = '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0';
export const CHAIN_ID = 1;

/** Borrado al leer: exactamente 24 h. Las reglas aceptan 23–25 h por el reloj. */
export const READ_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tope si nadie lee el sobre (privado o bandeja de un miembro del grupo).
 * Al leerse se sustituye por READ_TTL_MS. Ventana de reglas: 70–74 h.
 */
export const UNREAD_TTL_MS = 72 * 60 * 60 * 1000;

/** Copia del emisor en el grupo: no hay una lectura distinta del envío. */
export const SENDER_COPY_TTL_MS = 24 * 60 * 60 * 1000;

export const GROUP_ID = 'general';

export function threadId(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('__');
}
