import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import ResponsePanel from './ResponsePanel';
import type { LogEntry } from '../types';
import { readStylesheet } from '../styles/readStylesheet';

// These checks run the real stylesheet through jsdom's CSSOM and match its
// selectors against rendered markup, so a selector that no longer reaches the
// element it styles fails here even when its declarations look right.

let style: HTMLStyleElement;

beforeAll(() => {
  style = document.createElement('style');
  style.textContent = readStylesheet();
  document.head.appendChild(style);
});

afterAll(() => style.remove());

type Applied = { rule: CSSStyleRule; media?: string; order: number };

const flatten = (rules: CSSRuleList, media?: string, out: Applied[] = []): Applied[] => {
  Array.from(rules).forEach((rule) => {
    if (rule instanceof CSSMediaRule) flatten(rule.cssRules, rule.conditionText, out);
    else if (rule instanceof CSSStyleRule) out.push({ rule, media, order: out.length });
  });
  return out;
};

/** Evaluates the simple width queries the stylesheet uses for a given viewport width. */
const mediaApplies = (media: string | undefined, width: number): boolean => {
  if (!media) return true;
  if (/prefers-|print|hover|pointer/.test(media)) return false;
  const max = media.match(/max-width:\s*(\d+)px/);
  const min = media.match(/min-width:\s*(\d+)px/);
  if (max && width > Number(max[1])) return false;
  if (min && width < Number(min[1])) return false;
  return Boolean(max || min);
};

/** Splits a selector list on top-level commas (not those inside :not(), :has()). */
const branches = (selectorText: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of selectorText) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += character;
  }
  parts.push(current.trim());
  return parts;
};

/** [ids, classes/attributes/pseudo-classes, types] for the selectors this stylesheet writes. */
const specificity = (selector: string): [number, number, number] => {
  const plain = selector.replace(/::[a-z-]+/g, '').replace(/:(?:not|has|is)\(([^()]*)\)/g, ' $1 ');
  const ids = (plain.match(/#[\w-]+/g) ?? []).length;
  const classes = (plain.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length;
  const types = (plain.replace(/\[[^\]]+\]/g, '').match(/(?:^|[\s>+~(])([a-z][a-z0-9]*)/g) ?? []).length;
  return [ids, classes, types];
};

const compare = (a: [number, number, number], b: [number, number, number]) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The cascade winner for one property on one element at a viewport width (normal declarations). */
const winning = (element: Element, property: string, width: number) => {
  const candidates = flatten(style.sheet!.cssRules)
    .filter(({ rule, media }) => mediaApplies(media, width) && rule.style.getPropertyValue(property))
    .flatMap(({ rule, order }) => branches(rule.selectorText)
      .filter((branch) => element.matches(branch))
      .map((branch) => ({
        value: rule.style.getPropertyValue(property),
        important: rule.style.getPropertyPriority(property) === 'important',
        specificity: specificity(branch),
        order,
      })));
  candidates.sort((a, b) => Number(a.important) - Number(b.important)
    || compare(a.specificity, b.specificity) || a.order - b.order);
  return candidates[candidates.length - 1]?.value;
};

describe('mobile input font size', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('keeps URL fields at 16px on phones so iOS Safari does not zoom on focus', () => {
    document.body.innerHTML = '<input type="url" class="form-control">';
    const input = document.querySelector('input')!;

    expect(winning(input, 'font-size', 390)).toBe('16px');
    expect(winning(input, 'font-size', 768)).toBe('16px');
  });

  it('sets URL fields in the smaller mono size on desktop widths', () => {
    document.body.innerHTML = '<input type="url" class="form-control">';
    const input = document.querySelector('input')!;

    expect(winning(input, 'font-size', 769)).toBe('var(--text-sm)');
    expect(winning(input, 'font-family', 390)).toBe('var(--font-family-mono)');
  });
});

describe('traffic rails on ResponsePanel log entries', () => {
  let container: HTMLDivElement;
  let root: Root;

  const entries: LogEntry[] = [
    { type: 'request', data: { method: 'tools/list' }, timestamp: '10:00:00' },
    { type: 'response', data: { result: { tools: [] } }, timestamp: '10:00:01' },
    { type: 'error', data: 'Connection refused', timestamp: '10:00:02' },
    { type: 'warning', data: 'Slow response', timestamp: '10:00:03' },
  ] as LogEntry[];

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <ResponsePanel
          responses={entries}
          autoScroll={false}
          setAutoScroll={() => {}}
          handleClearResponse={() => {}}
          isConnected
          spaces={[]}
          onAddCardToSpace={() => {}}
          serverUrl="https://example.com/mcp"
          selectedTool={null}
          selectedResourceTemplate={null}
          toolParams={{}}
          resourceArgs={{}}
        />
      );
    });
  });

  afterAll(() => {
    act(() => root.unmount());
    container.remove();
  });

  const entry = (type: string) => {
    const badge = Array.from(container.querySelectorAll('.response-entry .badge'))
      .find((candidate) => candidate.textContent === type);
    if (!badge) throw new Error(`no rendered ${type} entry`);
    return badge.closest('.response-entry')!;
  };

  it('renders every entry inside the panel response area', () => {
    expect(container.querySelectorAll('.response-area .response-entry')).toHaveLength(entries.length);
  });

  it('hangs each rendered entry from the rail', () => {
    entries.forEach(({ type }) => {
      expect(winning(entry(type), 'border-left', 1280)).toBe('var(--rail-width) solid var(--border-strong)');
    });
  });

  it.each([
    ['request', 'var(--wire-request)'],
    ['response', 'var(--wire-response)'],
    ['error', 'var(--danger-color)'],
    ['warning', 'var(--warning-color)'],
  ])('colours the %s rail', (type, colour) => {
    expect(winning(entry(type), 'border-left-color', 1280)).toBe(colour);
  });
});

