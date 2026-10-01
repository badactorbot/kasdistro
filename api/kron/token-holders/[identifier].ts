import type { IncomingMessage, ServerResponse } from 'node:http';
import { lookupTokenHolders } from '../_lib/token-holders';

export const config = {
  maxDuration: 60,
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage & { query?: Record<string, string | string[]> }, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.end();
    return;
  }

  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const raw = req.query?.identifier;
  const identifier = Array.isArray(raw) ? raw[0] : raw ?? '';
  const decoded = decodeURIComponent(String(identifier));
  const result = await lookupTokenHolders(decoded);
  sendJson(res, result.status, result.body);
}
