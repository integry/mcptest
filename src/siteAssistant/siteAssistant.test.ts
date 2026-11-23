import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_ASSISTANT_META_NAME } from './config.mts';
import {
  readSiteAssistantConfig,
  resetSiteAssistantForTests,
  startSiteAssistant,
  syncSiteAssistantRoute,
  type SiteAssistantLauncher,
} from './siteAssistant';

const addMeta = (endpoint = 'https://chat.example.com', assistant = 'pk_test_1') => {
  const meta = document.createElement('meta');
  meta.name = SITE_ASSISTANT_META_NAME;
  meta.dataset.endpoint = endpoint;
  meta.dataset.assistant = assistant;
  document.head.append(meta);
};

const setPath = (pathname: string) => window.history.replaceState(null, '', pathname);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const fakeLauncher = () => {
  const launcher: SiteAssistantLauncher & { states: boolean[] } = {
    states: [],
    setActive: (active: boolean) => { launcher.states.push(active); },
  };
  return { launcher, load: vi.fn(async () => launcher) };
};

beforeEach(() => {
  resetSiteAssistantForTests();
  document.head.querySelectorAll(`meta[name="${SITE_ASSISTANT_META_NAME}"]`).forEach(meta => meta.remove());
  setPath('/');
});

afterEach(() => resetSiteAssistantForTests());

describe('startSiteAssistant', () => {
  it('does nothing without the config meta tag', async () => {
    const { load } = fakeLauncher();
    expect(readSiteAssistantConfig()).toBeNull();
    expect(startSiteAssistant({ ready: Promise.resolve(), loadLauncher: load })).toBe(false);
    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores a meta tag with an unusable endpoint', async () => {
    addMeta('http://chat.example.com');
    const { load } = fakeLauncher();
    expect(startSiteAssistant({ ready: Promise.resolve(), loadLauncher: load })).toBe(false);
  });

  it('waits for load and idle before importing the launcher', async () => {
    addMeta();
    const { launcher, load } = fakeLauncher();
    let ready!: () => void;
    expect(startSiteAssistant({ ready: new Promise<void>(resolve => { ready = resolve; }), loadLauncher: load })).toBe(true);
    await flush();
    expect(load).not.toHaveBeenCalled();
    ready();
    await flush();
    expect(load).toHaveBeenCalledWith({ endpoint: 'https://chat.example.com', assistantKey: 'pk_test_1' });
    expect(launcher.states).toEqual([true]);
  });

  it('never imports the launcher on an excluded page', async () => {
    addMeta();
    setPath('/oauth/callback');
    const { load } = fakeLauncher();
    startSiteAssistant({ ready: Promise.resolve(), loadLauncher: load });
    await flush();
    syncSiteAssistantRoute('/report/mcp.example.com/mcp');
    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it('imports the launcher once the visitor navigates to an allowed page', async () => {
    addMeta();
    setPath('/space');
    const { launcher, load } = fakeLauncher();
    startSiteAssistant({ ready: Promise.resolve(), loadLauncher: load });
    await flush();
    syncSiteAssistantRoute('/learn');
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(launcher.states).toEqual([true]);
  });

  it('hides the launcher on client-side navigation to excluded pages and back', async () => {
    addMeta();
    const { launcher, load } = fakeLauncher();
    startSiteAssistant({ ready: Promise.resolve(), loadLauncher: load });
    await flush();
    syncSiteAssistantRoute('/space/team');
    await flush();
    syncSiteAssistantRoute('/install-integration');
    await flush();
    syncSiteAssistantRoute('/catalog');
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(launcher.states).toEqual([true, false, false, true]);
  });

  it('ignores route syncs when the assistant is off', () => {
    expect(() => syncSiteAssistantRoute('/catalog')).not.toThrow();
  });
});
