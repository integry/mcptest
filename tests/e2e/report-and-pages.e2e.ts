import { expect, hasHorizontalScroll, mockUrl, test } from './fixtures';

test('report: generates a release-readiness report with the badge embed', async ({ page, externalRequests }) => {
  const endpoint = mockUrl('2026');
  await page.goto('/report');
  await page.getByRole('main').getByLabel('MCP server URL').fill(endpoint);
  await page.getByRole('button', { name: 'Run Report' }).click();

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
  await expect(page.getByRole('heading', { level: 1, name: 'Context7' })).toBeVisible();
  await expect(page).toHaveTitle(/Context7/);
});

test('guide: renders a Learn article', async ({ page }) => {
  await page.goto('/learn/mcp-http-headers-reference');
  await expect(page.getByRole('heading', { level: 1, name: 'MCP HTTP headers reference' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Mcp-Session-Id');
  await expect(page).toHaveTitle(/MCP HTTP headers reference/);
});

test.describe('mobile viewport sanity', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const { path, heading } of [
    { path: '/', heading: 'Inspect, debug and evaluate remote MCP servers in your browser' },
    { path: '/catalog', heading: 'Remote MCP server catalog' },
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
