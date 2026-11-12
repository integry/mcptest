import { describe, expect, it } from 'vitest';
import { getDocsMetadata, HOME_METADATA } from './pageMetadata';

describe('page metadata', () => {
  it('matches the landing hero and targets remote MCP testing searches', () => {
    expect(HOME_METADATA.title).toBe('MCP Inspector Online & Playground: Test Remote MCP Servers | mcptest.io');
    expect(HOME_METADATA.title.toLowerCase()).toContain('test remote mcp server');
    expect(HOME_METADATA.title.toLowerCase()).toContain('mcp inspector online');
    expect(HOME_METADATA.description).toContain('Test remote MCP servers in an online inspector and playground');
  });

  it('returns custom metadata for documentation routes', () => {
    expect(getDocsMetadata('/docs/testing-guide')).toEqual({
      title: 'How to Test MCP Servers: Complete Guide with curl, Inspector and CI | mcptest.io',
      description: 'How to test MCP servers: unit tests, protocol checks with curl, the browser playground and MCP Inspector, OAuth, CORS, tool schemas, security and CI, plus a checklist.',
    });
    expect(getDocsMetadata('/docs/troubleshooting/')?.title).toBe(
      'MCP Server Errors: Causes and Fixes | mcptest.io'
    );
  });

  it('does not assign metadata to unknown or non-documentation routes', () => {
    expect(getDocsMetadata('/docs/missing')).toBeUndefined();
    expect(getDocsMetadata('/catalog')).toBeUndefined();
  });
});
