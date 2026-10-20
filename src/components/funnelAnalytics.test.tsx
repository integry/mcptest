import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Assert at the Firebase boundary so redaction and helper-sent events are covered too.
const firebase = vi.hoisted(() => ({ analytics: { app: 'test' }, logEvent: vi.fn() }));
vi.mock('../firebase', () => ({ analytics: firebase.analytics }));
vi.mock('firebase/analytics', () => ({ logEvent: firebase.logEvent }));

import { LEARN_ARTICLES } from '../content/learnRegistry';
import BadgeEmbed from './BadgeEmbed';
import { LandingHero } from './LandingHero';
import LearnArticlePage from './learn/LearnArticlePage';
import { sanitizePagePath } from '../utils/analytics';

const expectSent = (name: string, params: Record<string, unknown> = {}) => {
  const page_location = window.location.origin + sanitizePagePath(window.location.pathname);
  expect(firebase.logEvent).toHaveBeenCalledWith(firebase.analytics, name, { ...params, page_location });
};

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

beforeEach(() => firebase.logEvent.mockClear());

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

const render = (element: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<MemoryRouter>{element}</MemoryRouter>));
  return container;
};

const click = (element: Element | null) => {
  act(() => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

describe('landing funnel events', () => {
  it('sends landing_view once and a host-only landing_connect for manual entry', () => {
    const container = render(
      <LandingHero
        serverUrl="https://user:secret@mcp.example.com/mcp?api_key=1"
        onServerUrlChange={vi.fn()}
        onConnect={vi.fn()}
        isConnecting={false}
        advancedOptions={<div>panel</div>}
      />
    );

    expectSent('landing_view', { variant: 'new' });
    click(container.querySelector('#connectBtn'));
    expectSent('landing_connect', { source: 'manual', host: 'mcp.example.com' });

    click(container.querySelector('.landing-advanced-toggle'));
    expectSent('advanced_options_open');
    expect(firebase.logEvent.mock.calls.filter(([, name]) => name === 'landing_view')).toHaveLength(1);
  });

  it('marks returning users and recent-chip connects', () => {
    const container = render(
      <LandingHero
        serverUrl=""
        onServerUrlChange={vi.fn()}
        onConnect={vi.fn()}
        onConnectRecent={vi.fn()}
        isConnecting={false}
        recentServers={['https://recent.example.com/mcp']}
      />
    );

    expectSent('landing_view', { variant: 'returning' });
    click(container.querySelector('.landing-recent-connect'));
    expectSent('landing_connect', { source: 'recent_chip', host: 'recent.example.com' });
  });

  it('sends quick_pick connects with the catalog endpoint host', () => {
    const container = render(
      <LandingHero serverUrl="" onServerUrlChange={vi.fn()} onConnect={vi.fn()} isConnecting={false} />
    );
    const pick = container.querySelector<HTMLButtonElement>('.landing-quick-pick');
    click(pick);
    expectSent('landing_connect', {
      source: 'quick_pick',
      host: new URL(pick!.title).host,
    });
  });
});

describe('badge and guide events', () => {
  it('sends badge_copied with the format and surface after a successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const container = render(
      <BadgeEmbed
        titleId="badge"
        description="Badge"
        previewSrc="/badge.svg"
        previewAlt="Badge"
        linkUrl="https://mcptest.io/servers/github/"
        snippets={{ markdown: 'md', html: 'html', restructuredText: 'rst' }}
        analyticsSurface="server_profile"
      />
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Copy HTML badge snippet"]')!.click();
    });
    expect(writeText).toHaveBeenCalledWith('html');
    expectSent('badge_copied', { format: 'html', surface: 'server_profile' });
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('sends guide_view and guide_cta_click from a learn article', () => {
    const article = { ...LEARN_ARTICLES[0], content: 'Try the [catalog](/catalog) or the [spec](https://modelcontextprotocol.io).' };
    const container = render(<LearnArticlePage article={article} />);

    expectSent('guide_view', { slug: article.slug, track: article.track });
    click(container.querySelector('.reading-prose a[href="/catalog"]'));
    expectSent('guide_cta_click', { slug: article.slug, destination: 'catalog' });
  });
});
