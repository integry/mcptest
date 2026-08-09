import { describe, expect, it } from 'vitest';
import { parseServerUrl } from '../src/utils/urlUtils';
import seoGenerator from './generate-seo-pages.js';

const { renderServerHtml } = seoGenerator;
const indexHtml = '<html><head><title>mcptest.io</title></head><body><div id="root"></div></body></html>';

function catalogServer(url, declaredTransport) {
  return {
    id: 'example-server',
    name: 'Example Server',
    url,
    description: 'An example MCP server.',
    category: 'Testing',
    tags: ['example'],
    declaredTransport,
    transport: declaredTransport,
    requiresOAuth: false,
    status: 'online',
  };
}

describe('generated server report Playground links', () => {
  it('preserves an endpoint ending in /mcp before the transport marker', () => {
    const html = renderServerHtml(
      indexHtml,
      catalogServer('https://mcp.linear.app/mcp', 'streamable-http')
    );

    expect(html).toContain('href="/server/https://mcp.linear.app/mcp/mcp"');
    expect(parseServerUrl('/server/https://mcp.linear.app/mcp/mcp')).toEqual({
      serverUrl: 'https://mcp.linear.app/mcp',
      transportMethod: 'mcp',
    });
  });

  it('preserves an endpoint ending in /sse before the transport marker', () => {
    const html = renderServerHtml(
      indexHtml,
      catalogServer('https://example.com/sse', 'legacy-sse')
    );

    expect(html).toContain('href="/server/https://example.com/sse/sse"');
    expect(parseServerUrl('/server/https://example.com/sse/sse')).toEqual({
      serverUrl: 'https://example.com/sse',
      transportMethod: 'sse',
    });
  });

  it('uses the validated transport when it differs from the declaration', () => {
    const server = catalogServer('https://example.com/endpoint', 'streamable-http');
    server.transport = 'legacy-sse';

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('href="/server/https://example.com/endpoint/sse"');
    expect(parseServerUrl('/server/https://example.com/endpoint/sse')).toEqual({
      serverUrl: 'https://example.com/endpoint',
      transportMethod: 'sse',
    });
  });
});
