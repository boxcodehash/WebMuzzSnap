import { readRequest, sendResult } from '../server/http.js';
import { handleNotify } from '../server/push.js';

// The service account is process.env.FIREBASE_SERVICE_ACCOUNT (the whole JSON).
// It is set on the Vercel project muzzsnap-app for Production and Preview.
// It is not in this bundle, the client, or git.
export default async function handler(req, res) {
  try {
    const result = await handleNotify(readRequest(req), { env: process.env });
    sendResult(req, res, result);
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'push_failed' } });
  }
}
