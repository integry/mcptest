import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import McpResponseDisplay from './McpResponseDisplay';

const css = readFileSync(resolve('src/index.css'), 'utf8');

type Rule = { selector: string; body: string };

const rules: Rule[] = [];
const ruleMatcher = /([^{}]+)\{([^{}]*)\}/g;
let match: RegExpExecArray | null;
// Comments hold no declarations and their prose would pollute the selectors.
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
while ((match = ruleMatcher.exec(declarations)) !== null) {
  rules.push({ selector: match[1].replace(/\s+/g, ' ').trim(), body: match[2] });
}

const declaration = (body: string, property: string) => {
  const found = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`));
  return found ? found[1].trim() : undefined;
};

const ruleFor = (selector: string) => rules.find((rule) => rule.selector === selector);

describe('button shape', () => {
  it('defines a single button radius token', () => {
    expect(declaration(ruleFor(':root')!.body, '--button-radius')).toBe('0.5rem');
  });

  it('shapes every button from that token instead of hand-rolled radii', () => {
    const offenders = rules
      .filter((rule) => /(^|[\s,>+~])\.btn(-[a-z-]+)?(\.|:(?!:)|[\s,>+~]|$)/.test(rule.selector))
      .filter((rule) => !rule.selector.includes('::'))
      .map((rule) => ({ selector: rule.selector, radius: declaration(rule.body, 'border-radius') }))
      .filter((rule) => rule.radius !== undefined && !rule.radius.includes('var(--button-radius'));

    expect(offenders).toEqual([]);
  });

  it('keeps pills away from buttons', () => {
    const pills = rules
      .filter((rule) => /\.btn/.test(rule.selector))
      .filter((rule) => /border-radius:\s*(999px|9999px|50rem|100%)/.test(rule.body));

    expect(pills).toEqual([]);
  });
});

describe('outline button palette', () => {
  it('paints the neutral outline button grey on grey', () => {
    const neutral = ruleFor('.btn-outline-secondary')!.body;

    expect(declaration(neutral, 'color')).toBe('var(--text-accent)');
    expect(declaration(neutral, 'border-color')).toBe('var(--input-border)');
  });

  it('matches border to text on every outline variant', () => {
    const variants = ['.btn-outline-primary', '.btn-outline-secondary', '.btn-outline-danger', '.btn-outline-success'];
    const mismatched = variants.filter((selector) => {
      const body = ruleFor(selector)!.body;
      const color = declaration(body, 'color');
      const border = declaration(body, 'border-color');
      // Neutral is the one pairing that reads as one palette across two tokens.
      if (selector === '.btn-outline-secondary') return false;
      return color !== border;
    });

    expect(mismatched).toEqual([]);
  });

  it('tints the background on hover instead of flooding it', () => {
    const hover = ruleFor('.btn-outline-primary:hover')!.body;

    expect(declaration(hover, 'color')).toBe('var(--primary-color)');
    expect(declaration(hover, 'background-color')).toContain('color-mix');
  });
});

describe('grouped actions', () => {
  it('spaces grouped buttons instead of sharing their borders', () => {
    const group = ruleFor('.panel-actions, .result-actions, .btn-group')!.body;

    expect(declaration(group, 'gap')).toBe('0.5rem');
    expect(declaration(ruleFor('.btn-group > .btn, .btn-group > .dropdown > .btn')!.body, 'border-radius'))
      .toBe('var(--button-radius) !important');
  });

  it('renders result actions as separate buttons', () => {
    const markup = renderToStaticMarkup(
      <McpResponseDisplay
        logEntry={{ type: 'tool_result', data: [{ type: 'text', text: 'ok' }] }}
        showTimestamp={false}
      />
    );

    expect(markup).toContain('class="result-actions"');
    expect(markup).not.toContain('btn-group');
  });
});

describe('inline edit fields', () => {
  it('draws one border and one focus ring around the whole component', () => {
    const wrapper = ruleFor('.inline-edit-group')!.body;

    expect(declaration(wrapper, 'border')).toBe('1px solid var(--input-border)');
    expect(declaration(ruleFor('.inline-edit-group:focus-within')!.body, 'box-shadow')).toBe('var(--focus-ring)');
  });

  it('leaves the input and the confirm/cancel icons borderless inside it', () => {
    const input = ruleFor('.inline-edit-group .form-control, .inline-edit-group .form-control:focus')!.body;

    expect(declaration(input, 'border')).toBe('0 !important');
    expect(declaration(input, 'box-shadow')).toBe('none !important');
    expect(declaration(ruleFor('.inline-edit-group .btn')!.body, 'border')).toBe('none');
  });
});

describe('badges', () => {
  it('sits smaller and tighter than any button', () => {
    const badge = rules.filter((rule) => rule.selector === '.badge');

    expect(badge.length).toBeGreaterThan(0);
    badge.forEach((rule) => {
      const size = declaration(rule.body, 'font-size');
      if (size) expect(size).toBe('0.72rem');
    });
  });

  it('uses soft fills so status never reads as a control', () => {
    ['.badge.bg-success', '.badge.bg-danger', '.badge.bg-warning'].forEach((selector) => {
      expect(declaration(ruleFor(selector)!.body, 'background-color')).toContain('color-mix');
    });

    expect(declaration(ruleFor('.badge.bg-secondary, .badge.bg-dark')!.body, 'color'))
      .toBe('var(--text-accent) !important');
  });
});
