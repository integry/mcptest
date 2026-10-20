import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareGuideSearch } from '../../content/guideSearch';
import type { SearchIndex } from '../../content/searchIndex';
import { MENU_OPEN_CLASS } from '../../hooks/useMobileDrawer';
import SideNav from '../SideNav';
import GuideSearch from './GuideSearch';
import LearnIndex from './LearnIndex';
import { isGuideSearchShortcutView } from './guideSearchShortcut';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, loginWithGoogle: vi.fn(), logout: vi.fn() }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.classList.remove(MENU_OPEN_CLASS);
  localStorage.clear();
});

const INDEX: SearchIndex = {
  version: 1,
  articles: [
    {
      slug: 'connect-cursor',
      path: '/learn/connect-cursor',
      title: 'Connect a remote server to Cursor',
      summary: 'Add the server to mcp.json.',
      track: 'use',
      level: 'newcomer',
      excerpt: 'Cursor reads its servers from mcp.json.',
      headings: [{ level: 2, text: 'Token refresh', id: 'token-refresh', excerpt: 'Cursor refreshes the token on 401.' }],
    },
    {
      slug: 'oauth-reference',
      path: '/learn/oauth-reference',
      title: 'OAuth reference',
      summary: 'Every OAuth step.',
      track: 'reference',
      level: 'practitioner',
      excerpt: '',
      headings: [
        { level: 2, text: 'Token exchange', id: 'token-exchange', excerpt: 'Swap the code for a token.' },
        { level: 3, text: 'Refresh tokens', id: 'refresh-tokens', excerpt: 'Refresh before expiry.' },
      ],
    },
  ],
};

