import { readRequest, sendResult } from '../server/http.js';
import {
  handlePhotoMailbox,
  handlePrivateBlob,
  handlePrivateBlobAck,
  handlePrivateBlobDelete,
  handlePrivateBlobLink,
  handlePrivateBlobRead,
  handleWalletKey,
  handleWalletKeyRead
} from '../server/blob.js';

const routes = {
  blob: [handlePrivateBlob, 'blob_failed'],
  read: [handlePrivateBlobRead, 'blob_failed'],
  ack: [handlePrivateBlobAck, 'blob_failed'],
  delete: [handlePrivateBlobDelete, 'blob_failed'],
  link: [handlePrivateBlobLink, 'storage_failed'],
  mailbox: [handlePhotoMailbox, 'storage_failed'],
  key: [handleWalletKey, 'storage_failed'],
  'key-read': [handleWalletKeyRead, 'storage_failed']
};

export function privateOp(req) {
  const fromQuery = req && req.query && req.query.op;
  if (fromQuery) return String(fromQuery);
  const raw = String((req && req.url) || '');
  const mark = raw.indexOf('?');
  if (mark < 0) return '';
  return new URLSearchParams(raw.slice(mark + 1)).get('op') || '';
}

export default async function handler(req, res) {
  const route = routes[privateOp(req)];
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
