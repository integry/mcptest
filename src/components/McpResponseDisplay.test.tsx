import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import McpResponseDisplay, { getPrimaryResultData } from './McpResponseDisplay';

describe('MCP result display extraction', () => {
  it('extracts tool text content', () => {
    expect(getPrimaryResultData('tool_result', [{ type: 'text', text: '# Result' }]))
      .toBe('# Result');
  });

  it('extracts resource text so JSON can be rendered instead of escaped', () => {
    expect(getPrimaryResultData('resource_result', [{
      uri: 'file:///openapi.json',
      mimeType: 'application/json',
      text: '{"openapi":"3.1.0"}',
    }])).toBe('{"openapi":"3.1.0"}');
  });

  it('preserves multiple content blocks without dropping data', () => {
    const content = [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }];
    expect(getPrimaryResultData('tool_result', content)).toBe(content);
  });
});

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

  it('preserves each single newline in multiline plain-text MCP results', () => {
    const markup = renderToStaticMarkup(
      <McpResponseDisplay
        logEntry={{
          type: 'resource_result',
          data: [{
            type: 'text',
            text: 'first line\nsecond line\nthird line',
          }],
        }}
        showTimestamp={false}
      />
    );

    expect(markup).toContain(
      '<p>first line<br/>\nsecond line<br/>\nthird line</p>'
    );
  });
});
