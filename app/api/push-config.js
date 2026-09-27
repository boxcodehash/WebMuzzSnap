import { readRequest, sendResult } from '../server/http.js';
import { handlePushConfig } from '../server/push.js';

export default function handler(req, res) {
  try {
    sendResult(req, res, handlePushConfig(readRequest(req), { env: process.env }));
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'push_failed' } });
  }
}
