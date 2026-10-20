import { describe, expect, it } from 'vitest';
import { getDocsMetadata, HOME_METADATA } from './pageMetadata';

describe('page metadata', () => {
  it('matches the landing hero and targets remote MCP testing searches', () => {
    expect(HOME_METADATA.title).toBe('Test Remote MCP Servers | MCP Inspector Online | mcptest.io');
    expect(HOME_METADATA.title.toLowerCase()).toContain('test remote mcp server');
    expect(HOME_METADATA.title.toLowerCase()).toContain('mcp inspector online');
    expect(HOME_METADATA.description).toContain('Inspect, debug and evaluate remote MCP servers in your browser');
  });

  it('returns custom metadata for documentation routes', () => {
    expect(getDocsMetadata('/docs/testing-guide')).toEqual({
      title: 'Testing Guide for Remote MCP Servers | mcptest.io',
      description: 'Learn how to test, inspect, and debug remote Model Context Protocol (MCP) servers. A step-by-step developer guide for validating stateless and stateful flows.',
    });
    expect(getDocsMetadata('/docs/troubleshooting/')?.title).toBe(
      'Troubleshooting MCP Server Errors | mcptest.io'
    );
  });

  it('does not assign metadata to unknown or non-documentation routes', () => {
    expect(getDocsMetadata('/docs/missing')).toBeUndefined();
    expect(getDocsMetadata('/catalog')).toBeUndefined();
  });
});
