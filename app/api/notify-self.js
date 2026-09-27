import { readRequest, sendResult } from '../server/http.js';
import { handleNotifySelf } from '../server/push.js';

// Sends a push only to the signed-in wallet. The body is ignored.
// The service account stays in process.env.FIREBASE_SERVICE_ACCOUNT.
export default async function handler(req, res) {
  try {
    const result = await handleNotifySelf(readRequest(req), { env: process.env });
    sendResult(req, res, result);
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'push_failed' } });
  }
}
