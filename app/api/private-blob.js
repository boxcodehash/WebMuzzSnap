import { readRequest, sendResult } from '../server/http.js';
import { handlePrivateBlob } from '../server/blob.js';

export default async function handler(req, res) {
  try {
    sendResult(req, res, await handlePrivateBlob(readRequest(req), { env: process.env }));
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'blob_failed' } });
  }
}
