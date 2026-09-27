import { readRequest, sendResult } from '../server/http.js';
import { handleSession } from '../server/push.js';

export default async function handler(req, res) {
  try {
    const result = await handleSession(readRequest(req));
    sendResult(req, res, result);
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'session_failed' } });
  }
}
