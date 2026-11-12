// @vitest-environment node
// End-to-end: the app's own MCP client code, release-gate CLI and session
// probes connect to the fixture servers on a local HTTP instance of this worker.
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from './index.js';
import { PUBLIC_BEARER_TOKEN } from './fixtureServers.js';
import { runCli } from '../../src/cli/runCli';
import { RELEASE_GATE_EXIT_CODES } from '../../src/cli/releaseGate';
import { PublicReportSchema } from '../../src/utils/reportArtifact';
import { createLegacyMcpClient, createNegotiatingMcpClient, getProtocolDetails } from '../../src/utils/mcpClient';
import { checkSessionResilience } from '../../src/utils/sessionResilience';

let server;
let base;
const requests = [];

beforeAll(async () => {
  server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(incoming.method);
    requests.push(`${incoming.method} ${incoming.url}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const response = await worker.fetch(new Request(`http://${incoming.headers.host}${incoming.url}`, {
      method: incoming.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    }), {}, {});
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) outgoing.write(chunk);
    }
    outgoing.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/fixtures`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const connect = async (name, make = createNegotiatingMcpClient, requestInit) => {
  const client = make('mcptest-fixture-e2e');
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/${name}/mcp`), requestInit ? { requestInit } : undefined));
  return client;
};

describe('release gate CLI against the echo fixture', () => {
  it('produces a clean, fully scored report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mcptest-fixture-echo-'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const exitCode = await runCli(['--output-dir', outputDir, '--format', 'json', '--session-resilience', `${base}/echo/mcp`], {});
      expect(exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);

      const [filename] = await readdir(outputDir);
      const report = PublicReportSchema.parse(JSON.parse(await readFile(join(outputDir, filename), 'utf8')));
      expect(report.outcome.status).toBe('scored');
      expect(report.score).toEqual({ earned: report.score.maximum, maximum: report.score.maximum, percentage: 100 });
      expect(report.protocol).toEqual({ era: 'modern', version: '2026-07-28' });
      expect(report.transport).toEqual({ type: 'streamable-http' });
      for (const section of report.sections) {
        expect(section.status, section.name).toBe('evaluated');
        expect(section.score.earned, section.name).toBe(section.score.maximum);
        for (const evidence of section.evidence) expect(evidence.message, section.name).not.toMatch(/^✗/);
      }
      const priorities = report.releaseDecision.priorities;
      expect(priorities.filter((priority) => ['critical', 'high'].includes(priority.severity))).toEqual([]);
      expect(report.releaseDecision.status).not.toBe('blocked');
      expect(report.capabilityInventory.tools.items.map((tool) => tool.name).sort()).toEqual(['add', 'echo', 'headers', 'whoami']);
      expect(report.capabilityInventory.resources.items).toHaveLength(1);
      expect(report.capabilityInventory.prompts.items).toHaveLength(1);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      await rm(outputDir, { recursive: true, force: true });
    }
    expect(requests).toContain('POST /fixtures/echo/mcp');
  }, 60_000);
});

describe('app MCP client against the fixtures', () => {
  it.each([
    ['auto negotiation', createNegotiatingMcpClient, { era: 'modern', version: '2026-07-28' }],
    ['the legacy stateful flow', createLegacyMcpClient, { era: 'legacy', version: '2025-11-25' }],
  ])('connects to echo with %s and calls every capability', async (_label, make, protocol) => {
    const client = await connect('echo', make);
    try {
      expect(getProtocolDetails(client)).toEqual(protocol);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo', 'add', 'whoami', 'headers']);
      expect((await client.callTool({ name: 'echo', arguments: { message: 'hi' } })).content).toEqual([{ type: 'text', text: 'hi' }]);
      expect((await client.callTool({ name: 'add', arguments: { a: 1, b: 2 } })).structuredContent).toEqual({ sum: 3 });
      const whoami = await client.callTool({ name: 'whoami', arguments: {} });
      expect(whoami.structuredContent.protocolVersion).toBe(protocol.version);
      expect((await client.callTool({ name: 'headers', arguments: {} })).structuredContent.headers).toHaveProperty('mcp-protocol-version', protocol.version);
      expect((await client.listResources()).resources).toHaveLength(1);
      expect((await client.readResource({ uri: 'mcptest://fixtures/readme' })).contents[0].text).toContain('fixtures');
      expect((await client.getPrompt({ name: 'greeting', arguments: { name: 'Ada' } })).messages).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('auth-bearer rejects the client without the token and accepts the public token', async () => {
    await expect(connect('auth-bearer')).rejects.toThrow(/401|authoriz/i);
    const client = await connect('auth-bearer', createNegotiatingMcpClient, { headers: { Authorization: `Bearer ${PUBLIC_BEARER_TOKEN}` } });
    try {
      expect((await client.callTool({ name: 'echo', arguments: { message: 'ok' } })).content[0].text).toBe('ok');
    } finally {
      await client.close();
    }
  });

  it('errors surfaces each deterministic error mode to the client', async () => {
    const client = await connect('errors');
    try {
      await expect(client.callTool({ name: 'protocol_error', arguments: {} })).rejects.toMatchObject({ code: -32603 });
      await expect(client.callTool({ name: 'invalid_params', arguments: {} })).rejects.toMatchObject({ code: -32602 });
      expect((await client.callTool({ name: 'tool_error', arguments: {} })).isError).toBe(true);
      await expect(client.callTool({ name: 'http_500', arguments: {} })).rejects.toThrow(/500/);
    } finally {
      await client.close();
    }
  });

  it('slow streams progress notifications and honours a client timeout', async () => {
    const client = await connect('slow');
    try {
      const progress = [];
      const result = await client.callTool(
        { name: 'progress', arguments: { steps: 3, intervalMs: 10 } },
        { onprogress: (update) => progress.push(update.progress) },
      );
      expect(result.content[0].text).toBe('Completed 3 steps.');
      expect(progress).toEqual([1, 2, 3]);
      await expect(client.callTool({ name: 'sleep', arguments: { ms: 2_000 } }, { timeout: 100 })).rejects.toThrow(/timed out|timeout/i);
    } finally {
      await client.close();
    }
  });

  it('schemas returns structuredContent the client validates against outputSchema', async () => {
    const client = await connect('schemas');
    try {
      await client.listTools();
      const result = await client.callTool({
        name: 'create_order',
        arguments: { customer: { name: 'Ada' }, items: [{ sku: 'ABC-123', quantity: 1, unitPrice: 9.5 }] },
      });
      expect(result.structuredContent).toMatchObject({ total: 9.5, currency: 'USD' });
    } finally {
      await client.close();
    }
  });
});

describe('session resilience probes against the stateful flow', () => {
  it('passes unknown-id, re-initialize and stickiness, and treats DELETE 405 as informational', async () => {
    const findings = await checkSessionResilience({ endpoint: `${base}/echo/mcp`, fetch: globalThis.fetch.bind(globalThis) });
    const outcomes = Object.fromEntries(findings.map((finding) => [finding.id, finding.outcome]));
    expect(outcomes).toMatchObject({
      'session.unknown-id': 'pass',
      'session.reinitialize': 'pass',
      'session.stickiness': 'pass',
    });
    expect(findings.find((finding) => finding.id === 'session.delete').severity).not.toBe('error');
  }, 30_000);
});
