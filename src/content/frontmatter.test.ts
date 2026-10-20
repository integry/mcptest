import { describe, expect, it } from 'vitest';
import { FrontmatterError, parseFrontmatter, parseYaml } from './frontmatter';

describe('frontmatter parser', () => {
  it('splits the frontmatter block from the body and trims surrounding blank lines', () => {
    const { data, content } = parseFrontmatter('---\ntitle: Hello\n---\n\n# Body\n\nText.\n');
    expect(data).toEqual({ title: 'Hello' });
    expect(content).toBe('# Body\n\nText.');
  });

  it('accepts Windows line endings and a BOM', () => {
    const { data, content } = parseFrontmatter('\uFEFF---\r\ntitle: Hi\r\n---\r\nBody\r\n');
    expect(data).toEqual({ title: 'Hi' });
    expect(content).toBe('Body');
  });

  it('rejects documents without a frontmatter block', () => {
    expect(() => parseFrontmatter('# No frontmatter')).toThrow(FrontmatterError);
    expect(() => parseFrontmatter('---\ntitle: open\n')).toThrow(/frontmatter block/);
  });

  it('parses scalars: plain, quoted, numbers, booleans, null', () => {
    const data = parseYaml([
      'plain: What is MCP?',
      'colon: "Claude Code: Connect"',
      "single: 'it''s'",
      'number: 11',
      'decimal: 1.5',
      'negative: -3',
      'yes: true',
      'no: false',
      'nothing: null',
      'tilde: ~',
      'date: 2026-08-17',
      'quotedDate: "2026-08-17"',
      'url: https://example.com/a:b',
    ].join('\n'));

    expect(data).toEqual({
      plain: 'What is MCP?',
      colon: 'Claude Code: Connect',
      single: "it's",
      number: 11,
      decimal: 1.5,
      negative: -3,
      yes: true,
      no: false,
      nothing: null,
      tilde: null,
      date: '2026-08-17',
      quotedDate: '2026-08-17',
      url: 'https://example.com/a:b',
    });
  });

  it('parses inline and block lists, including lists of mappings', () => {
    const data = parseYaml([
      'inline: [a, "b, c", 3]',
      'block:',
      '  - one',
      '  - two',
      'sameIndent:',
      '- x',
      '- y',
      'links:',
      '  - title: First',
      '    url: "https://example.com/1"',
      '  - title: "Second: with colon"',
      '    url: https://example.com/2',
      'nested:',
      '  -',
      '    name: deep',
      'empty: []',
    ].join('\n'));

    expect(data).toEqual({
      inline: ['a', 'b, c', 3],
      block: ['one', 'two'],
      sameIndent: ['x', 'y'],
      links: [
        { title: 'First', url: 'https://example.com/1' },
        { title: 'Second: with colon', url: 'https://example.com/2' },
      ],
      nested: [{ name: 'deep' }],
      empty: [],
    });
  });

  it('parses nested mappings, block scalars, and ignores comments and blank lines', () => {
    const data = parseYaml([
      '# leading comment',
      'meta:',
      '  title: Nested',
      '',
      '  depth:',
      '    level: 2',
      'literal: |',
      '  line one',
      '  line two',
      'folded: >-',
      '  folded text',
      '  continues here',
      'after: done',
    ].join('\n'));

    expect(data).toEqual({
      meta: { title: 'Nested', depth: { level: 2 } },
      literal: 'line one\nline two\n',
      folded: 'folded text continues here',
      after: 'done',
    });
  });

  it('reports malformed syntax with a line number', () => {
    expect(() => parseYaml('title: ok\nnot a key value')).toThrow(/line 2/);
    expect(() => parseYaml('title: ok\ntitle: again')).toThrow(/Duplicate key: title/);
    expect(() => parseYaml('title: "unterminated')).toThrow(/Unterminated/);
    expect(() => parseYaml('  indented: no')).toThrow(/must not be indented/);
    expect(() => parseYaml('- list')).toThrow(/mapping, not a list/);
    expect(() => parseYaml('a:\n  b: 1\n    c: 2')).toThrow(/Unexpected indentation/);
  });

  it('returns an empty object for an empty frontmatter block', () => {
    expect(parseYaml('')).toEqual({});
    expect(parseYaml('# only a comment')).toEqual({});
  });
});
