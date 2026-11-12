import { describe, expect, it } from 'vitest';
import {
  fuzzyMatch,
  highlightSegments,
  prepareFields,
  rankItems,
  type PreparedField,
} from './fuzzyMatch';

interface FakeTool {
  name: string;
  title?: string;
  description?: string;
}

const fieldsFor = (tool: FakeTool): PreparedField[] => prepareFields([
  { key: 'name', text: tool.name, kind: 'identifier', weight: 3 },
  { key: 'title', text: tool.title ?? '', kind: 'identifier', weight: 2 },
  { key: 'description', text: tool.description ?? '', kind: 'prose', weight: 1 },
]);

const rank = (tools: FakeTool[], query: string) => rankItems(tools, tools.map(fieldsFor), query)
  .map((result) => result.item.name);

describe('fuzzyMatch', () => {
  it('matches substrings and reports their range', () => {
    expect(fuzzyMatch('cat', 'get_catalog')?.ranges.text).toEqual([[4, 7]]);
  });

  it('matches subsequences in identifiers, preferring word starts', () => {
    const result = fuzzyMatch('gc', 'get_catalog');
    expect(result).not.toBeNull();
    expect(result?.ranges.text).toEqual([[0, 1], [4, 5]]);
  });

  it('recognizes camelCase word starts', () => {
    expect(fuzzyMatch('lf', 'listFiles')?.ranges.text).toEqual([[0, 1], [4, 5]]);
  });

  it('falls back to a plain scan when boundary jumps would strand later characters', () => {
    expect(fuzzyMatch('ab', 'xab_q')).not.toBeNull();
  });

  it('rejects queries whose characters are not all present in order', () => {
    expect(fuzzyMatch('zq', 'get_catalog')).toBeNull();
    expect(fuzzyMatch('lg', 'gl')).toBeNull();
  });

  it('requires every token to match', () => {
    expect(fuzzyMatch('get cat', 'get_catalog')).not.toBeNull();
    expect(fuzzyMatch('get dog', 'get_catalog')).toBeNull();
  });

  it('treats an empty query as a match for everything', () => {
    expect(fuzzyMatch('   ', 'anything')).toEqual({ score: 0, ranges: {} });
  });
});

describe('rankItems', () => {
  const tools: FakeTool[] = [
    { name: 'search_issues', description: 'Search GitHub issues by keyword' },
    { name: 'create_issue', title: 'Create issue', description: 'Open a new issue' },
    { name: 'issue', description: 'Fetch one issue' },
    { name: 'list_repos', description: 'Lists repositories; can search by owner' },
    { name: 'get_status', description: 'Server status' },
  ];

  it('ranks an exact name first, then word-start hits in list order', () => {
    expect(rank(tools, 'issue')).toEqual(['issue', 'search_issues', 'create_issue']);
  });

  it('ranks a prefix above a mid-word substring', () => {
    expect(rank([{ name: 'reissue' }, { name: 'issue_refund' }], 'issue')).toEqual(['issue_refund', 'reissue']);
  });

  it('ranks name hits above description-only hits', () => {
    expect(rank(tools, 'search')).toEqual(['search_issues', 'list_repos']);
  });

  it('does not subsequence-match prose, so short queries stay precise', () => {
    // "gst" is a subsequence of get_status but of no description word.
    expect(rank(tools, 'gst')).toEqual(['get_status']);
  });

  it('combines tokens across fields', () => {
    expect(rank(tools, 'create open')).toEqual(['create_issue']);
    expect(rank(tools, 'repos owner')).toEqual(['list_repos']);
  });

  it('keeps the original order without a query', () => {
    expect(rank(tools, '')).toEqual(tools.map((tool) => tool.name));
  });

  it('highlights every field a token matched', () => {
    const [first] = rankItems(tools, tools.map(fieldsFor), 'create');
    expect(first.ranges.name).toEqual([[0, 6]]);
    expect(first.ranges.title).toEqual([[0, 6]]);
  });

  it('filters 500 synthetic tools quickly', () => {
    const synthetic: FakeTool[] = Array.from({ length: 500 }, (_, index) => ({
      name: `tool_${index}_${['read', 'write', 'list', 'delete'][index % 4]}_records`,
      title: `Tool ${index}`,
      description: `Synthetic tool number ${index} that operates on records in workspace ${index % 17}.`,
    }));
    const prepared = synthetic.map(fieldsFor);
    const queries = ['w', 'wr', 'wrc', 'write rec', 'tool_42', 'workspace 3', 'zzz', 'tlrd'];
    // Warm up the JIT, then time a full keystroke sequence.
    queries.forEach((query) => rankItems(synthetic, prepared, query));
    const started = performance.now();
    for (let round = 0; round < 5; round += 1) {
      queries.forEach((query) => rankItems(synthetic, prepared, query));
    }
    const perQuery = (performance.now() - started) / (queries.length * 5);
    expect(perQuery).toBeLessThan(16);
    expect(rankItems(synthetic, prepared, 'tool_42').map((result) => result.item.name)[0])
      .toBe('tool_42_list_records');
  });
});

describe('highlightSegments', () => {
  it('splits text into plain and matched parts', () => {
    expect(highlightSegments('get_catalog', [[0, 1], [4, 7]])).toEqual([
      { text: 'g', match: true },
      { text: 'et_', match: false },
      { text: 'cat', match: true },
      { text: 'alog', match: false },
    ]);
  });

  it('merges overlapping ranges and ignores out-of-range ones', () => {
    expect(highlightSegments('abc', [[0, 2], [1, 3], [9, 10]])).toEqual([{ text: 'abc', match: true }]);
    expect(highlightSegments('abc', undefined)).toEqual([{ text: 'abc', match: false }]);
  });
});
