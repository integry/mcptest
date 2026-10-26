import { expect, test } from '@playwright/test';

test('static server actions use canonical links and remain compact at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/servers/context7/');
  const actions = page.locator('.server-profile-actions');
  await expect(actions.getByRole('link', { name: 'Test it live' })).toHaveAttribute('href', /\/server\/mcp\.context7\.com\/mcp/);
  await expect(actions.getByRole('link', { name: 'Run the release-readiness report' })).toHaveAttribute('href', /^\/report\//);
  await expect(page.getByRole('heading', { name: 'Similar servers' })).toBeVisible();
  await expect(page.locator('.server-next-steps [data-server-action="similar_server"]')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('guide inline testing works while the React mount is unavailable', async ({ page }) => {
  await page.route('**/assets/bootstrapApp-*.js', route => route.abort());
  await page.goto('/learn/remote-mcp-server-401-unauthorized');
  const form = page.locator('[data-inline-test]').first();
  await expect(form).toBeVisible();
  await form.getByRole('textbox').fill('javascript:alert(1)');
  await form.getByRole('button', { name: 'Test it live' }).click();
  await expect(form.locator('[role="alert"]')).toBeVisible();
  await expect(form.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  await form.getByRole('textbox').fill('https://example.com/mcp?region=eu');
  await form.getByRole('button', { name: 'Test it live' }).click();
  await expect(page).toHaveURL(/\/server\/example\.com\/mcp\?query=region%3Deu/);
});
