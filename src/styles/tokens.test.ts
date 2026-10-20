import { describe, expect, it } from 'vitest';
import { readStylesheet } from './readStylesheet';

const tokens = readStylesheet('tokens');

const block = (selector: string): string => {
  const start = tokens.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`tokens.css has no block for ${selector}`);
  return tokens.slice(start, tokens.indexOf('}', start));
};

const variables = (body: string): string[] =>
  [...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]).sort();

const lightBlock = block(":root,\n:root[data-theme='light']");
const darkBlock = block(":root[data-theme='dark']");
const scaleBlock = block(':root');

describe('theme token parity', () => {
  it('defines every light palette variable in the dark palette, and nothing extra', () => {
    expect(variables(darkBlock)).toEqual(variables(lightBlock));
  });

  it('keeps theme-independent scale tokens out of the palettes', () => {
    const scale = variables(scaleBlock);
    expect(scale).toContain('--border-radius');
    expect(scale).toContain('--font-family-mono');
    expect(variables(lightBlock).filter((name) => scale.includes(name))).toEqual([]);
  });

  it('declares every custom property the app stylesheets consume', () => {
    const defined = new Set([...variables(scaleBlock), ...variables(lightBlock)]);
    const consumed = new Set(
      [...readStylesheet('base', 'layout', 'components').matchAll(/var\((--[a-z0-9-]+)/g)]
        .map((match) => match[1])
        // Bootstrap's own variables are defined by bootstrap.min.css; --lang is a local hook.
        .filter((name) => !name.startsWith('--bs-') && name !== '--lang')
    );
    const missing = [...consumed].filter((name) => !defined.has(name)).sort();

    expect(missing).toEqual([]);
  });
});
