import { readRequest, sendResult } from '../server/http.js';
import { handleRegisterToken } from '../server/push.js';

export default async function handler(req, res) {
  try {
    const result = await handleRegisterToken(readRequest(req), { env: process.env });
    sendResult(req, res, result);
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'register_failed' } });
  }
}
