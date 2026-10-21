import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The split stylesheet in cascade order, as imported by src/index.css. */
export const STYLESHEET_FILES = ['tokens', 'base', 'layout', 'components'] as const;

export type StylesheetFile = (typeof STYLESHEET_FILES)[number];

/** Test helper: read one or more of the split stylesheet files as a single string. */
export const readStylesheet = (...files: StylesheetFile[]): string =>
  (files.length ? files : STYLESHEET_FILES)
    .map((file) => readFileSync(resolve(`src/styles/${file}.css`), 'utf8'))
    .join('\n');
