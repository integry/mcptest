import { expect, test } from './fixtures';

test('not found: an unknown path gets a 404 status and the NotFound page', async ({ page, externalRequests }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);

  const view = page.locator('.not-found-page');
  await expect(view.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page Not Found | mcptest.io');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  // The app mounted over the static fallback: the guide search is interactive.
  await expect(view.getByRole('combobox')).toBeVisible();

  await view.getByRole('link', { name: 'Browse the server catalog' }).click();
  await expect(page).toHaveURL('/catalog');
  await expect(page.getByRole('heading', { name: 'Remote MCP server catalog' })).toBeVisible();

  expect(externalRequests).toEqual([]);
});

test('not found: app routes without a prerendered page still get the shell', async ({ page }) => {
  const response = await page.goto('/submit');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toHaveCount(0);
});
