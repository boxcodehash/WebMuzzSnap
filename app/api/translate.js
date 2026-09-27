import { readRequest, sendResult } from '../server/http.js';
import { handleTranslate } from '../server/translate.js';

// Free translation. Message text is not logged.
export default async function handler(req, res) {
  try {
    const result = await handleTranslate(readRequest(req));
    sendResult(req, res, result);
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'translate_failed' } });
  }
}
