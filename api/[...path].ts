import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../artifacts/api-server/src/app';

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
};

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return app(req as any, res as any);
}
