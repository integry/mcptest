import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const sidebar = '#app-sidenav-desktop';

for (const entry of ['landing page', 'in-app navigation'] as const) {
  test(`restores wheel scroll on Back and Forward after entering the catalog via ${entry}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (entry === 'landing page') {
      await page.goto('/catalog');
    } else {
      await page.goto('/');
      await page.keyboard.press('Shift');
      await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
      await page.locator(sidebar).getByRole('link', { name: 'Catalog', exact: true }).click();
      await expect(page).toHaveURL(/\/catalog$/);
    }

    const panel = page.locator('.main-content');
    await expect(panel.getByRole('heading', { level: 1, name: 'Remote MCP server catalog' })).toBeVisible();
    const offset = () => panel.evaluate(element => element.scrollTop);
    await panel.hover();
    await page.mouse.wheel(0, 4800);
    await expect.poll(offset).toBeGreaterThan(4700);

    // Click a link already visible after wheeling so the test runner does not
    // scroll to a link and change the position we expect Back to restore.
    const serverLink = await panel.evaluate(element => {
      const panelBounds = element.getBoundingClientRect();
      for (const link of element.querySelectorAll<HTMLAnchorElement>('a[href^="/servers/"]')) {
        const bounds = link.getBoundingClientRect();
        if (bounds.height === 0 || bounds.top < panelBounds.top + 80 || bounds.bottom > panelBounds.bottom) continue;
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        if (link.contains(document.elementFromPoint(x, y))) {
          return { x, y, path: link.pathname, catalogPosition: element.scrollTop };
        }
      }
    });
    expect(serverLink).toBeDefined();
    const { x, y, path: serverPath, catalogPosition } = serverLink!;
    await page.mouse.click(x, y);
    await expect(page).toHaveURL(url => url.pathname === serverPath);
    await expect(panel.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(offset).toBe(0);

    await panel.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(offset).toBeGreaterThan(100);
    const serverPosition = await offset();

    await page.goBack();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(panel.getByRole('heading', { level: 1, name: 'Remote MCP server catalog' })).toBeVisible();
    await expect.poll(async () => Math.abs(await offset() - catalogPosition)).toBeLessThanOrEqual(3);
    await page.goForward();
    await expect(page).toHaveURL(url => url.pathname === serverPath);
    await expect.poll(async () => Math.abs(await offset() - serverPosition)).toBeLessThanOrEqual(3);
  });
}

test.describe('sidebar navigation', () => {
  test('groups hub destinations and reaches every entry by keyboard', async ({ page }) => {
    // Wait for the app to replace the static shell, so the mount does not
    // interrupt the keyboard walk below.
    await page.goto('/tools/discovery');
    await expect(page.locator('.seo-shell-fallback')).toHaveCount(0);
    const nav = page.locator(sidebar);
    await expect(nav.getByRole('link', { name: 'Discovery checker' })).toHaveAttribute('aria-current', 'page');

    await expect(nav.locator('.sidenav-section-label')).toHaveText(['Workspace', 'Checks', 'Saved work', 'Learn']);
    await expect(nav.getByRole('region', { name: 'Checks' }).getByRole('link'))
      .toHaveText(['Breaking changes', 'OAuth checker', 'Discovery checker']);
    await expect(nav.getByRole('region', { name: 'Saved work' }).getByRole('link')).toHaveText(['Reports', 'Dashboards']);
    await expect(nav.getByRole('link', { name: 'OAuth checker' })).toHaveAccessibleDescription(/OAuth authorization step by step/);

    await expect(nav.getByRole('link', { name: 'Guides' })).toBeVisible();

    await nav.getByRole('link', { name: 'Playground', exact: true }).focus();
    const order = ['Catalog', 'Tool-selection evals', 'Breaking changes', 'OAuth checker', 'Discovery checker', 'Reports', 'Dashboards', 'Guides'];
    for (const name of order) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus .sidenav-label')).toHaveText(name);
    }
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/guides$/);
  });

  test('keeps article trees and search out of the static and mounted sidebar', async ({ page }) => {
    await page.goto('/guides/mcp-clients-compared');
    const nav = page.locator(sidebar);
    await expect(nav.getByRole('link', { name: 'Guides' })).toBeVisible();
    await expect(nav.locator('.content-track-nav, .guide-search, .sidenav-footer')).toHaveCount(0);
    await page.keyboard.press('Shift');
    await expect(page.locator('.seo-shell-fallback')).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Guides' })).toBeVisible();
    await expect(nav.locator('.content-track-nav, .guide-search, .sidenav-footer')).toHaveCount(0);
  });

  test('docks a slim sidebar and switches to the drawer below 1180px', async ({ page }) => {
    await page.goto('/tools/discovery');
    // Measure the mounted sidebar: a handle resolved inside the static shell
    // detaches when the app replaces it, and its bounding box comes back null.
    await expect(page.locator('.seo-shell-fallback')).toHaveCount(0);
    for (const width of [1920, 1440, 1280, 1180]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator('.desktop-sidebar').boundingBox();
      expect(bounds?.x).toBe(0);
      expect(bounds?.width).toBe(208);
    }
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(page.locator('.desktop-sidebar')).toBeHidden();
    await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mobile-sidebar')).toBeHidden();
  });

  test('ignores saved sidebar collapse preferences across reloads', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mcpSidebarCollapsed', 'true'));
    await page.goto('/tools/discovery');
    await expect(page.locator('.seo-shell-fallback')).toHaveCount(0);
    await expect(page.locator(sidebar)).not.toHaveClass(/app-sidenav--collapsed/);
    await expect(page.locator(`${sidebar} .sidenav-collapse-toggle`)).toHaveCount(0);
    await page.reload();
    await expect(page.locator(sidebar)).not.toHaveClass(/app-sidenav--collapsed/);
    await expect(page.locator(`${sidebar} .sidenav-collapse-toggle`)).toHaveCount(0);
  });

  test('a new visitor sees one Dashboards entry and creates the first dashboard on its page', async ({ page }) => {
    await page.goto('/tools/discovery');
    const nav = page.locator(sidebar);
    await expect(nav.locator('.dashboard-name')).toHaveCount(0);
    await nav.getByRole('link', { name: 'Dashboards' }).click();
    await expect(page).toHaveURL(/\/space$/);
    await expect(page).toHaveTitle('Dashboards | mcptest.io');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboards' })).toBeVisible();
    await page.getByRole('button', { name: 'Create dashboard' }).click();
    await expect(page).toHaveURL(/\/space\/my-first-dashboard$/);
    await expect(nav.locator('.dashboard-name')).toHaveText(['My first dashboard']);
  });
});

test.describe('mobile drawer', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('opens with the primary action first, traps focus, closes on Escape and returns focus', async ({ page }) => {
    await page.goto('/tools/discovery');
    // The prerendered shell has the same toggle, but React wires its click handler.
    await expect(page.locator('.seo-shell-fallback')).toHaveCount(0);
    const hamburger = page.getByRole('button', { name: 'Toggle navigation menu' });
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await hamburger.click();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    const playground = drawer.getByRole('link', { name: 'Playground', exact: true });
    await expect(playground).toBeInViewport();
    // Focus moves into the drawer and Tab cannot leave it.
    await expect(page.locator('.mobile-sidebar :focus')).toHaveCount(1);
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('.mobile-sidebar :focus')).toHaveCount(1);
    }

    await page.keyboard.press('Escape');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();

    // One tap from the open drawer reaches the playground.
    await hamburger.click();
    await playground.tap();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('body')).not.toHaveClass(/menu-open/);
    // Closed, the drawer is out of the tab order.
    await expect(page.locator('.mobile-sidebar')).toBeHidden();
  });
});

test('router restores the content column and focuses the new page', async ({ page }) => {
  await page.goto('/catalog');
  await page.keyboard.press('Shift');
  await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);

  const panel = page.locator('.main-content');
  const offsets = () => panel.evaluate(element => [window.scrollY, element.scrollTop]);
  const server = panel.locator('a[href^="/servers/"]').nth(20);
  await server.scrollIntoViewIfNeeded();
  const catalogPosition = await offsets();
  expect(catalogPosition[1]).toBeGreaterThan(0);

  let releaseClientSetup!: () => void;
  const pendingClientSetup = new Promise<void>(resolve => { releaseClientSetup = resolve; });
  await page.route('**/assets/ServerConnect-*.js', async route => {
    await pendingClientSetup;
    await route.continue();
  });
  const loading = panel.getByText('Loading client setup…', { exact: true });
  try {
    await server.click();
    await expect(page).toHaveURL(/\/servers\//);
    await expect(loading).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeFocused();
  } finally {
    releaseClientSetup();
  }
  await expect(loading).toBeHidden();
  expect(await offsets()).toEqual([0, 0]);

  const serverPosition = await panel.evaluate(element => {
    element.scrollTop = 400;
    return [window.scrollY, element.scrollTop];
  });
  expect(serverPosition[1]).toBeGreaterThan(0);
  await page.goBack();
  await expect(page.locator('h1')).toHaveText('Remote MCP server catalog');
  await expect.poll(offsets).toEqual(catalogPosition);
  await page.goForward();
  await expect(page.locator('h1')).toBeFocused();
  await expect.poll(offsets).toEqual(serverPosition);

  await page.goto('/learn');
  await page.keyboard.press('Shift');
  await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
  const track = panel.locator('a[href^="#track-"]').last();
  const hash = (await track.getAttribute('href'))!;
  await track.scrollIntoViewIfNeeded();
  const readingPosition = await offsets();
  await track.click();
  await expect(page.locator(hash)).toBeInViewport();
  const hashPosition = await offsets();
  expect(hashPosition[0]).toBe(0);
  expect(hashPosition[1]).toBeGreaterThan(readingPosition[1]);
  await page.goBack();
  await expect.poll(offsets).toEqual(readingPosition);
  await page.goForward();
  await expect.poll(offsets).toEqual(hashPosition);
});

for (const { path, selector } of [
  { path: '/learn', selector: '.learn-track-jumps a[href^="#track-"]' },
  { path: '/learn/mcp-clients-compared', selector: '.reading-outline a[href^="#"]' },
]) {
  test(`restores native fragment history created on ${path} before the router mounts`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/assets/bootstrapApp-*.js', async route => {
      await gate;
      await route.continue();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    const staticPage = page.locator('[data-deferred-mount]');
    await expect(staticPage).toBeVisible();
    const jump = page.locator(selector).last();
    const hash = (await jump.getAttribute('href'))!;
    const panel = page.locator('.main-content');
    const offset = () => panel.evaluate(element => element.scrollTop);
    await jump.scrollIntoViewIfNeeded();
    await panel.evaluate(element => element.scrollBy({ top: 40, behavior: 'instant' }));
    const readingPosition = await offset();
    expect(readingPosition).toBeGreaterThan(0);

    let fragmentPosition: number;
    try {
      await jump.click();
      await expect(page).toHaveURL(new RegExp(`${hash}$`));
      await expect(staticPage).toBeVisible();
      const target = page.locator(hash);
      await expect(target).toBeInViewport();
      const inset = await target.evaluate(element =>
        element.getBoundingClientRect().top - element.closest('.main-content')!.getBoundingClientRect().top);
      expect(inset).toBeCloseTo(16, 0);
      await panel.evaluate(element => element.scrollBy({ top: 75, behavior: 'instant' }));
      fragmentPosition = await offset();
    } finally {
      release();
    }
    expect(fragmentPosition).toBeGreaterThan(readingPosition);
    await expect(staticPage).toHaveCount(0);
    await expect.poll(offset).toBe(fragmentPosition);

    await page.goBack();
    await expect(page).toHaveURL(url => url.pathname === path && !url.hash);
    await expect.poll(offset).toBe(readingPosition);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    await expect.poll(offset).toBe(fragmentPosition);
  });
}

test('pushing the same route without the fragment resets scroll and retains link focus', async ({ page }) => {
  await page.goto('/guides');
  await page.keyboard.press('Shift');
  await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
  const panel = page.locator('.main-content');
  const track = panel.locator('a[href^="#track-"]').last();
  const hash = (await track.getAttribute('href'))!;
  await track.click();
  await expect(page.locator(hash)).toBeInViewport();
  const offsets = () => panel.evaluate(element => [window.scrollY, element.scrollTop]);
  const fragmentPosition = await offsets();
  expect(fragmentPosition[0]).toBe(0);
  expect(fragmentPosition[1]).toBeGreaterThan(0);

  const guides = page.locator(sidebar).getByRole('link', { name: 'Guides', exact: true });
  await guides.click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect.poll(offsets).toEqual([0, 0]);
  await expect(guides).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${hash}$`));
  await expect.poll(offsets).toEqual(fragmentPosition);
});

