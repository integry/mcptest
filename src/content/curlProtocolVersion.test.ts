// @vitest-environment node
// Runs the curl article's stateful 2025 commands against a local server, so it needs Node's http module rather than jsdom.

import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const article = readFileSync(resolve('src/content/articles/test-mcp-server-with-curl-and-postman.md'), 'utf8');
// The 2025 walkthrough and the SSE section both reuse the variables captured by the initialize command.
const statefulSections = article.slice(article.indexOf('## Stateful 2025 servers with curl'), article.indexOf('## Bearer tokens and OAuth'));
const bashBlocks = [...statefulSections.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
const NEGOTIATED = '2025-03-26';

function hasCommand(name: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRunCommands = ['bash', 'curl', 'jq'].every(hasCommand);

type Seen = { method: string; version: string | undefined; session: string | undefined };

// A 2025 server that answers initialize with an older version than the client proposed and rejects any later request that does not repeat it.
function startOlderVersionServer(format: 'json' | 'sse', seen: Seen[]): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const message = JSON.parse(body) as { id?: number; method: string };
      const headers: IncomingHttpHeaders = req.headers;
      const send = (payload: unknown) => {
        if (format === 'sse') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        }
      };
      if (message.method === 'initialize') {
        res.setHeader('Mcp-Session-Id', 'session-1');
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: NEGOTIATED, capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1.0.0' } } });
        return;
      }
      const version = headers['mcp-protocol-version'] as string | undefined;
      const session = headers['mcp-session-id'] as string | undefined;
      seen.push({ method: message.method, version, session });
      if (version !== NEGOTIATED || session !== 'session-1') {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`unsupported protocol version ${version}`);
        return;
      }
      if (message.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } });
    });
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer(server)));
}

describe('curl article stateful 2025 workflow', () => {
  let server: Server | undefined;
  let workDir: string | undefined;

  afterEach(async () => {
    await new Promise((done) => (server ? server.close(done) : done(undefined)));
    server = undefined;
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  it('captures the negotiated version from the initialize result', () => {
    expect(bashBlocks.length).toBeGreaterThanOrEqual(3);
    expect(bashBlocks[0]).toMatch(/PROTOCOL_VERSION=/);
    expect(bashBlocks[0]).toContain('.result.protocolVersion');
  });

  it('sends the captured version, not a fixed one, on every request after initialize', () => {
    const versionHeaders = bashBlocks.join('\n').match(/MCP-Protocol-Version: [^"]*/g) ?? [];
    expect(versionHeaders.length).toBeGreaterThanOrEqual(4);
    expect(new Set(versionHeaders)).toEqual(new Set(['MCP-Protocol-Version: $PROTOCOL_VERSION']));
  });

  it.skipIf(!canRunCommands).each(['json', 'sse'] as const)(
    'completes against a %s server that negotiates an older version',
    async (format) => {
      const seen: Seen[] = [];
      server = await startOlderVersionServer(format, seen);
      const { port } = server.address() as AddressInfo;
      workDir = mkdtempSync(join(tmpdir(), 'curl-article-'));
      const script = bashBlocks.join('\n').replace('https://your-server.example.com/mcp', `http://127.0.0.1:${port}/mcp`);
      const { stdout } = await promisify(execFile)('bash', ['-c', script], { cwd: workDir, timeout: 20000 });

      expect(stdout).toContain(`session: session-1, version: ${NEGOTIATED}`);
      expect(stdout).not.toContain('unsupported protocol version');
      expect(seen.map((request) => request.method)).toEqual(['notifications/initialized', 'tools/list', 'tools/call', 'tools/list']);
      expect(seen.every((request) => request.version === NEGOTIATED && request.session === 'session-1')).toBe(true);
      if (format === 'sse') expect(stdout).toContain('"echo"');
    },
    30000,
  );
});
