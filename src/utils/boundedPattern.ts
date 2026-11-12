/**
 * Linear-time evaluation of JSON Schema `pattern`-style regular expressions
 * taken from untrusted schemas.
 *
 * Native `RegExp#test` backtracks, so a valid server-supplied pattern such as
 * `^(a+)+$` can take exponential time on a short non-matching input and stall
 * the browser or CLI synchronously. This module compiles the common subset of
 * ECMAScript (`u` mode) syntax into a Thompson NFA and simulates it, which
 * takes time proportional to the pattern size times the input length.
 *
 * Supported: literals, `.`, `^`, `$`, character classes with ranges and
 * negation, `\d \D \w \W \s \S`, character escapes, groups (`(...)`,
 * `(?:...)`), alternation and the quantifiers `* + ? {n} {n,} {n,m}` (greedy
 * or lazy, which does not change whether a match exists). Anything else
 * (backreferences, lookaround, word boundaries, Unicode property escapes,
 * named groups) and patterns or inputs past the size limits are unsupported:
 * `matchesBoundedPattern` returns `undefined` so callers treat the result as
 * inconclusive instead of running the native engine.
 */

const PATTERN_LENGTH_LIMIT = 512;
const INPUT_LENGTH_LIMIT = 1024;
const STATE_LIMIT = 2000;
/**
 * Compilation steps (node visits and repetition iterations). Repeating an
 * empty group (`(?:){1000000000}`) allocates no states, so `STATE_LIMIT`
 * alone does not bound the work.
 */
const COMPILE_WORK_LIMIT = 20000;
const CACHE_LIMIT = 256;

type CodePointTest = (cp: number) => boolean;

type Node =
  | { kind: 'char'; test: CodePointTest }
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'seq'; items: Node[] }
  | { kind: 'alt'; options: Node[] }
  | { kind: 'repeat'; node: Node; min: number; max: number };

class Unsupported extends Error {}

const unsupported = (): never => {
  throw new Unsupported();
};

const inRanges = (ranges: readonly (readonly [number, number])[]): CodePointTest => (
  (cp) => ranges.some(([low, high]) => cp >= low && cp <= high)
);

const DIGIT = inRanges([[0x30, 0x39]]);
const WORD = inRanges([[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]]);
const SPACE = inRanges([
  [0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff],
]);
const LINE_TERMINATOR = inRanges([[0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029]]);
const not = (test: CodePointTest): CodePointTest => (cp) => !test(cp);

const CLASS_ESCAPES: Record<string, CodePointTest> = {
  d: DIGIT, D: not(DIGIT), w: WORD, W: not(WORD), s: SPACE, S: not(SPACE),
};
const CONTROL_ESCAPES: Record<string, number> = { t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d };
const SYNTAX_CHARACTERS = new Set('^$\\.*+?()[]{}|/'.split(''));
const HEX = /^[0-9a-fA-F]+$/;

class Parser {
  private index = 0;

  constructor(private readonly chars: readonly string[]) {}

  parse(): Node {
    const node = this.alternation();
    if (this.index < this.chars.length) unsupported();
    return node;
  }

  private peek(offset = 0): string | undefined {
    return this.chars[this.index + offset];
  }

  private next(): string {
    const char = this.chars[this.index];
    if (char === undefined) unsupported();
    this.index += 1;
    return char;
  }

  private alternation(): Node {
    const options = [this.sequence()];
    while (this.peek() === '|') {
      this.index += 1;
      options.push(this.sequence());
    }
    return options.length === 1 ? options[0] : { kind: 'alt', options };
  }

  private sequence(): Node {
    const items: Node[] = [];
    while (this.index < this.chars.length && this.peek() !== '|' && this.peek() !== ')') {
      const atom = this.atom();
      items.push(this.quantified(atom));
    }
    return { kind: 'seq', items };
  }

