import { readRequest, sendResult } from '../server/http.js';
import {
  handleNotify,
  handleNotifySelf,
  handlePushConfig,
  handleRegisterToken
} from '../server/push.js';

// The service account is process.env.FIREBASE_SERVICE_ACCOUNT (the whole JSON).
// It is set on the Vercel project muzzsnap-app for Production and Preview.
// It is not in this bundle, the client, or git.
// notify-self sends a push only to the signed-in wallet. The body is ignored.
const routes = {
  notify: [handleNotify, 'push_failed'],
  'notify-self': [handleNotifySelf, 'push_failed'],
  register: [handleRegisterToken, 'register_failed'],
  config: [handlePushConfig, 'push_failed']
};

export function pushOp(req) {
  const fromQuery = req && req.query && req.query.op;
  if (fromQuery) return String(fromQuery);
  const raw = String((req && req.url) || '');
  const mark = raw.indexOf('?');
  if (mark < 0) return '';
  return new URLSearchParams(raw.slice(mark + 1)).get('op') || '';
}

export default async function handler(req, res) {
  const route = routes[pushOp(req)];
  if (!route) {
    sendResult(req, res, { status: 404, body: { error: 'not_found' } });
    return;
  }
  try {
    sendResult(req, res, await route[0](readRequest(req), { env: process.env }));
  } catch {
    sendResult(req, res, { status: 502, body: { error: route[1] } });
  }
}
