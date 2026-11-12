/**
 * Dependency-free parser for the YAML subset used by article frontmatter.
 *
 * Supported syntax:
 * - `key: scalar` mappings (strings, quoted strings, numbers, booleans, null)
 * - inline lists of scalars: `key: [a, b, "c"]`
 * - block lists: `- item`, including list items that are mappings
 *   (`- title: x` followed by indented `url: y`)
 * - nested mappings by indentation
 * - block scalars with `|` or `>` (and `-` chomping)
 * - whole-line comments starting with `#`
 */

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

export class FrontmatterError extends Error {
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'FrontmatterError';
    this.line = line;
  }
}

interface SourceLine {
  indent: number;
  text: string;
  raw: string;
  number: number;
  blank: boolean;
}

const KEY_PATTERN = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:\s+(.*))?$/;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

const toLines = (source: string): SourceLine[] =>
  source.split('\n').map((raw, index) => {
    const withoutCarriage = raw.replace(/\r$/, '');
    const text = withoutCarriage.trim();
    return {
      raw: withoutCarriage,
      text,
      indent: withoutCarriage.length - withoutCarriage.trimStart().length,
      number: index + 1,
      blank: text === '' || text.startsWith('#'),
    };
  });

const unquoteDouble = (value: string, line: number): string => {
  try {
    return JSON.parse(value) as string;
  } catch {
    throw new FrontmatterError(`Invalid double-quoted string: ${value}`, line);
  }
};

const splitInlineList = (body: string, line: number): string[] => {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const character of body) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ',') {
      items.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (quote) {
    throw new FrontmatterError('Unterminated quoted string in inline list', line);
  }
  items.push(current);
  return items.map(item => item.trim()).filter(item => item !== '');
};

export const parseScalar = (raw: string, line = 0): unknown => {
  const value = raw.trim();
  if (value === '') return '';
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      throw new FrontmatterError(`Unterminated double-quoted string: ${value}`, line);
    }
    return unquoteDouble(value, line);
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new FrontmatterError(`Unterminated single-quoted string: ${value}`, line);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) {
      throw new FrontmatterError(`Unterminated inline list: ${value}`, line);
    }
    return splitInlineList(value.slice(1, -1), line).map(item => parseScalar(item, line));
  }
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (NUMBER_PATTERN.test(value)) return Number(value);
  return value;
};

const isSequenceLine = (line: SourceLine) => line.text === '-' || line.text.startsWith('- ');

const isMappingText = (text: string) => KEY_PATTERN.test(text) && !/^["'[]/.test(text);

const nextContentIndex = (lines: SourceLine[], from: number) => {
  let index = from;
  while (index < lines.length && lines[index].blank) index += 1;
  return index;
};

const parseBlockScalar = (
  lines: SourceLine[],
  start: number,
  parentIndent: number,
  indicator: string
): [string, number] => {
  const folded = indicator.startsWith('>');
  const keepTrailing = indicator.endsWith('+');
  const strip = indicator.endsWith('-');
  const collected: string[] = [];
  let index = start;
  let blockIndent: number | null = null;

  while (index < lines.length) {
    const line = lines[index];
    if (line.text === '') {
      collected.push('');
      index += 1;
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (blockIndent === null) blockIndent = line.indent;
    collected.push(line.raw.slice(blockIndent));
    index += 1;
  }

  while (collected.length && collected[collected.length - 1] === '') collected.pop();
  let value = folded
    ? collected.map(part => (part === '' ? '\n' : part)).join(' ').replace(/ ?\n ?/g, '\n')
    : collected.join('\n');
  if (!strip) value += keepTrailing ? '\n\n' : '\n';
  return [value, index];
};

const parseMapping = (
  lines: SourceLine[],
  start: number,
  indent: number
): [Record<string, unknown>, number] => {
  const result: Record<string, unknown> = {};
  let index = nextContentIndex(lines, start);

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new FrontmatterError(`Unexpected indentation: ${line.text}`, line.number);
    }
    if (isSequenceLine(line)) break;

    const match = line.text.match(KEY_PATTERN);
    if (!match) {
      throw new FrontmatterError(`Expected "key: value" but found: ${line.text}`, line.number);
    }
    const [, key, rest] = match;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new FrontmatterError(`Duplicate key: ${key}`, line.number);
    }

    if (rest === undefined || rest === '') {
      const nextIndex = nextContentIndex(lines, index + 1);
      const next = lines[nextIndex];
      if (next && (next.indent > indent || (next.indent === indent && isSequenceLine(next)))) {
        const [value, after] = parseBlock(lines, nextIndex, next.indent);
        result[key] = value;
        index = after;
      } else {
        result[key] = null;
        index = nextIndex;
      }
    } else if (/^[|>][+-]?$/.test(rest)) {
      const [value, after] = parseBlockScalar(lines, index + 1, indent, rest);
      result[key] = value;
      index = after;
    } else {
      result[key] = parseScalar(rest, line.number);
      index = nextContentIndex(lines, index + 1);
    }
  }

  return [result, index];
};

