import { expect, test } from './fixtures';

test('not found: an unknown path gets a 404 status and the NotFound page', async ({ page, externalRequests }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);

  const view = page.locator('.not-found-page');
  await expect(view.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page Not Found | mcptest.io');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  // The app mounted over the static fallback: the guide search is interactive.
  await expect(view.getByRole('combobox')).toBeVisible();

  await view.getByRole('link', { name: 'Browse the server catalog' }).click();
  await expect(page).toHaveURL('/catalog');
  await expect(page.getByRole('heading', { name: 'Remote MCP server catalog' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');

  expect(externalRequests).toEqual([]);
});

test('not found: a known content page is indexable before and after mounting, and the 404 route is not', async ({ page }) => {
  const robots = page.locator('meta[name="robots"]');
  await page.goto('/learn');
  // Content pages mount on the first input; the static page alone must carry the tag.
  await expect(page.locator('#root > [data-deferred-mount]')).toHaveCount(1);
  await expect(robots).toHaveCount(1);
  await expect(robots).toHaveAttribute('content', 'index, follow');

  await page.keyboard.press('Shift');
  await expect(page.locator('#root > [data-deferred-mount]')).toHaveCount(0);
  await expect(robots).toHaveAttribute('content', 'index, follow');

  // A client-side navigation to an unknown path: the app's route-aware update applies noindex.
  await page.evaluate(() => {
    window.history.pushState(null, '', '/no-such-page');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(robots).toHaveCount(1);
  await expect(robots).toHaveAttribute('content', /noindex/);

  await page.goBack();
  await expect(page).toHaveURL('/learn');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toHaveCount(0);
  await expect(robots).toHaveCount(1);
  await expect(robots).toHaveAttribute('content', 'index, follow');
});

test('not found: app routes without a prerendered page still get the shell', async ({ page }) => {
  const response = await page.goto('/submit');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toHaveCount(0);
});

for (const [alias, canonical, heading] of [
  ['/catalog.html', '/catalog', 'Remote MCP server catalog'],
  ['/learn/index.html', '/learn', null],
  ['/index.html', '/', null],
] as const) {
  test(`not found: the served alias ${alias} redirects to ${canonical} instead of a 200 NotFound`, async ({ page }) => {
    const response = await page.goto(alias);
    expect(response?.status()).toBe(200);
    expect(response?.request().redirectedFrom()?.url()).toMatch(new RegExp(`${alias.replace(/\./g, '\\.')}$`));
    await expect(page).toHaveURL(canonical);
    if (heading) await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.locator('.not-found-page')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/);
  });
}

test('not found: a trailing-slash alias the host serves takes the canonical URL in the app', async ({ page }) => {
  // The static server answers /catalog/ with catalog.html and a 200; the app replaces the URL before it mounts.
  const response = await page.goto('/catalog/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL('/catalog');
  await expect(page.getByRole('heading', { name: 'Remote MCP server catalog' })).toBeVisible();
  await expect(page.locator('.not-found-page')).toHaveCount(0);
});

test('not found: a direct request for the error page is a 404', async ({ page }) => {
  const response = await page.goto('/404.html');
  expect(response?.status()).toBe(404);
  await expect(page.locator('.not-found-page')).toBeVisible();
});
