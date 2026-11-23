// @vitest-environment node
import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalAliasPath, isKnownAppPath } from '../src/utils/appRoutes';

describe('internal React navigation', () => {
  it('uses router links for literal app paths', () => {
    const plainLinks = [];
    const routes = { servicePage: true };
    for (const file of globSync('src/**/*.tsx', { exclude: ['**/*.test.tsx'] })) {
      const source = readFileSync(file, 'utf8');
      // Check literal paths and root-relative templates. Dynamic href props
      // can describe either site routes or external user-supplied URLs.
      for (const match of source.matchAll(/<a\s+([^<>]*?)\bhref=\{?(["'`])([^"'`]+)\2\}?/g)) {
        const path = match[3].replace(/^https:\/\/(?:www\.)?mcptest\.io(?=\/)/, '').split(/[?#]/)[0];
        if (!path.startsWith('/') || path.startsWith('//') || /\.(?:md|json|xml)$/.test(path)) continue;
        const tail = source.slice(match.index + match[0].length).split('>', 1)[0];
        if (/\b(?:download|target=["']_blank)/.test(match[1] + tail)) continue;
        if (isKnownAppPath(path, routes) || canonicalAliasPath(path, routes)) plainLinks.push(`${file} ${path}`);
      }
    }
    expect(plainLinks).toEqual([]);
  });
});
