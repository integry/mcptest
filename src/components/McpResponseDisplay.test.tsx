import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import McpResponseDisplay from './McpResponseDisplay';

describe('McpResponseDisplay markdown security', () => {
  it('renders Markdown while dropping untrusted HTML and unsafe links', () => {
    const markup = renderToStaticMarkup(
      <McpResponseDisplay
        logEntry={{
          type: 'tool_result',
          data: [{
            type: 'text',
            text: [
              '**Safe result**',
              '<img src=x onerror="alert(1)">',
              '<script>alert(2)</script>',
              '[unsafe link](javascript:alert(3))',
              '[unsafe data](data:text/html,alert(4))',
              '[unsafe vbscript](vbscript:alert(5))',
              '[obfuscated](java&#x09;script:alert(6))',
            ].join('\n'),
          }],
        }}
        showTimestamp={false}
      />
    );

    expect(markup).toContain('<strong>Safe result</strong>');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('onerror');
    expect(markup).not.toContain('javascript:');
    expect(markup).not.toContain('data:text/html');
    expect(markup).not.toContain('vbscript:');
  });

  it('preserves single newlines in plain-text MCP results', () => {
    const markup = renderToStaticMarkup(
      <McpResponseDisplay
        logEntry={{
          type: 'resource_result',
          data: [{ type: 'text', text: 'first line\nsecond line' }],
        }}
        showTimestamp={false}
      />
    );

    expect(markup).toContain('first line<br/>\nsecond line');
  });
});