const glossaryPath = '/learn/mcp-glossary';
const glossaryFragment = `${glossaryPath}#streamable-http`;
const glossaryBody = '**/assets/mcp-glossary-*.js';
const glossaryHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'MCP glossary' });

async function followGlossaryLink(page: Page, from: string, destination: string) {
  await page.goto(from);
  await page.keyboard.press('Shift');
  await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
  await page.locator(`.reading-prose a[href="${destination}"]`).press('Enter');
  await expect(page).toHaveURL(url => `${url.pathname}${url.hash}` === destination);
}

async function expectGlossaryBodyError(page: Page) {
  const error = page.locator('.reading-prose').getByRole('alert');
  await expect(error).toContainText('This guide could not be loaded.');
  return error;
}

test('focuses the guide before its body loads and scrolls to the fragment after retry', async ({ page }) => {
  let failBody!: () => void;
  const pendingBody = new Promise<void>(resolve => { failBody = resolve; });
  await page.route(glossaryBody, async route => {
    await pendingBody;
    await route.abort();
  });
  const heading = glossaryHeading(page);
  try {
    await followGlossaryLink(page, '/learn/connect-remote-mcp-server', glossaryFragment);
    await expect(page.locator('.reading-prose').getByRole('status')).toHaveText('Loading guide…');
    await expect(heading).toBeFocused();
  } finally {
    failBody();
  }
  const error = await expectGlossaryBodyError(page);
  await expect(heading).toBeFocused();
  const target = page.locator('#streamable-http');
  await expect(target).toHaveCount(0);

  await page.unroute(glossaryBody);
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(target).toBeInViewport();
  await expect(heading).not.toBeFocused();
});

