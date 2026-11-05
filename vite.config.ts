import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import communityChatHandler from './api/community-chat.js';
import authPhoneHandler from './api/auth-phone.js';
import memberSelfHandler from './api/member-self.js';
import intercessorsHandler from './api/intercessors.js';
import pushHandler from './api/push.js';

const MAX_DEV_BODY_BYTES = 8192;

async function readRawBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        finish(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
  });
}

/** Shape a Node request like a Vercel function request (local dev only). */
async function vercelLike(req: IncomingMessage) {
  const url = new URL(req.url || '/', 'http://localhost');
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const headers: Record<string, string | undefined> = {
    authorization: req.headers.authorization,
    'content-type': typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined,
  };
  let body: unknown = undefined;
  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
    const raw = await readRawBody(req, MAX_DEV_BODY_BYTES);
    if (raw == null) body = null;
    else if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
  }
  return { method: req.method || 'GET', headers, query, body };
}

function vercelLikeRes(res: ServerResponse) {
  return {
    setHeader: (k: string, v: string) => {
      res.setHeader(k, v);
    },
    status(code: number) {
      res.statusCode = code;
      return {
        json(body: unknown) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        },
      };
    },
  };
}

type Handler = (req: any, res: any) => unknown;

function chatApiDevBridge() {
  const routes: Array<[string, Handler]> = [
    ['/api/community-chat', communityChatHandler],
    ['/api/auth-phone', authPhoneHandler],
    ['/api/member-self', memberSelfHandler],
    ['/api/intercessors', intercessorsHandler],
    ['/api/push', pushHandler],
  ];
  return {
    name: 'awc-chat-api-dev-bridge',
    configureServer(server: any) {
      for (const [route, handler] of routes) {
        server.middlewares.use(route, async (req: IncomingMessage, res: ServerResponse) => {
          try {
            await handler(await vercelLike(req), vercelLikeRes(res));
          } catch {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'private, no-store');
            res.end(JSON.stringify({ ok: false, code: 'vault_unavailable', message: 'Please try again.' }));
          }
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['VAULT_API_ORIGIN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  return {
    server: { port: 3001, host: '0.0.0.0' },
    plugins: [react(), chatApiDevBridge()],
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'vendor-react';
            if (id.includes('@supabase')) return 'vendor-supabase';
          },
        },
      },
    },
  };
});
