import type { Page } from '@playwright/test';
import { expect, hasHorizontalScroll, mockUrl, test } from './fixtures';

/**
 * Homepage first run (issue #559): a new visitor can run a sample test with
 * one click and no typing, the form explains itself and validates inline, the
 * example result is prerendered without moving when the app mounts, and the
 * page never scrolls sideways on phones.
 */

/** The first preset, which "Run a sample test" connects to. */
const SAMPLE_ENDPOINT = 'https://mcp.context7.com/mcp';

/** Keeps the sample endpoint and every MCP exchange real; forwards only the destination to the local mock. */
const forwardSampleToMock = async (page: Page): Promise<string[]> => {
  const requests: string[] = [];
  await page.context().route('https://mcp.context7.com/**', async route => {
    requests.push(route.request().url());
    const response = await route.fetch({ url: mockUrl('2026') });
    await route.fulfill({ response });
  });
  return requests;
};

/** Elements of the landing whose box crosses the right edge of the viewport. */
const landingOverflow = (page: Page) => page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  return [...document.querySelectorAll('.landing *')]
    .filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.right > width + 0.5 && !element.closest('.visually-hidden');
    })
    .map(element => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`);
});

test('a new visitor runs a sample test with one click from a cold load', async ({ page }, testInfo) => {
  const requests = await forwardSampleToMock(page);
  await page.goto('/');

  // First run: no tab strip above the landing, an explained form and the example result.
  await expect(page.locator('[data-deferred-mount] .landing-preview')).toBeVisible();
  await expect(page.locator('.playground-tab-strip')).toBeHidden();
  const sample = page.getByRole('button', { name: 'Run a sample test' });
  await expect(sample).toHaveAccessibleDescription('Connects to Context7, a public server with no sign-in');

  await sample.click();

  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  await expect(page.locator('.connection-endpoint')).toHaveText(SAMPLE_ENDPOINT);
  await expect(page.getByText('2 tools · 1 resource · 1 prompt', { exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(url => url === SAMPLE_ENDPOINT)).toBe(true);

  // With a connection the tab strip appears, and "+ New" says what it does.
  const newTab = page.getByRole('button', { name: 'New connection tab' });
  await expect(newTab).toBeVisible();
  await expect(newTab).toHaveText('+ New');
  await expect(newTab).toHaveAttribute('title', 'Open another connection tab to test a second server side by side');
  await testInfo.attach('first-run-sample-connected', { body: await page.screenshot(), contentType: 'image/png' });
});

test('the connect form explains itself, validates inline and submits on Enter', async ({ page }) => {
  await page.goto('/');
  // Mount the app, then use the keyboard only.
  await page.keyboard.press('Shift');
  await expect(page.locator('#root > [data-deferred-mount]')).toHaveCount(0);

  const field = page.getByLabel('MCP endpoint URL');
  await expect(page.locator('label[for="serverUrl"]')).toBeVisible();
  await expect(field).toHaveAttribute('placeholder', 'https://example.com/mcp');
  await expect(field).toHaveAccessibleDescription(/Nothing is installed\.$/);
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  await expect(connect).toBeEnabled();

  // Focus order: field, Connect, the sample test, then the presets.
  await field.focus();
  await page.keyboard.press('Tab');
  await expect(connect).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Run a sample test' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.landing-quick-pick').first()).toBeFocused();

  await field.fill('javascript:alert(1)');
  await field.press('Enter');
  const error = page.getByRole('alert').filter({ hasText: 'Use an http:// or https:// URL' });
  await expect(error).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();
  await expect(field).toHaveAccessibleDescription(/^mcptest\.io connects to remote servers over HTTP/);
  await expect(page.locator('.landing-title')).toBeVisible();

  await field.fill('https://intranet/mcp');
  await expect(error).toHaveCount(0);
  await connect.click();
  await expect(page.getByRole('alert').filter({ hasText: 'needs a host name with a domain' })).toBeVisible();

  await field.fill(mockUrl('2026'));
  await field.press('Enter');
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
});

test('advanced options say when they are needed', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('.landing-advanced-toggle');
  await expect(toggle).toHaveAccessibleName(/^Advanced options when a server needs custom headers, an API key or a CORS proxy$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('the example result is prerendered and does not move when the app mounts', async ({ page, request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('<figure class="landing-preview" aria-labelledby="landing-preview-caption">');
  expect(html).toContain('Example result');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const preview = page.locator('.landing-preview');
  await expect(page.locator('[data-deferred-mount] .landing-preview')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await preview.boundingBox();
  await page.keyboard.press('Shift');
  await expect(page.locator('#root > [data-deferred-mount]')).toHaveCount(0);
  await expect(preview).toBeVisible();
  const after = await preview.boundingBox();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(before![key] - after![key]), `preview ${key}: ${JSON.stringify({ before, after })}`).toBeLessThan(1);
  }
});

for (const width of [430, 390, 320]) {
  test(`the home page never scrolls sideways at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-deferred-mount] .landing-preview')).toBeAttached();
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(await landingOverflow(page)).toEqual([]);

    await page.keyboard.press('Shift');
    await expect(page.locator('#root > [data-deferred-mount]')).toHaveCount(0);
    await expect(page.locator('.landing-preview')).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(await landingOverflow(page)).toEqual([]);

    // A malformed URL's message wraps inside the column too.
    await page.getByLabel('MCP endpoint URL').fill('ftp://files.example.com/a-very-long-path/that-keeps-going/mcp');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(await landingOverflow(page)).toEqual([]);
    if (width === 320) await testInfo.attach('first-run-320', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