for (const { from, destination, label } of [
  { from: '/learn/connect-remote-mcp-server', destination: glossaryFragment, label: 'with a fragment' },
  { from: '/learn/mcp-explained-for-everyone', destination: glossaryPath, label: 'without a fragment' },
]) {
  test(`focuses the guide on Back ${label} and restores saved scroll after retry`, async ({ page }) => {
    await page.route(glossaryBody, route => route.abort());
    await followGlossaryLink(page, from, destination);
    const error = await expectGlossaryBodyError(page);
    const panel = page.locator('.main-content');
    const offset = () => panel.evaluate(element => element.scrollTop);
    await panel.evaluate(element => element.scrollTo({ top: 100, behavior: 'instant' }));
    await expect.poll(offset).toBe(100);

    await page.locator(sidebar).getByRole('link', { name: 'Catalog', exact: true }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Remote MCP server catalog' })).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(url => `${url.pathname}${url.hash}` === destination);
    await expect(error).toBeVisible();
    await expect(glossaryHeading(page)).toBeFocused();
    // Move away from the saved position while the body is still unavailable.
    await panel.evaluate(element => element.scrollTo({ top: 40, behavior: 'instant' }));
    await expect.poll(offset).toBe(40);

    await page.unroute(glossaryBody);
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#streamable-http')).toBeAttached();
    await expect.poll(offset).toBe(100);
  });
}

test('removing a fragment resets the fixed-shell panel and preserves its Back position', async ({ page }) => {
  await page.goto('/catalog#catalog-search');
  // The fragment focuses static search. Tab moves into the app's controls.
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
  const panel = page.locator('.main-content');
  const position = await panel.evaluate(element => {
    element.scrollTop = 350;
    return element.scrollTop;
  });
  expect(position).toBeGreaterThan(0);

  await page.locator(sidebar).getByRole('link', { name: 'Catalog', exact: true }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  const offset = () => panel.evaluate(element => element.scrollTop);
  await expect.poll(offset).toBe(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/catalog#catalog-search$/);
  await expect.poll(offset).toBe(position);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 380, height: 800 }]) {
  test(`the content column handles the first scroll key at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/learn/oauth-for-mcp-explained');
    await expect(page.locator('[data-deferred-mount]')).toBeVisible();

    const panel = page.locator('.main-content');
    const offset = () => panel.evaluate(element => element.scrollTop);
    expect(await offset()).toBe(0);
    await page.keyboard.press('Space');
    await expect.poll(offset).toBeGreaterThan(0);
    await page.keyboard.press('End');
    await expect.poll(() => panel.evaluate(element =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThan(1);
    await page.keyboard.press('Home');
    await expect.poll(offset).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(offset).toBeGreaterThan(0);
    await page.keyboard.press('PageDown');
    await expect.poll(offset).toBeGreaterThan(100);
    expect(await panel.evaluate(element => element.getBoundingClientRect().right)).toBe(viewport.width);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBe(viewport.height);
    await expect(page.locator('[data-deferred-mount]')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
}
