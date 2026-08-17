import { describe, expect, it } from 'vitest';
import { getDocsMetadata, HOME_METADATA } from './pageMetadata';

describe('page metadata', () => {
  it('uses the branded homepage title and specific playground description', () => {
    expect(HOME_METADATA.title).toBe('mcptest.io | The Remote MCP Server Playground');
    expect(HOME_METADATA.description).toContain('tools, resources, prompts, and live responses');
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
