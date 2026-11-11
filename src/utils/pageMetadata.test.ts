import { describe, expect, it } from 'vitest';
import { getDocsMetadata, HOME_METADATA } from './pageMetadata';

describe('page metadata', () => {
  it('matches the landing hero and targets remote MCP testing searches', () => {
    expect(HOME_METADATA.title).toBe('MCP Test: MCP Inspector Online & Playground | mcptest.io');
    expect(HOME_METADATA.title.length).toBeLessThanOrEqual(65);
    expect(HOME_METADATA.title.toLowerCase()).toContain('mcp test');
    expect(HOME_METADATA.title.toLowerCase()).toContain('mcp inspector online');
    expect(HOME_METADATA.title.toLowerCase()).toContain('playground');
    expect(HOME_METADATA.description).toContain('Test remote MCP servers online');
    expect(HOME_METADATA.description).toContain('no install or sign-up');
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