  private quantified(atom: Node): Node {
    const char = this.peek();
    let bounds: [number, number] | undefined;
    if (char === '*') bounds = [0, Infinity];
    else if (char === '+') bounds = [1, Infinity];
    else if (char === '?') bounds = [0, 1];
    if (bounds) {
      this.index += 1;
    } else if (char === '{') {
      bounds = this.braces();
    } else {
      return atom;
    }
    if (atom.kind === 'start' || atom.kind === 'end') unsupported();
    // A lazy quantifier matches the same inputs as a greedy one.
    if (this.peek() === '?') this.index += 1;
    return { kind: 'repeat', node: atom, min: bounds[0], max: bounds[1] };
  }

  private braces(): [number, number] {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(this.chars.slice(this.index, this.index + 24).join(''));
    if (!match) return unsupported();
    this.index += match[0].length;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
    if (!Number.isSafeInteger(min) || min > max) unsupported();
    return [min, max];
  }

  private atom(): Node {
    const char = this.next();
    switch (char) {
      case '^': return { kind: 'start' };
      case '$': return { kind: 'end' };
      case '.': return { kind: 'char', test: not(LINE_TERMINATOR) };
      case '[': return { kind: 'char', test: this.characterClass() };
      case '(': {
        if (this.peek() === '?') {
          if (this.peek(1) !== ':') unsupported();
          this.index += 2;
        }
        const node = this.alternation();
        if (this.next() !== ')') unsupported();
        return node;
      }
      case '\\': {
        const escaped = this.peek();
        if (escaped !== undefined && escaped in CLASS_ESCAPES) {
          this.index += 1;
          return { kind: 'char', test: CLASS_ESCAPES[escaped] };
        }
        const cp = this.characterEscape(false);
        return { kind: 'char', test: (value) => value === cp };
      }
      case '*': case '+': case '?': case '{': case '}': case ')': case ']': case '|':
        return unsupported();
      default: {
        const cp = char.codePointAt(0) as number;
        return { kind: 'char', test: (value) => value === cp };
      }
    }
  }

  /** The code point of an escape after `\`; `\b` (backspace) and `\-` only in a class. */
  private characterEscape(inClass: boolean): number {
    const char = this.next();
    if (char in CONTROL_ESCAPES) return CONTROL_ESCAPES[char];
    if (SYNTAX_CHARACTERS.has(char)) return char.codePointAt(0) as number;
    if (inClass && char === '-') return 0x2d;
    if (inClass && char === 'b') return 0x08;
    if (char === '0' && !/[0-9]/.test(this.peek() ?? '')) return 0;
    if (char === 'x') return this.hex(2);
    if (char === 'u') {
      if (this.peek() === '{') {
        const close = this.chars.indexOf('}', this.index);
        if (close < 0) unsupported();
        const digits = this.chars.slice(this.index + 1, close).join('');
        this.index = close + 1;
        const cp = HEX.test(digits) ? parseInt(digits, 16) : NaN;
        return Number.isNaN(cp) || cp > 0x10ffff ? unsupported() : cp;
      }
      return this.hex(4);
    }
    // Backreferences, `\b`/`\B`, `\p{...}`, `\k<...>`, `\cX` and the rest.
    return unsupported();
  }

  private hex(length: number): number {
    const digits = this.chars.slice(this.index, this.index + length).join('');
    if (digits.length !== length || !HEX.test(digits)) unsupported();
    this.index += length;
    return parseInt(digits, 16);
  }

  private characterClass(): CodePointTest {
    const negated = this.peek() === '^';
    if (negated) this.index += 1;
    const tests: CodePointTest[] = [];
    while (this.peek() !== ']') {
      const low = this.classAtom();
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        this.index += 1;
        const high = this.classAtom();
        if (typeof low !== 'number' || typeof high !== 'number' || low > high) unsupported();
        tests.push((cp) => cp >= (low as number) && cp <= (high as number));
      } else {
        tests.push(typeof low === 'number' ? (cp) => cp === low : low);
      }
    }
    this.index += 1;
    const member = (cp: number) => tests.some((test) => test(cp));
    return negated ? not(member) : member;
  }

  private classAtom(): number | CodePointTest {
    const char = this.next();
    if (char !== '\\') return char.codePointAt(0) as number;
    const escaped = this.peek();
    if (escaped !== undefined && escaped in CLASS_ESCAPES) {
      this.index += 1;
      return CLASS_ESCAPES[escaped];
    }
    return this.characterEscape(true);
  }
}

