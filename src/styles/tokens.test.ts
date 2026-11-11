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

const values = (body: string): Record<string, string> =>
  Object.fromEntries([...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()]));

const lightBlock = block(":root,\n:root[data-theme='light']");
const darkBlock = block(":root[data-theme='dark']");
const scaleBlock = block(':root');
const light = values(lightBlock);
const dark = values(darkBlock);
const scale = values(scaleBlock);

/** WCAG 2.1 relative luminance contrast between two #rrggbb colours. */
const contrast = (foreground: string, background: string): number => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => {
      const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};

describe('theme token parity', () => {
  it('defines every light palette variable in the dark palette, and nothing extra', () => {
    expect(variables(darkBlock)).toEqual(variables(lightBlock));
  });

  it('keeps theme-independent scale tokens out of the palettes', () => {
    const scaleNames = variables(scaleBlock);
    expect(scaleNames).toContain('--border-radius');
    expect(scaleNames).toContain('--font-family-mono');
    expect(variables(lightBlock).filter((name) => scaleNames.includes(name))).toEqual([]);
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

describe('design language tokens (docs/design-language.md)', () => {
  it('builds the accent on the logo green in both themes', () => {
    expect(light['--primary-color']).toBe('#167a2c');
    expect(light['--primary-ink']).toBe('#ffffff');
    expect(dark['--primary-color']).toBe('#46d35a');
    expect(dark['--primary-ink']).toBe('#04140a');
  });

  it('pins the type scale, the pill radius and the signal rail', () => {
    expect(scale['--text-2xs']).toBe('0.6875rem');
    expect(scale['--text-base']).toBe('0.875rem');
    expect(scale['--text-2xl']).toBe('1.75rem');
    expect(scale['--radius-pill']).toBe('999px');
    expect(scale['--rail-width']).toBe('3px');
  });

  it('steps page, raised and surface apart in both themes', () => {
    [light, dark].forEach((palette) => {
      const surfaces = [palette['--body-bg'], palette['--card-bg-secondary'], palette['--card-bg']];
      expect(new Set(surfaces).size).toBe(3);
    });
    // The dark page sits below every surface; it is designed, not an inversion of the light page.
    expect(contrast(dark['--card-bg'], dark['--body-bg'])).toBeGreaterThan(1.05);
    expect(contrast(light['--card-bg'], light['--body-bg'])).toBeGreaterThan(1.05);
  });

  it('meets WCAG 2.1 AA for text on every surface in both themes', () => {
    const textTokens = ['--text-color', '--text-muted', '--text-accent', '--catalog-secondary-text', '--accent-text', '--link-color', '--primary-color', '--success-color', '--info-color', '--danger-color', '--warning-color'];
    const surfaceTokens = ['--body-bg', '--card-bg', '--card-bg-secondary', '--card-header-bg'];
    const failures: string[] = [];
    [['light', light], ['dark', dark]].forEach(([theme, palette]) => {
      const tokensOf = palette as Record<string, string>;
      textTokens.forEach((text) => surfaceTokens.forEach((surface) => {
        const ratio = contrast(tokensOf[text], tokensOf[surface]);
        if (ratio < 4.5) failures.push(`${theme} ${text} on ${surface}: ${ratio.toFixed(2)}`);
      }));
      const onAccent = contrast(tokensOf['--primary-ink'], tokensOf['--primary-color']);
      if (onAccent < 4.5) failures.push(`${theme} --primary-ink on --primary-color: ${onAccent.toFixed(2)}`);
      const onHover = contrast(tokensOf['--primary-ink'], tokensOf['--primary-hover']);
      if (onHover < 4.5) failures.push(`${theme} --primary-ink on --primary-hover: ${onHover.toFixed(2)}`);
      const accentOnWash = contrast(tokensOf['--accent-text'], tokensOf['--accent-wash']);
      if (accentOnWash < 4.5) failures.push(`${theme} --accent-text on --accent-wash: ${accentOnWash.toFixed(2)}`);
    });

    expect(failures).toEqual([]);
  });

  it('gives input borders and the focus colour 3:1 against the surfaces they sit on', () => {
    [light, dark].forEach((palette) => {
      expect(contrast(palette['--input-border'], palette['--card-bg'])).toBeGreaterThanOrEqual(3);
      expect(contrast(palette['--input-border'], palette['--input-bg'])).toBeGreaterThanOrEqual(3);
      expect(contrast(palette['--primary-color'], palette['--body-bg'])).toBeGreaterThanOrEqual(3);
    });
  });

  it('keeps the disabled look neutral, never a faded accent', () => {
    [light, dark].forEach((palette) => {
      expect(palette['--disabled-bg']).not.toBe(palette['--primary-color']);
      // An enabled primary must stand clearly apart from a disabled one.
      expect(contrast(palette['--primary-color'], palette['--disabled-bg'])).toBeGreaterThan(2);
    });

    const base = readStylesheet('base');
    const disabledRule = base.match(/\.btn:disabled, \.btn\.disabled,[^{]*\{([^}]*)\}/);
    expect(disabledRule?.[1]).toMatch(/background-color:\s*var\(--disabled-bg\)/);
    expect(disabledRule?.[1]).toMatch(/opacity:\s*1;/);
  });

  it('zeroes the motion tokens for visitors who prefer reduced motion', () => {
    const reduced = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/--motion-fast:\s*0ms/);
    expect(reduced).toMatch(/--motion-base:\s*0ms/);
  });
});
