#!/usr/bin/env node

/**
 * Serves a built dist/ directory the way the production host resolves paths:
 * the file itself, a directory index, a `.html` sibling, then the SPA shell
 * for the app routes in dist/routes.txt, and dist/404.html with a 404 status
 * for anything else (see docs/site-hygiene.md).
 * Text assets are gzip-compressed and hashed assets are cached like they are
 * in production, so Lighthouse measures the shipped bundle rather than an
 * uncompressed dev server.
 *
 *   node tests/e2e/static-server.mjs [--dist dist] [--port 4173] [--host 127.0.0.1]
 *
 * Used by playwright.config.ts (webServer) and lighthouserc.cjs (startServerCommand).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest\+json)|image\/svg\+xml)/;

/** dist/routes.txt: `/path` lines are exact routes, `/prefix/*` lines match below the prefix. */
function loadAppRoutes(root) {
  const routesPath = path.join(root, 'routes.txt');
  if (!fs.existsSync(routesPath)) return null;
  const lines = fs.readFileSync(routesPath, 'utf8').split('\n').map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
  const exact = new Set(lines.filter(line => !line.endsWith('/*')));
  const prefixes = lines.filter(line => line.endsWith('/*')).map(line => line.slice(0, -1));
  return pathname => exact.has(pathname) || prefixes.some(prefix => pathname.startsWith(prefix) && pathname.length > prefix.length);
}

export function createStaticServer(distDir) {
  const root = path.resolve(distDir);
  const isAppRoute = loadAppRoutes(root);
  const notFoundPage = path.join(root, '404.html');
  const isFile = candidate => candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  const resolve = (pathname) => {
    const candidates = [
      path.join(root, pathname),
      path.join(root, pathname, 'index.html'),
      path.join(root, `${pathname.replace(/\/$/, '')}.html`),
    ];
    return candidates.find(isFile) || null;
  };

  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const resolved = resolve(pathname);
    // Without a routes.txt (an older build) every unknown path gets the shell.
    const notFound = !resolved && isAppRoute && !isAppRoute(pathname) && fs.existsSync(notFoundPage);
    const file = resolved || (notFound ? notFoundPage : path.join(root, 'index.html'));
    const type = CONTENT_TYPES[path.extname(file)] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    };
    // Missing hashed assets are bare 404s.
    if (!resolved && pathname.startsWith('/assets/')) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const body = fs.readFileSync(file);
    const status = notFound ? 404 : 200;
    if (COMPRESSIBLE.test(type) && /\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
      const compressed = zlib.gzipSync(body);
      response.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': compressed.length, Vary: 'Accept-Encoding' });
      response.end(request.method === 'HEAD' ? undefined : compressed);
      return;
    }
    response.writeHead(status, { ...headers, 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

function parseArgs(argv) {
  const options = { dist: 'dist', port: 4173, host: '127.0.0.1' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dist') options.dist = argv[++index];
    else if (flag === '--port') options.port = Number(argv[++index]);
    else if (flag === '--host') options.host = argv[++index];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(path.join(options.dist, 'index.html'))) {
    console.error(`${options.dist}/index.html is missing; run npm run build first.`);
    process.exit(1);
  }
  createStaticServer(options.dist).listen(options.port, options.host, () => {
    console.log(`Serving ${options.dist} at http://${options.host}:${options.port}`);
  });
}
