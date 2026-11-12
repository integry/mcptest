import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getKeywordLandingPage } from '../content/keywordLandingPages';
import { CI_PATH } from '../content/ciCopy';
import { LandingText } from './LandingText';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement;
let defaultPrevented: boolean | undefined;
// Runs after React's root listener: records whether the router took the click, then stops jsdom navigating.
const recordClick = (event: MouseEvent) => {
  defaultPrevented = event.defaultPrevented;
  event.preventDefault();
};

beforeEach(() => {
  defaultPrevented = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  document.addEventListener('click', recordClick);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  document.removeEventListener('click', recordClick);
});

const LocationProbe = () => <output data-testid="location">{useLocation().pathname}</output>;

const render = (value: string) => {
  root = createRoot(container);
  act(() => root!.render(
    <MemoryRouter initialEntries={['/mcp-test-server']}>
      <LandingText value={value} />
      <LocationProbe />
    </MemoryRouter>
  ));
};

const click = (label: string) => {
  const link = [...container.querySelectorAll('a')].find(anchor => anchor.textContent === label)!;
  expect(link, label).toBeTruthy();
  act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  return link;
};

const location = () => container.querySelector('[data-testid="location"]')?.textContent;

describe('LandingText links', () => {
  it('loads the standalone /ci page as a document instead of routing in the app', () => {
    const section = getKeywordLandingPage('/mcp-test-server')!.sections.find(item => item.id === 'local-and-stdio')!;
    const copy = [...(section.paragraphs ?? []), ...(section.items ?? []).map(item => item.description)]
      .find(value => value.includes(`](${CI_PATH})`))!;
    expect(copy).toBeTruthy();
    render(copy);
    const link = click('GitHub Action');
    expect(link.getAttribute('href')).toBe(CI_PATH);
    expect(defaultPrevented).toBe(false);
    expect(location()).toBe('/mcp-test-server');
  });

  it('keeps client-side routing for app destinations', () => {
    render('See [the catalog](/catalog) and [a guide](/learn/test-remote-mcp-server-in-ci#steps).');
    click('the catalog');
    expect(defaultPrevented).toBe(true);
    expect(location()).toBe('/catalog');
    click('a guide');
    expect(defaultPrevented).toBe(true);
    expect(location()).toBe('/learn/test-remote-mcp-server-in-ci');
  });

  it('opens external links in a new tab', () => {
    render('[GitHub](https://github.com/integry/mcptest)');
    const link = container.querySelector('a')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
