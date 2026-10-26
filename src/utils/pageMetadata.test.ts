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
      title: 'How to Test a Remote MCP Server (Step by Step) | mcptest.io',
      description: 'Test a remote MCP server step by step: verify its URL, connect in the inspector, check authentication, list tools and diagnose HTTP or session errors.',
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
