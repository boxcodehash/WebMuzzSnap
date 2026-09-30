import { readRequest, sendResult } from '../server/http.js';
import { handleTranslate } from '../server/translate.js';

// Message text is not logged. Provider keys are read from the environment only.
export default async function handler(req, res) {
  try {
    const result = await handleTranslate(readRequest(req), { env: process.env });
    sendResult(req, res, result);
  } catch {
    sendResult(req, res, { status: 502, body: { error: 'translate_failed' } });
  }
}
