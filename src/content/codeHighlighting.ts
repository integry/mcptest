/**
 * Syntax highlighting for article code blocks: highlight.js core with only the
 * languages the guides use. Shared by the browser (`components/learn/highlighter`,
 * loaded on demand) and the prerenderer (`scripts/generate-seo-pages.js`), so
 * the static HTML carries the same markup the client would produce.
 */
import hljs from 'highlight.js/lib/core';
import type { HLJSApi, LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import http from 'highlight.js/lib/languages/http';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';

export type { HLJSApi };

/** Registered name → language, plus the aliases the Markdown fences use. */
export const HIGHLIGHT_LANGUAGES: ReadonlyArray<{ name: string; aliases: readonly string[]; language: LanguageFn }> = [
  { name: 'bash', aliases: ['sh', 'shell'], language: bash },
  { name: 'http', aliases: [], language: http },
  { name: 'javascript', aliases: ['js'], language: javascript },
  { name: 'json', aliases: [], language: json },
  { name: 'python', aliases: ['py'], language: python },
  { name: 'typescript', aliases: ['ts'], language: typescript },
  { name: 'yaml', aliases: ['yml'], language: yaml },
];

let registered = false;

/** The shared highlight.js instance with the article languages registered once. */
export const createHighlighter = (): HLJSApi => {
  if (!registered) {
    for (const { name, aliases, language } of HIGHLIGHT_LANGUAGES) {
      hljs.registerLanguage(name, language);
      for (const alias of aliases) hljs.registerLanguage(alias, language);
    }
    registered = true;
  }
  return hljs;
};

/** Highlighted HTML for `code`, or null when the language is unknown or unregistered. */
export const highlightCode = (code: string, language: string | undefined): string | null => {
  if (!language) return null;
  const highlighter = createHighlighter();
  if (!highlighter.getLanguage(language)) return null;
  return highlighter.highlight(code, { language }).value;
};
