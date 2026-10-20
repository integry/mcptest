import { describe, expect, it } from 'vitest';
import { getClientCompatibility } from '../data/clientCompatibility';
import { createArticle, getArticleBodyMarkdown } from './contentModel';
import {
  CLIENT_COMPATIBILITY_DATA_URL,
  expandCompatMatrixDirectives,
  parseCompatMatrixDirective,
  renderCompatMatrixMarkdown,
} from './compatMatrix';

const tableRows = (markdown: string) => markdown.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---'));

describe('compat-matrix directive', () => {
  it('renders one row per client with its version and verified date', () => {
    const markdown = renderCompatMatrixMarkdown(['claude-code', 'cursor']);
    const rows = tableRows(markdown);
    const claudeCode = getClientCompatibility('claude-code');
    const cursor = getClientCompatibility('cursor');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('| Client | Version | Streamable HTTP | Legacy SSE | stdio |');
    expect(rows[0]).toContain('| Verified |');
    expect(rows[1]).toContain(`[Claude Code](${claudeCode?.documentationUrl})`);
    expect(rows[1]).toContain('| 2.1.304 |');
    expect(rows[1]).toContain(`| ${claudeCode?.verifiedOn} |`);
    expect(rows[2]).toContain(`[Cursor](${cursor?.documentationUrl})`);
    expect(rows[2]).toContain('DCR, pre-registered client; CIMD unknown');
    expect(markdown).toContain(CLIENT_COMPATIBILITY_DATA_URL);
  });

  it('prints unknown and limited cells instead of guessing', () => {
    const [, row] = tableRows(renderCompatMatrixMarkdown(['claude-ai']));
    const cells = row.split(' | ');

    expect(cells[1]).toBe('unknown');
    expect(cells[5]).toBe('unknown');
    expect(row).toContain('custom headers, bearer token, API key header limited');
  });

  it('lists sourced limitations only when asked', () => {
    expect(renderCompatMatrixMarkdown(['cursor'])).not.toContain('Known limitations');
    const withLimitations = renderCompatMatrixMarkdown(['cursor'], { limitations: true });
    expect(withLimitations).toContain('Known limitations:');
    expect(withLimitations).toContain('- **Cursor:** envFile works only for stdio servers. ([Cursor docs: Model Context Protocol (MCP)](https://cursor.com/docs/context/mcp))');
  });

  it('drops the guide link on the guide itself', () => {
    expect(renderCompatMatrixMarkdown(['cursor'])).toContain('([guide](/learn/connect-mcp-server-to-cursor))');
    expect(renderCompatMatrixMarkdown(['cursor'], { currentPath: '/learn/connect-mcp-server-to-cursor' }))
      .not.toContain('([guide]');
  });

  it('parses attributes and rejects unknown clients and attributes', () => {
    expect(parseCompatMatrixDirective(' clients="cursor, gemini-cli" limitations="true" ')).toEqual({
      clients: ['cursor', 'gemini-cli'],
      limitations: true,
    });
    expect(() => renderCompatMatrixMarkdown(['netscape'])).toThrow(/unknown client netscape/);
    expect(() => parseCompatMatrixDirective(' client="cursor" ')).toThrow(/unknown attribute client/);
  });

  it('expands directives in place and leaves other comments alone', () => {
    const content = 'Intro\n\n<!-- compat-matrix clients="cursor" -->\n\n<!-- component -->\n\nOutro';
    const expanded = expandCompatMatrixDirectives(content);

    expect(expanded).not.toContain('compat-matrix');
    expect(expanded).toContain('<!-- component -->');
    expect(tableRows(expanded)).toHaveLength(2);
  });

  it('puts the table in the article body used for HTML and the .md export', () => {
    const article = createArticle({
      title: 'Matrix',
      summary: 'Summary',
      category: 'Clients',
      readingTimeMinutes: 1,
      lastReviewed: '2026-10-20',
      track: 'use',
      level: 'newcomer',
      order: 1,
    }, '## Matrix\n\n<!-- compat-matrix clients="vscode-copilot" -->\n', 'matrix.md');

    expect(getArticleBodyMarkdown(article)).toContain('[VS Code with GitHub Copilot](');
    expect(getArticleBodyMarkdown(article)).not.toContain('compat-matrix');
  });
});
