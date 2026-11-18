import type { Page } from '@playwright/test';
import { applySiteAssistantToHtml, readSiteAssistantEnv, SITE_ASSISTANT_META_NAME } from '../../src/siteAssistant/config.mts';
import { expect, test } from './fixtures';

/**
 * The solv.chat site assistant (issue #637). The suite runs against one build
 * (dist/, built without VITE_SOLV_* set), so "set" is simulated by serving
 * every page through the same build helper vite.config.mjs applies to
 * index.html: the policy then allows the configured origin and the page
 * carries the config meta tag, exactly as in a configured build. widget.js is
 * a stub that defines <solv-chat> the way the real widget does.
 */

const ENDPOINT = 'https://solv.example.test';
const CONFIG = readSiteAssistantEnv({ VITE_SOLV_ENDPOINT: ENDPOINT, VITE_SOLV_ASSISTANT_KEY: 'pk_e2e_test' })!;

const STUB_WIDGET = `
customElements.define('solv-chat', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Stub chat');
    panel.hidden = true;
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'Your question');
    panel.append(input);
    const launcher = document.createElement('button');
    launcher.className = 'solv-launcher';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.textContent = 'Chat';
    launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) input.focus(); });
    root.append(panel, launcher);
  }
});
`;

/** The launcher and the widget are added after load and idle; give the page time to get there. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  const idle = () => (window.requestIdleCallback ? window.requestIdleCallback(() => setTimeout(resolve, 300), { timeout: 4000 }) : setTimeout(resolve, 1500));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}));

const policyOf = (page: Page) => page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');

test.describe('with VITE_SOLV_* unset', () => {
  test('the site renders with no assistant, no widget request and the policy unchanged', async ({ page }) => {
    const widgetRequests: string[] = [];
    page.on('request', request => { if (/widget\.js|solv/.test(request.url())) widgetRequests.push(request.url()); });

    for (const path of ['/', '/learn', '/catalog']) {
      await page.goto(path);
      await expect(page.locator('#root')).not.toBeEmpty();
      await settle(page);
      await expect(page.locator('.site-assistant-launcher')).toHaveCount(0);
      await expect(page.locator('solv-chat')).toHaveCount(0);
      await expect(page.locator(`meta[name="${SITE_ASSISTANT_META_NAME}"]`)).toHaveCount(0);
      expect(await policyOf(page)).not.toContain('solv');
    }
    expect(widgetRequests).toEqual([]);
  });
});

test.describe('with VITE_SOLV_* set', () => {
  let widgetRequests: string[];
  let policyViolations: string[];

  test.beforeEach(async ({ page }) => {
    widgetRequests = [];
    policyViolations = [];
    page.on('console', message => {
      if (/Content Security Policy/i.test(message.text())) policyViolations.push(message.text());
    });
    // Every HTML page as a configured build writes it.
    await page.route(/^http:\/\/127\.0\.0\.1:\d+\//, async route => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({ response, body: applySiteAssistantToHtml(html, CONFIG) });
    });
    await page.route(`${ENDPOINT}/**`, async route => {
      widgetRequests.push(route.request().url());
      if (new URL(route.request().url()).pathname === '/widget.js') {
        await route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_WIDGET });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      }
    });
  });

  test('a fixed launcher appears after idle and loads the widget only when pressed', async ({ page }) => {
    await page.goto('/learn');
    expect(await policyOf(page)).toMatch(new RegExp(`script-src [^;]*${ENDPOINT.replace(/\./g, '\\.')}`));
    await settle(page);

    const launcher = page.getByRole('button', { name: 'Ask the mcptest assistant' });
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveCSS('position', 'fixed');
    expect(widgetRequests).toEqual([]);
    await expect(page.locator('solv-chat')).toHaveCount(0);

    // Keyboard reachable: focus it and press Enter.
    await launcher.focus();
    await expect(launcher).toBeFocused();
    await page.keyboard.press('Enter');

    const widget = page.locator('solv-chat');
    await expect(widget).toHaveAttribute('assistant', 'pk_e2e_test');
    await expect(widget).toHaveAttribute('endpoint', ENDPOINT);
    await expect(page.getByRole('dialog', { name: 'Stub chat' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Your question' })).toBeFocused();
    await expect(launcher).toBeHidden();
    expect(widgetRequests).toEqual([`${ENDPOINT}/widget.js`]);
    expect(policyViolations).toEqual([]);
  });

  test('the static HTML of a prerendered page carries no widget markup', async ({ page }) => {
    const response = await page.request.get('/learn');
    const html = applySiteAssistantToHtml(await response.text(), CONFIG);
    const body = html.slice(html.indexOf('<body'));
    expect(body).not.toContain('solv-chat');
    expect(body).not.toContain('site-assistant-launcher');
    expect(body).not.toContain('widget.js');
  });

  // The OAuth callback page sends an empty callback on to `/`, so its exclusion is unit-tested only.
  test('is not loaded on report or dashboard pages, and leaves when the visitor navigates there', async ({ page }) => {
    for (const path of ['/report', '/space']) {
      await page.goto(path);
      await settle(page);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator('.site-assistant-launcher')).toHaveCount(0);
    }
    expect(widgetRequests).toEqual([]);

    // Client-side, in the mounted app: from /submit to the report page, the launcher goes away.
    await page.goto('/submit');
    await settle(page);
    const launcher = page.getByRole('button', { name: 'Ask the mcptest assistant' });
    await expect(launcher).toBeVisible();
    await page.evaluate(() => {
      window.history.pushState(null, '', '/report');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(launcher).toBeHidden();
  });

  test('the launcher reads in the dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/learn');
    await settle(page);
    const launcher = page.getByRole('button', { name: 'Ask the mcptest assistant' });
    await expect(launcher).toBeVisible();
    const colors = await launcher.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color, theme: document.documentElement.getAttribute('data-theme') };
    });
    expect(colors.theme).toBe('dark');
    // The dark card surface and text tokens, not the light ones.
    expect(colors.background).not.toBe('rgb(255, 255, 255)');
    expect(colors.color).not.toBe('rgb(18, 21, 28)');
  });
});
