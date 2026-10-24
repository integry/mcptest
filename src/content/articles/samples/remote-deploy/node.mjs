import { serve } from '@hono/node-server';
import app from './app.mjs';
serve({ fetch: app.fetch, hostname: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
