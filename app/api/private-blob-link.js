import { readRequest, sendResult } from '../server/http.js';
import { handlePrivateBlobLink } from '../server/blob.js';

export default async function handler(req, res) {
  try {
    sendResult(req, res, await handlePrivateBlobLink(readRequest(req), { env: process.env }));
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'storage_failed' } });
  }
}