type State =
  | { kind: 'char'; test: CodePointTest; out: number }
  | { kind: 'split'; out: number[] }
  | { kind: 'start' | 'end'; out: number }
  | { kind: 'match' };

/** Thompson construction: `compile(node, next)` returns the entry state of `node` followed by `next`. */
const compileNfa = (root: Node): { states: State[]; entry: number } => {
  const states: State[] = [{ kind: 'match' }];
  let work = 0;
  const step = () => {
    work += 1;
    if (work > COMPILE_WORK_LIMIT) unsupported();
  };
  const add = (state: State): number => {
    if (states.length >= STATE_LIMIT) unsupported();
    states.push(state);
    return states.length - 1;
  };
  const compile = (node: Node, next: number): number => {
    step();
    switch (node.kind) {
      case 'char': return add({ kind: 'char', test: node.test, out: next });
      case 'start': case 'end': return add({ kind: node.kind, out: next });
      case 'seq': return node.items.reduceRight((acc, item) => compile(item, acc), next);
      case 'alt': return add({ kind: 'split', out: node.options.map((option) => compile(option, next)) });
      case 'repeat': {
        let entry = next;
        if (node.max === Infinity) {
          const loop = add({ kind: 'split', out: [] });
          (states[loop] as { out: number[] }).out.push(compile(node.node, loop), next);
          entry = loop;
        } else {
          for (let count = node.min; count < node.max; count += 1) {
            step();
            entry = add({ kind: 'split', out: [compile(node.node, entry), next] });
          }
        }
        for (let count = 0; count < node.min; count += 1) {
          step();
          entry = compile(node.node, entry);
        }
        return entry;
      }
    }
  };
  const entry = compile(root, 0);
  return { states, entry };
};

/** Whether the NFA matches anywhere in `input` (the semantics of `RegExp#test`). */
const simulate = (states: readonly State[], entry: number, input: readonly number[]): boolean => {
  let current = new Set<number>();
  const addClosure = (set: Set<number>, start: number, position: number) => {
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop() as number;
      if (set.has(id)) continue;
      set.add(id);
      const state = states[id];
      if (state.kind === 'split') stack.push(...state.out);
      else if (state.kind === 'start' && position === 0) stack.push(state.out);
      else if (state.kind === 'end' && position === input.length) stack.push(state.out);
    }
  };
  for (let position = 0; position <= input.length; position += 1) {
    addClosure(current, entry, position);
    if (current.has(0)) return true;
    if (position === input.length) break;
    const next = new Set<number>();
    for (const id of current) {
      const state = states[id];
      if (state.kind === 'char' && state.test(input[position])) addClosure(next, state.out, position + 1);
    }
    current = next;
  }
  return false;
};

type Compiled = { states: State[]; entry: number } | 'unsupported';
const cache = new Map<string, Compiled>();

const compilePattern = (pattern: string): Compiled => {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let compiled: Compiled;
  const chars = Array.from(pattern);
  if (chars.length > PATTERN_LENGTH_LIMIT) {
    compiled = 'unsupported';
  } else {
    try {
      // Compiling is not where backtracking happens; this rejects what `u` mode rejects.
      new RegExp(pattern, 'u');
      compiled = compileNfa(new Parser(chars).parse());
    } catch {
      compiled = 'unsupported';
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(pattern, compiled);
  return compiled;
};

/**
 * Whether `pattern` (ECMAScript, `u` flag, unanchored like JSON Schema's
 * `pattern` and `patternProperties`) matches `input`, in time linear in the
 * input. `undefined` when the pattern is invalid, uses syntax outside the
 * supported subset, or the pattern, its compilation work, or the input
 * exceeds the size limits.
 */
export const matchesBoundedPattern = (pattern: string, input: string): boolean | undefined => {
  const compiled = compilePattern(pattern);
  if (compiled === 'unsupported') return undefined;
  const codePoints = Array.from(input, (char) => char.codePointAt(0) as number);
  if (codePoints.length > INPUT_LENGTH_LIMIT) return undefined;
  return simulate(compiled.states, compiled.entry, codePoints);
};
