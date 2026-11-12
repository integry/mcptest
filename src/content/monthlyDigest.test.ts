import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter';

const { data, content } = parseFrontmatter(readFileSync(resolve('src/content/articles/mcp-changes-2026-10.md'), 'utf8'));
const sourceUrls = new Set((data.sourceLinks as { url: string }[]).map(({ url }) => url.replace(/#.*$/, '')));
const section = (heading: string) => content.slice(content.indexOf(`## ${heading}`)).split(/\n## /)[0];

describe('October 2026 monthly digest', () => {
  it('lists every external inline link in sourceLinks', () => {
    const inlineUrls = [...content.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(([, url]) => url.replace(/#.*$/, ''));
    expect(inlineUrls.filter((url) => !sourceUrls.has(url))).toEqual([]);
  });

  it('links each SDK release and release history it makes a claim about', () => {
    const sdks = section('SDK releases');
    for (const url of [
      'https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.1',
      'https://github.com/modelcontextprotocol/java-sdk/releases/tag/v1.1.5',
      'https://github.com/modelcontextprotocol/java-sdk/releases/tag/v0.18.5',
      'https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.4.1',
      'https://github.com/modelcontextprotocol/go-sdk/releases',
      'https://github.com/modelcontextprotocol/csharp-sdk/releases',
      'https://github.com/modelcontextprotocol/kotlin-sdk/releases',
      'https://github.com/modelcontextprotocol/swift-sdk/releases',
    ]) {
      expect(sdks).toContain(`](${url})`);
    }
  });

  it('limits per-request server instances to stateless transports', () => {
    for (const text of [section('SDK releases'), section('What to do about it')]) {
      for (const sentence of text.split(/(?<=\.)\s+/).filter((s) => /per request/.test(s) && !/don't recreate/.test(s))) {
        expect(sentence).toMatch(/stateless/);
      }
    }
    expect(section('What to do about it')).toMatch(/stateful transport, keep connecting each session's server to its transport once/);
  });
});
