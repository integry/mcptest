import { expect, test } from './fixtures';

const sidebar = '#app-sidenav-desktop';

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
    const order = ['Catalog', 'Breaking changes', 'OAuth checker', 'Discovery checker', 'Reports', 'Dashboards', 'Guides'];
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