const loadIndex = () => Promise.resolve(prepareGuideSearch(INDEX));

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.hash}`}</output>;
};

const mount = (node: React.ReactNode, path = '/learn/connect-cursor') => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        {node}
        <LocationProbe />
      </MemoryRouter>
    );
  });
};

const field = (scope: ParentNode = container!) => scope.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const location = () => container!.querySelector('[data-testid="location"]')!.textContent;
const options = () => Array.from(container!.querySelectorAll<HTMLElement>('[role="option"]'));

const type = async (value: string, input = field()) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => input.focus());
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const press = (target: EventTarget, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('GuideSearch combobox', () => {
  it('exposes combobox semantics and groups options by track', async () => {
    mount(<GuideSearch idPrefix="test" loadIndex={loadIndex} />);
    const input = field();
    const listbox = document.getElementById(input.getAttribute('aria-controls')!)!;

    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(listbox.hidden).toBe(true);

    await type('token');

    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(listbox.hidden).toBe(false);
    const groups = Array.from(listbox.querySelectorAll('[role="group"]'));
    expect(groups.map(group => document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual(['Use', 'Reference']);
    expect(options().map(option => option.getAttribute('href'))).toEqual([
      '/learn/connect-cursor#token-refresh',
      '/learn/oauth-reference#token-exchange',
    ]);
    const first = options()[0];
    expect(first.querySelector('.guide-search-option-title')?.textContent).toBe('Connect a remote server to Cursor');
    expect(first.querySelector('.guide-search-option-heading')?.textContent).toBe('Token refresh');
    expect(first.querySelector('.guide-search-option-heading mark')?.textContent).toBe('Token');
    expect(first.querySelector('.guide-search-option-snippet mark')?.textContent).toBe('token');
    expect(container!.querySelector('[role="status"]')?.textContent).toBe('2 guides found');
  });

  it('moves the active option with the arrows and opens it with Enter', async () => {
    mount(<GuideSearch idPrefix="test" loadIndex={loadIndex} />);
    await type('token');
    const input = field();

    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    press(input, 'ArrowUp');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    press(input, 'ArrowDown');

    const enter = press(input, 'Enter');

    expect(enter.defaultPrevented).toBe(true);
    expect(location()).toBe('/learn/oauth-reference#token-exchange');
    expect(input.value).toBe('');
    expect(document.activeElement).not.toBe(input);
  });

  it('opens the first result on Enter when no option is active', async () => {
    const onNavigate = vi.fn();
    mount(<GuideSearch idPrefix="test" loadIndex={loadIndex} onNavigate={onNavigate} />);
    await type('oauth');

    press(field(), 'Enter');

    expect(location()).toBe('/learn/oauth-reference');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('clears the query on Escape, then leaves the field', async () => {
    mount(<GuideSearch idPrefix="test" loadIndex={loadIndex} />);
    await type('token');
    const input = field();

    press(input, 'Escape');
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(input);

    press(input, 'Escape');
    expect(document.activeElement).not.toBe(input);
  });

  it('reports no matches and an unavailable index', async () => {
    mount(<GuideSearch idPrefix="test" loadIndex={loadIndex} />);
    await type('zzzz');
    expect(container!.querySelector('[role="status"]')?.textContent).toBe('No guides match');
    expect(options()).toEqual([]);

    act(() => root!.unmount());
    container!.remove();
    mount(<GuideSearch idPrefix="test" loadIndex={() => Promise.reject(new Error('offline'))} />);
    await type('token');
    expect(container!.querySelector('[role="status"]')?.textContent).toMatch(/unavailable/);
  });

  it('loads the index lazily, on first focus', async () => {
    const loader = vi.fn(loadIndex);
    mount(<GuideSearch idPrefix="test" loadIndex={loader} />);
    expect(loader).not.toHaveBeenCalled();
    await act(async () => field().focus());
    expect(loader).toHaveBeenCalledTimes(1);
    await type('token');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('GuideSearch `/` shortcut', () => {
  it('scopes the shortcut to content views', () => {
    expect(isGuideSearchShortcutView('learn')).toBe(true);
    expect(isGuideSearchShortcutView('docs')).toBe(true);
    for (const view of ['playground', 'dashboards', 'report', 'catalog', 'server-profile']) {
      expect(isGuideSearchShortcutView(view)).toBe(false);
    }
  });

  it('focuses the field only while enabled and nothing editable has focus', () => {
    mount(
      <>
        <input aria-label="Other field" />
        <GuideSearch idPrefix="test" loadIndex={loadIndex} shortcutEnabled />
      </>
    );
    const other = container!.querySelector<HTMLInputElement>('input[aria-label="Other field"]')!;

    act(() => other.focus());
    expect(press(other, '/').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other);

    act(() => other.blur());
    document.body.classList.add(MENU_OPEN_CLASS);
    expect(press(document.body, '/').defaultPrevented).toBe(false);
    document.body.classList.remove(MENU_OPEN_CLASS);

    expect(press(document.body, '/').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(field().getAttribute('aria-keyshortcuts')).toBe('/');
  });

  it('leaves `/` alone when disabled', () => {
    mount(<GuideSearch idPrefix="test" loadIndex={loadIndex} />);
    expect(press(document.body, '/').defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(field());
    expect(field().hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('gives the /learn index field priority over the sidebar field', () => {
    mount(
      <>
        <div data-testid="sidebar"><GuideSearch idPrefix="sidebar" loadIndex={loadIndex} shortcutEnabled /></div>
        <div data-testid="page"><GuideSearch idPrefix="page" variant="page" loadIndex={loadIndex} shortcutEnabled shortcutPriority={1} /></div>
      </>,
      '/learn'
    );
    press(document.body, '/');
    expect(document.activeElement).toBe(field(container!.querySelector('[data-testid="page"]')!));
  });

  it('expands the collapsed sidebar and then focuses the field', () => {
    const Harness: React.FC = () => {
      const [collapsed, setCollapsed] = React.useState(true);
      return <GuideSearch idPrefix="test" loadIndex={loadIndex} shortcutEnabled collapsed={collapsed} onExpandSidebar={() => setCollapsed(false)} />;
    };
    mount(<Harness />);
    expect(field()).toBeNull();

    expect(press(document.body, '/').defaultPrevented).toBe(true);

    expect(document.activeElement).toBe(field());
  });
});

describe('guide search placement', () => {
  const sideNavProps = (activeView: React.ComponentProps<typeof SideNav>['activeView'], isMobile = false) => ({
    activeView,
    isMobile,
    spaces: [],
    selectedSpaceId: null,
    handleSelectSpace: vi.fn(),
    handleCreateSpace: vi.fn(),
    handleReorderDashboards: vi.fn(),
    getSpaceHealthStatus: () => ({ loading: false, successCount: 0, totalCount: 0 }),
    getSpaceHealthColor: () => 'gray' as const,
    performAllDashboardsHealthCheck: vi.fn().mockResolvedValue(undefined),
    onMoveCard: vi.fn(),
  });

  const mountSideNavs = (activeView: React.ComponentProps<typeof SideNav>['activeView'], path: string) => mount(
    <>
      <div className="mobile-sidebar"><SideNav {...sideNavProps(activeView, true)} /></div>
      <div className="desktop-sidebar"><SideNav {...sideNavProps(activeView)} /></div>
    </>,
    path
  );

  it('puts the field at the top of the sidebar Learn group, in both the drawer and the desktop sidebar', () => {
    mountSideNavs('playground', '/');
    for (const scope of ['.mobile-sidebar', '.desktop-sidebar']) {
      const group = container!.querySelector(`${scope} .content-track-nav`)!;
      expect(group.querySelector('h2')?.nextElementSibling?.classList).toContain('guide-search');
    }
    const ids = Array.from(container!.querySelectorAll('[id]'), element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lets `/` reach the desktop sidebar field on content pages only', () => {
    mountSideNavs('playground', '/');
    expect(press(document.body, '/').defaultPrevented).toBe(false);
    act(() => root!.unmount());
    container!.remove();

    mountSideNavs('learn', '/learn/what-is-mcp');
    press(document.body, '/');
    expect(document.activeElement).toBe(field(container!.querySelector('.desktop-sidebar')!));
  });

  it('puts a page-sized field at the top of the /learn index', () => {
    mount(<LearnIndex />, '/learn');
    const search = container!.querySelector('.reading-header + .guide-search');
    expect(search?.classList).toContain('guide-search--page');
    press(document.body, '/');
    expect(document.activeElement).toBe(field(search!));
  });
});
