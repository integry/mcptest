import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import generator from './generate-seo-pages.js';
import ServerProfileView from '../src/components/ServerProfileView';
import { getCatalogServerById } from '../src/utils/catalogUtils';

it('keeps the server landing actions and recommendations identical before and after mount', () => {
  for (const id of ['context7', 'asana', 'notion']) {
    const server = getCatalogServerById(id)!;
    const staticHtml = generator.renderServerHtml('<html><head></head><body><div id="root"></div></body></html>', server);
    const react = renderToStaticMarkup(<MemoryRouter><ServerProfileView server={server} onTestServer={() => {}} /></MemoryRouter>);
    const sections = (html: string) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return ['.server-profile-actions', '.server-next-steps'].map(selector => doc.querySelector(selector)?.outerHTML);
    };
    expect(sections(staticHtml)).toEqual(sections(react));
  }
});
