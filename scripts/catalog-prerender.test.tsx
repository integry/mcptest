import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { deferMountUntilInput } from '../src/staticPage/deferredMount';
import { enhanceStaticPage, snapshotStaticPageState } from '../src/staticPage/staticPage';
import CatalogView from '../src/components/CatalogView';
import { getCatalogServers } from '../src/utils/catalogUtils';
import pageMetadata from '../src/data/pageMetadata.json';
import generator from './generate-seo-pages.js';

const servers = getCatalogServers();
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const index = '<html><head><title>Catalog</title></head><body><div id="root"></div></body></html>';
const staticHtml = generator.renderCatalogHtml(index, pageMetadata.catalog, { servers });
const fallback = parse(staticHtml);
const react = parse(renderToStaticMarkup(<MemoryRouter initialEntries={['/catalog']}><CatalogView onTestServer={() => {}} /></MemoryRouter>));
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim();

function describeCatalog(doc: Document) {
  return {
    heading: text(doc.querySelector('.catalog-view h2')),
    count: text(doc.querySelector('.catalog-results-count')),
    search: doc.querySelector('.catalog-search-field input')?.getAttribute('placeholder'),
    selects: Array.from(doc.querySelectorAll('select'), select => ({
      id: select.id, value: select.value,
      options: Array.from(select.options, option => [option.value, text(option)]),
    })),
    rail: Array.from(doc.querySelectorAll('.catalog-category-rail a'), a => [text(a), a.getAttribute('href'), a.getAttribute('aria-current')]),
    rows: Array.from(doc.querySelectorAll('.catalog-server-row'), row => ({
      classes: Array.from(row.querySelectorAll('[class]'), node => node.getAttribute('class')?.replace(/ disabled$/, '')),
      title: text(row.querySelector('h3')),
      source: [text(row.querySelector('.catalog-listing-source')), row.querySelector('.catalog-listing-source')?.getAttribute('href')],
      url: [text(row.querySelector('.catalog-server-url')), row.querySelector('.catalog-server-url')?.getAttribute('title')],
      description: text(row.querySelector('.catalog-server-description')),
      badges: text(row.querySelector('.catalog-server-meta')),
      status: text(row.querySelector('.catalog-runtime-status')),
      report: row.querySelector('.catalog-report-link')?.getAttribute('href'),
      test: text(row.querySelector('.catalog-test-button')),
      testDisabled: row.querySelector('.catalog-test-button')?.hasAttribute('disabled') || row.querySelector('.catalog-test-button')?.getAttribute('aria-disabled') === 'true',
      logo: row.querySelector('img')?.getAttribute('src'),
    })),
  };
}

describe('catalog prerender parity', () => {
  it('matches the React heading, controls, categories and every row', () => {
    expect(describeCatalog(fallback)).toEqual(describeCatalog(react));
    expect(fallback.querySelector('[data-deferred-mount]')).not.toBeNull();
    expect(fallback.querySelector('.catalog-search-field input')?.id).toBe(react.querySelector('.catalog-search-field input')?.id);
    expect(fallback.querySelector('.catalog-search-field input')?.hasAttribute('readonly')).toBe(false);
    expect(react.querySelector('.catalog-search-field input')?.hasAttribute('readonly')).toBe(false);
    expect(fallback.querySelectorAll('select[inert]')).toHaveLength(3);
    expect(react.querySelectorAll('select[inert]')).toHaveLength(0);
  });

  it('renders every server as report and Playground anchors and canonical ItemList entries', () => {
    const rows = fallback.querySelectorAll('.catalog-server-row');
    expect(rows).toHaveLength(servers.length);
    for (const [i, server] of servers.entries()) {
      expect(rows[i].querySelector('.catalog-report-link')?.getAttribute('href')).toBe(`/servers/${server.id}/`);
      expect(rows[i].querySelector('a.catalog-test-button')?.getAttribute('href')).toMatch(/^\/server\//);
    }
    const data = JSON.parse(fallback.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(data['@type']).toBe('ItemList');
    expect(data.numberOfItems).toBe(servers.length);
    expect(data.itemListElement).toEqual(servers.map((server, i) => ({
      '@type': 'ListItem', position: i + 1, name: server.name, url: `https://mcptest.io/servers/${server.id}/`,
    })));
  });
});


describe('catalog search deferred handoff', () => {
  it.each([
    { focused: true, query: 'github', url: '/catalog' },
    { focused: false, query: 'github', url: '/catalog' },
    { focused: true, query: '', url: '/catalog' },
    { focused: true, query: 'github', url: '/catalog?q=&auth=all' },
    { focused: false, query: 'github', url: '/catalog?q=github', edited: false },
  ])('keeps text typed before mount ($url, focused: $focused, query: $query)', async ({ focused, query, url, edited = true }) => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = fallback.body.innerHTML;
    const root = document.getElementById('root')!;
    enhanceStaticPage(root.firstElementChild as HTMLElement);
    const input = root.querySelector<HTMLInputElement>('#catalog-search')!;
    expect(input.readOnly).toBe(false);
    let ready!: (render: () => Promise<void>) => void;
    let commit!: () => void;
    let started!: () => void;
    const rendering = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { commit = resolve; });
    const app = createRoot(root);
    const render = async () => {
      started();
      await gate;
      flushSync(() => app.render(
        <MemoryRouter initialEntries={[url]}><CatalogView onTestServer={() => {}} /></MemoryRouter>
      ));
    };
    const flush = () => new Promise(resolve => setTimeout(resolve, 10));
    deferMountUntilInput({
      root,
      prepare: () => new Promise(resolve => { ready = resolve; }),
      snapshotState: snapshotStaticPageState,
    });
    try {
      input.focus(); // One tap starts loading while leaving the input editable.
      if (edited) {
        input.value = 'git';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (!focused) input.blur();
      ready(render);
      await rendering;
      // Typing continues after prepare resolves, before React commits.
      const caret = Math.min(query.length, 3);
      if (edited) {
        input.value = query;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.setSelectionRange(caret, caret);
      }
      await act(async () => { commit(); await flush(); });
      const liveInput = root.querySelector<HTMLInputElement>('#catalog-search')!;
      expect(liveInput).not.toBe(input);
      expect(liveInput.value).toBe(query);
      if (focused) {
        expect(document.activeElement).toBe(liveInput);
        expect(liveInput.selectionStart).toBe(caret);
      } else {
        expect(document.activeElement).not.toBe(liveInput);
      }
      // Assert React state and filtering, not just a DOM value that the next
      // controlled render would erase.
      const rowCount = root.querySelectorAll('.catalog-server-row').length;
      if (query) expect(rowCount).toBeLessThan(servers.length);
      else expect(rowCount).toBe(servers.length);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      expect(liveInput.value).toBe(query);
    } finally {
      await act(async () => app.unmount());
      document.body.innerHTML = '';
    }
  });
});
