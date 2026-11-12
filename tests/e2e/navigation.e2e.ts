import { expect, test } from './fixtures';

const sidebar = '#app-sidenav-desktop';

test.describe('sidebar navigation', () => {
  test('groups the destinations, folds Learn on app pages and reaches every entry by keyboard', async ({ page }) => {
    // Wait for the app to replace the static shell, so the mount does not
    // interrupt the keyboard walk below.
    await page.goto('/tools/discovery');
    await expect(page.locator('.seo-shell-fallback')).toHaveCount(0);
    const nav = page.locator(sidebar);
    await expect(nav.getByRole('link', { name: 'Discovery check' })).toHaveAttribute('aria-current', 'page');

    await expect(nav.locator('.sidenav-section-label')).toHaveText(['Checks', 'Saved work']);
    await expect(nav.getByRole('region', { name: 'Checks' }).getByRole('link'))
      .toHaveText(['Breaking changes', 'OAuth check', 'Discovery check']);
    await expect(nav.getByRole('region', { name: 'Saved work' }).getByRole('link')).toHaveText(['Reports', 'Dashboards']);
    await expect(nav.getByRole('link', { name: 'OAuth check' })).toHaveAccessibleDescription(/OAuth authorization step by step/);

    const learn = nav.getByRole('button', { name: 'Learn' });
    await expect(learn).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Guides' })).toBeHidden();
    // Folded links stay in the document for crawlers.
    await expect(nav.locator('.sidenav-learn-body a[href="/learn"]')).toHaveCount(1);

    // Keyboard: Tab walks the entries in order, then Enter opens Learn.
    await nav.getByRole('link', { name: 'Playground' }).focus();
    const order = ['Catalog', 'Breaking changes', 'OAuth check', 'Discovery check', 'Reports', 'Dashboards', 'Learn'];
    for (const name of order) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus .sidenav-label')).toHaveText(name);
    }
    await page.keyboard.press('Enter');
    await expect(learn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Search guides');
  });

  test('opens Learn with the current track on a guide', async ({ page }) => {
    await page.goto('/learn/mcp-clients-compared');
    const nav = page.locator(sidebar);
    await expect(nav.getByRole('button', { name: 'Learn' })).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.locator('.content-track[data-track="use"] > button')).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.locator('a[href="/learn/mcp-clients-compared"]')).toHaveAttribute('aria-current', 'page');
  });

  test('`/` on a guide expands the collapsed sidebar and focuses the guide search', async ({ page }) => {
    await page.goto('/learn/mcp-clients-compared');
    const nav = page.locator(sidebar);
    await nav.locator('.sidenav-collapse-toggle').click();
    await expect(nav).toHaveClass(/app-sidenav--collapsed/);
    // On the rail Learn is one icon; its body, with the search button, is hidden.
    await expect(nav.locator('.sidenav-learn-body')).toBeHidden();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('/');

    await expect(nav).not.toHaveClass(/app-sidenav--collapsed/);
    await expect(nav.getByRole('button', { name: 'Learn' })).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.getByRole('combobox', { name: 'Search guides' })).toBeFocused();
  });

  test('remembers the collapsed sidebar across reloads', async ({ page }) => {
    await page.goto('/tools/discovery');
    await page.locator(`${sidebar} .sidenav-collapse-toggle`).click();
    await expect(page.locator(sidebar)).toHaveClass(/app-sidenav--collapsed/);
    await page.reload();
    await expect(page.locator(sidebar)).toHaveClass(/app-sidenav--collapsed/);
    await expect(page.locator(`${sidebar} .sidenav-collapse-toggle`)).toHaveAttribute('aria-expanded', 'false');
    await page.locator(`${sidebar} .sidenav-collapse-toggle`).click();
    await page.reload();
    await expect(page.locator(sidebar)).not.toHaveClass(/app-sidenav--collapsed/);
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
    const hamburger = page.getByRole('button', { name: 'Toggle navigation menu' });
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await hamburger.click();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    const playground = drawer.getByRole('link', { name: 'Playground' });
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
