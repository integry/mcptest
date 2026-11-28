import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ArticleMarkdown from '../components/learn/ArticleMarkdown';
import generator from '../../scripts/generate-seo-pages.js';
import loader from '../../scripts/content/loadArticles.js';
import { loadFiguresFor } from './figureRegistry';
import {
  FIGURE_CLASSES,
  describeFiguresAsText,
  findFigures,
  parseFigureLine,
  parseFigureSvg,
  validateFigureSvg,
  validateFigureUsage,
} from './figures';

const SLUG = 'oauth-for-mcp-explained';
const LINE = `![Sequence diagram of the token exchange](../figures/${SLUG}/authorization-sequence.svg "Requests are solid.")`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"><rect class="fig-box" x="4" y="4" width="80" height="30" rx="2"/><text class="fig-label" x="12" y="24">Client</text></svg>';

describe('figure Markdown lines', () => {
  it('parses a standalone figure line and ignores other images and fenced code', () => {
    expect(parseFigureLine(LINE)).toEqual({
      slug: SLUG,
      name: 'authorization-sequence',
      alt: 'Sequence diagram of the token exchange',
      caption: 'Requests are solid.',
    });
    expect(parseFigureLine('![Logo](https://example.com/logo.png)')).toBeNull();
    expect(parseFigureLine(`Text before ${LINE}`)).toBeNull();
    expect(findFigures(['Intro', '', LINE, '', '```markdown', LINE, '```'].join('\n'))).toHaveLength(1);
  });

  it.each([
    ['Intro\n\n![Logo](https://example.com/logo.png)\n\nMore', 'an image must be a figure on its own line'],
    [`Intro\n\n${LINE.replace(SLUG, 'what-is-mcp')}\n\nMore`, 'figure belongs to what-is-mcp'],
    [`Intro\n\n![Short](../figures/${SLUG}/a.svg "Caption")\n\nMore`, 'alt text must say what the figure shows'],
    [`Intro\n\n${LINE.replace(' "Requests are solid."', '')}\n\nMore`, 'figure needs a caption'],
    [`Intro\n${LINE}\n\nMore`, 'needs a blank line before and after'],
    [`${LINE}\n\n${LINE}`, 'is placed twice'],
  ])('rejects wrong usage: %s', (markdown, message) => {
    expect(validateFigureUsage(markdown, SLUG).join('\n')).toContain(message);
  });

  it('accepts a correct figure and inline code that mentions image syntax', () => {
    expect(validateFigureUsage(`Intro with \`![alt](x.png)\`\n\n${LINE}\n\nMore`, SLUG)).toEqual([]);
  });

  it('describes figures as text for text-only outputs', () => {
    expect(describeFiguresAsText(`Intro\n\n${LINE}\n\nMore`))
      .toBe('Intro\n\n_Figure: Sequence diagram of the token exchange Requests are solid._\n\nMore');
  });
});

describe('figure SVG contract', () => {
  it('accepts a figure built from the shared classes', () => {
    expect(validateFigureSvg(SVG)).toEqual([]);
    expect(parseFigureSvg(SVG)).toMatchObject({ viewBox: '0 0 320 80', width: 320, height: 80 });
  });

  it.each([
    [SVG.replace('class="fig-box"', 'class="fig-box" fill="#0d6e5b"'), 'fill="#0d6e5b" is not allowed'],
    [SVG.replace('class="fig-box"', 'class="fig-box" style="fill:red"'), 'use the fig-* classes'],
    [SVG.replace('class="fig-box"', 'class="my-box"'), 'unknown class my-box'],
    [SVG.replace('<rect class="fig-box"', '<rect'), 'every shape needs a fig-* class'],
    [SVG.replace('<text class="fig-label"', '<text'), 'every <text> needs a fig-* class'],
    [SVG.replace('</svg>', '<script>alert(1)</script></svg>'), 'only static shapes and text are allowed'],
    [SVG.replace('<rect', '<rect onclick="x()"'), 'no event handler attributes'],
    [SVG.replace('0 0 320 80', '0 0 900 80'), 'at most 720 wide'],
    [SVG.replace(' viewBox="0 0 320 80"', ''), 'the root needs viewBox'],
    [SVG.replace('<svg ', '<svg width="320" '), 'the root takes only xmlns and viewBox'],
    [SVG.replace(/<text[^]*<\/text>/, ''), 'a figure needs text labels'],
    ['<div></div>', 'the file must be a single <svg> element'],
  ])('rejects %s', (svg, message) => {
    expect(validateFigureSvg(svg).join('\n')).toContain(message);
    expect(() => parseFigureSvg(svg)).toThrow('Invalid figure SVG');
  });

  it('styles every allowed class in ReadingLayout.css', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../components/learn/ReadingLayout.css'), 'utf8');
    for (const name of FIGURE_CLASSES) expect(css).toContain(`.reading-figure .${name}`);
  });
});

describe('figures in the repository', () => {
  it('pass the build validation, which also rejects missing and unused files', () => {
    const articles = loader.loadArticles();
    expect(articles.flatMap(article => findFigures(article.content)).length).toBeGreaterThan(0);
    const article = { ...articles[0], slug: 'example', content: `Intro\n\n${LINE.replace(SLUG, 'example')}\n\nMore` };
    expect(() => loader.validateArticleFigures([article])).toThrow(/figure file .* does not exist[^]*no article places this figure/);
  });
});

describe('figure rendering', () => {
  const markdown = `Intro\n\n${LINE}\n\nMore`;

  const mount = async (content: string) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<MemoryRouter><ArticleMarkdown content={content} /></MemoryRouter>);
    });
    return container;
  };

  it('renders the same inlined figure in the app and in the static renderer', async () => {
    await loadFiguresFor(markdown);
    const container = await mount(markdown);
    const figure = container.querySelector('figure.reading-figure')!;
    expect(figure.closest('p')).toBeNull();
    const svg = figure.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Sequence diagram of the token exchange');
    expect(figure.querySelector('figcaption')?.textContent).toBe('Requests are solid.');
    expect(svg.querySelectorAll('.fig-line-accent').length).toBeGreaterThan(0);

    const fallback = new DOMParser().parseFromString(generator.renderMarkdown(markdown), 'text/html');
    expect(fallback.querySelector('figure.reading-figure')!.outerHTML).toBe(figure.outerHTML);
  });

  it('loads a figure that was not preloaded and keeps the alt text when it cannot be loaded', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const missing = `![Sequence diagram that is not in the repository](../figures/${SLUG}/missing.svg "Caption.")`;
    const container = await mount(missing);
    await vi.waitFor(() => expect(container.querySelector('figcaption')?.textContent).toBe('Caption.'));
    expect(container.querySelector('.reading-figure-missing')?.textContent)
      .toBe('Sequence diagram that is not in the repository');
    expect(container.querySelector('svg')).toBeNull();
  });
});