describe('primary action states', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('keeps a disabled primary on the soft accent, at full opacity', () => {
    document.body.innerHTML = '<button type="button" class="btn btn-primary" disabled>Connect</button>';
    const button = document.querySelector('button')!;

    expect(winning(button, 'background-color', 1280)).toBe('var(--primary-soft)');
    expect(winning(button, 'border-color', 1280)).toBe('var(--primary-soft-border)');
    expect(winning(button, 'color', 1280)).toBe('var(--primary-soft-ink)');
    expect(winning(button, 'opacity', 1280)).toBe('1');
  });

  it('fills the enabled primary with the solid accent', () => {
    document.body.innerHTML = '<button type="button" class="btn btn-primary">Connect</button>';
    const button = document.querySelector('button')!;

    expect(winning(button, 'color', 1280)).toBe('var(--primary-ink)');
    expect(winning(button, 'border-color', 1280)).toBe('var(--primary-color)');
  });

  it('keeps every other disabled variant neutral grey', () => {
    document.body.innerHTML = '<button type="button" class="btn btn-secondary" disabled>Clear</button>';
    const button = document.querySelector('button')!;

    expect(winning(button, 'background-color', 1280)).toBe('var(--disabled-bg)');
    expect(winning(button, 'color', 1280)).toBe('var(--disabled-text)');
  });

  it('paints the header and the landing command bar from the chrome palette', () => {
    document.body.innerHTML = '<header class="app-header"></header><div class="landing-connect"></div>';
    ['.app-header', '.landing-connect'].forEach((selector) => {
      const element = document.querySelector(selector)!;
      expect(winning(element, '--text-color', 1280), selector).toBe('var(--chrome-text)');
      expect(winning(element, '--primary-color', 1280), selector).toBe('var(--chrome-accent)');
      expect(winning(element, '--primary-soft', 1280), selector).toBe('var(--chrome-accent-soft)');
    });
    expect(winning(document.querySelector('.app-header')!, 'background-color', 1280)).toBe('var(--chrome-bg)');
  });
});