const parseSequence = (lines: SourceLine[], start: number, indent: number): [unknown[], number] => {
  const result: unknown[] = [];
  let index = nextContentIndex(lines, start);

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent || line.blank) break;
    if (line.indent > indent) {
      throw new FrontmatterError(`Unexpected indentation: ${line.text}`, line.number);
    }
    if (!isSequenceLine(line)) break;

    const rest = line.text.slice(1).trim();
    if (rest === '') {
      const nextIndex = nextContentIndex(lines, index + 1);
      const next = lines[nextIndex];
      if (!next || next.indent <= indent) {
        result.push(null);
        index = nextIndex;
      } else {
        const [value, after] = parseBlock(lines, nextIndex, next.indent);
        result.push(value);
        index = after;
      }
    } else if (isMappingText(rest)) {
      const itemIndent = indent + (line.text.length - rest.length);
      const patched = lines.slice();
      patched[index] = { ...line, indent: itemIndent, text: rest, raw: ' '.repeat(itemIndent) + rest };
      const [value, after] = parseMapping(patched, index, itemIndent);
      result.push(value);
      index = after;
    } else {
      result.push(parseScalar(rest, line.number));
      index = nextContentIndex(lines, index + 1);
    }
  }

  return [result, index];
};

const parseBlock = (lines: SourceLine[], start: number, indent: number): [unknown, number] =>
  isSequenceLine(lines[start]) ? parseSequence(lines, start, indent) : parseMapping(lines, start, indent);

/** Parses the YAML subset described in this module. */
export const parseYaml = (source: string): Record<string, unknown> => {
  const lines = toLines(source);
  const first = nextContentIndex(lines, 0);
  if (first >= lines.length) return {};
  if (lines[first].indent !== 0) {
    throw new FrontmatterError('Top-level keys must not be indented', lines[first].number);
  }
  if (isSequenceLine(lines[first])) {
    throw new FrontmatterError('Frontmatter must be a mapping, not a list', lines[first].number);
  }
  const [data, index] = parseMapping(lines, first, 0);
  const trailing = nextContentIndex(lines, index);
  if (trailing < lines.length) {
    throw new FrontmatterError(`Unexpected content: ${lines[trailing].text}`, lines[trailing].number);
  }
  return data;
};

/**
 * Separates the raw frontmatter block from the body without parsing the YAML.
 * The browser uses this alone to read a guide body loaded on demand; the
 * frontmatter itself was parsed and validated at build time.
 */
export const splitFrontmatter = (source: string): { frontmatter: string; content: string } => {
  const normalized = source.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!match) {
    throw new FrontmatterError('Document must begin with a "---" frontmatter block.');
  }
  const content = normalized.slice(match[0].length).replace(/^\n+/, '').replace(/\s+$/, '');
  return { frontmatter: match[1], content };
};

/**
 * Splits a Markdown document into its frontmatter block and body. The file
 * must start with a `---` line and contain a closing `---` line.
 */
export const parseFrontmatter = (source: string): ParsedFrontmatter => {
  const { frontmatter, content } = splitFrontmatter(source);
  return { data: parseYaml(frontmatter), content };
};
