import type { IncomingMessage, ServerResponse } from 'node:http';
import { lookupTokenHolders } from '../../_lib/token-holders';

export const config = {
  maxDuration: 60,
};

function applyCors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  applyCors(res);
  res.end(JSON.stringify(body));
}

function readIdentifier(req: IncomingMessage & { query?: Record<string, string | string[]> }) {
  const raw = req.query?.identifier;
  if (raw) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return decodeURIComponent(String(value));
  }
  const match = String(req.url || '').match(/\/token-holders\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default async function handler(req: IncomingMessage & { query?: Record<string, string | string[]> }, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    applyCors(res);
    res.end();
    return;
  }

  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const result = await lookupTokenHolders(readIdentifier(req));
  sendJson(res, result.status, result.body);
}
