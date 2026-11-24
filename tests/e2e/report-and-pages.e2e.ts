import { expect, hasHorizontalScroll, mockUrl, test } from './fixtures';

test('report: generates a release-readiness report with the badge embed', async ({ page, externalRequests }) => {
  const endpoint = mockUrl('2026');
  await page.goto('/report');
  await page.getByRole('main').getByLabel('MCP server URL').fill(endpoint);
  await page.getByRole('button', { name: 'Run report' }).click();

  await expect(page).toHaveURL(`/report/${encodeURIComponent(endpoint)}`);
  const embed = page.getByRole('region', { name: 'Share and embed' });
  await expect(embed).toBeVisible({ timeout: 30_000 });
  await expect(embed).toContainText(endpoint);

  const reportUrl = `https://mcptest.io/report/${encodeURIComponent(endpoint)}`;
  const markdown = embed.getByRole('textbox', { name: 'Markdown' });
  await expect(markdown).toHaveValue(new RegExp(`^\\[!\\[[^\\]]+\\]\\(https://mcptest\\.io/badge/[\\w-]+\\.svg\\)\\]\\(${reportUrl.replace(/[.?]/g, '\\$&')}\\)$`));
  await expect(embed.getByRole('textbox', { name: 'HTML' })).toHaveValue(new RegExp(`<img src="https://mcptest\\.io/badge/[\\w-]+\\.svg"`));
  await expect(embed.getByRole('textbox', { name: 'reStructuredText' })).toHaveValue(/\.\. image:: https:\/\/mcptest\.io\/badge\/[\w-]+\.svg/);

  // The preview is the static badge shipped in dist/badge/.
  const preview = embed.getByRole('img');
  await expect(preview).toHaveAttribute('src', /^\/badge\/[\w-]+\.svg$/);
  await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  expect(externalRequests).toEqual([]);
});

test('catalog: lists servers and opens a server profile', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('heading', { name: 'Remote MCP server catalog' })).toBeVisible();
  await expect(page.getByText(/^Showing \d+ of \d+ servers$/)).toBeVisible();

  await page.getByRole('main').locator('a[href="/servers/context7/"]').first().click();
  await expect(page).toHaveURL('/servers/context7/');
  await expect(page.getByRole('heading', { level: 1, name: 'Context7 MCP server', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Context7/);
});

test('catalog: a category is a page of its own, reached from the category list', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('navigation', { name: 'Catalog categories' }).getByRole('link', { name: /^Databases/ }).click();
  await expect(page).toHaveURL('/catalog/databases');
  await expect(page.getByRole('heading', { level: 1, name: 'Databases MCP servers' })).toBeVisible();
  await expect(page).toHaveTitle('Databases MCP Servers | mcptest.io');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://mcptest.io/catalog/databases');
  await expect(page.getByText(/^Showing \d+ of \d+ Databases servers$/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'How to convert a local stdio MCP server to a remote server' })).toBeVisible();

  // Loaded directly, the prerendered page carries the same heading and rows before and after React mounts.
  await page.goto('/catalog/databases');
  await expect(page.getByRole('heading', { level: 1, name: 'Databases MCP servers' })).toBeVisible();
  await expect(page.locator('li.catalog-server-list-item').first()).toBeVisible();
});

test('server: shows the observed tool inventory with a collapsed input schema', async ({ page }) => {
  await page.goto('/servers/astro-docs/');
  const inventory = page.getByRole('region', { name: 'Tool inventory' });
  await expect(inventory).toContainText('What the catalog validator observed on');
  const schema = inventory.locator('details.server-tool-schema').first();
  await expect(schema).not.toHaveAttribute('open', '');
  await schema.locator('summary').click();
  await expect(schema.locator('.server-tool-parameters')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Documentation' }))
    .toHaveAttribute('href', '/catalog/documentation');

  await page.goto('/servers/github/');
  await expect(page.getByRole('region', { name: 'Tool inventory' }))
    .toContainText('Requires authorization; inventory not observed');
});

test('guide: renders a Learn article', async ({ page }) => {
  await page.goto('/learn/mcp-http-headers-reference');
  await expect(page.getByRole('heading', { level: 1, name: 'MCP HTTP headers reference' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Mcp-Session-Id');
  await expect(page).toHaveTitle(/MCP HTTP headers reference/);
});

for (const width of [1440, 390, 320]) {
  test(`guide: comparison tables fit in the article at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    for (const { path, tableStart, tableCount, finalColumn } of [
      { path: 'add-remote-mcp-server-to-claude', tableStart: '#compatibility-at-a-glance', tableCount: 5, finalColumn: 'Verified' },
      { path: 'mcp-inspector-alternatives', tableStart: '#comparison-table', tableCount: 3, finalColumn: 'Cost' },
      { path: 'best-remote-mcp-testing-tools', tableStart: '#test-and-mock-servers + p', tableCount: 2, finalColumn: 'Where it runs' },
    ]) {
      await page.goto(`/learn/${path}`);
      await page.evaluate(() => document.fonts.ready);
      const tables = page.locator('.reading-prose .reading-table');
      const comparison = page.locator(`${tableStart} + .reading-table + .reading-table`);
      await expect(comparison).toBeVisible();
      const finalHeader = page.getByRole('columnheader', { name: finalColumn, exact: true });
      await finalHeader.scrollIntoViewIfNeeded();
      await expect(finalHeader).toBeInViewport();
      const widths = await tables.evaluateAll(wrappers => wrappers.map(wrapper => {
        const table = wrapper.querySelector('table')!;
        return {
          columns: table.rows[0].cells.length,
          overflow: Math.max(wrapper.scrollWidth - wrapper.clientWidth, table.scrollWidth - table.clientWidth),
        };
      }));
      expect(widths.length).toBeGreaterThanOrEqual(tableCount);
      expect(widths.filter(({ columns, overflow }) => columns > 4 || overflow > 0), path).toEqual([]);
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
  });
}

test.describe('mobile viewport sanity', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const { path, heading } of [
    { path: '/', heading: 'Test remote MCP servers online' },
    { path: '/catalog', heading: 'Remote MCP server catalog' },
    { path: '/catalog/developer-tools', heading: 'Developer Tools MCP servers' },
    { path: '/servers/astro-docs/', heading: 'Astro Docs MCP server' },
    { path: '/learn/mcp-http-headers-reference', heading: 'MCP HTTP headers reference' },
  ]) {
    test(`no horizontal scroll on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }
});
