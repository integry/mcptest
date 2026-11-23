import type { Locator, Page } from '@playwright/test';
import { APP_PORT } from '../../playwright.config';
import { applySiteAssistantToHtml, readSiteAssistantEnv, SITE_ASSISTANT_META_NAME } from '../../src/siteAssistant/config.mts';
import { expect, hasHorizontalScroll, mockUrl, test } from './fixtures';

/**
 * The solv.chat site assistant (issue #637). The suite runs against one build
 * (dist/), which may or may not be configured: .env.production sets
 * VITE_SOLV_*, so a production build carries the real config. Every HTML page
 * is therefore first served as an unconfigured build writes it (the config
 * meta tag removed and the policy without that origin), and "set" then runs
 * it through the same build helper vite.config.mjs applies to index.html
 * with a test endpoint: the policy allows that origin and the page carries
 * the config meta tag, exactly as in a configured build. widget.js is a stub
 * that models the 0.1.10 host hints and docked layout. It also includes
 * the visitor check (issue #699), a frame from the endpoint's
 * /v1/check/frame created on the first keystroke in the message field (not
 * when the panel opens and focuses it), so the page's own policy must let it
 * load.
 */

const ENDPOINT = 'https://solv.example.test';
const CONFIG = readSiteAssistantEnv({ VITE_SOLV_ENDPOINT: ENDPOINT, VITE_SOLV_ASSISTANT_KEY: 'pk_e2e_test' })!;

const CHECK_FRAME = `${ENDPOINT}/v1/check/frame`;
const LAUNCHER_LABEL = 'Ask MCP Test AI';
const PANEL_WIDTH = 460;

const STUB_WIDGET = `
customElements.define('solv-chat', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Stub chat');
    panel.hidden = true;
    const close = document.createElement('button');
    close.textContent = 'Close chat';
    const input = document.createElement('textarea');
    input.className = 'solv-input';
    input.setAttribute('aria-label', 'Your question');
    const checkArea = document.createElement('div');
    checkArea.className = 'solv-check';
    const startCheck = () => {
      if (checkArea.firstChild) return;
      const frame = document.createElement('iframe');
      frame.title = 'Security check';
      frame.src = this.getAttribute('endpoint') + '/v1/check/frame';
      checkArea.append(frame);
    };
    input.addEventListener('keydown', startCheck);
    panel.append(close, checkArea, input);
    const launcher = document.createElement('button');
    launcher.className = 'solv-launcher';
    launcher.textContent = this.getAttribute('launcher-label') || 'Chat';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.addEventListener('click', () => {
      const side = this.getAttribute('opens-as') === 'side' && matchMedia('(min-width: 900px)').matches;
      if (side) {
        const width = '${PANEL_WIDTH}px';
        const position = this.getAttribute('launcher-position') === 'left' ? 'left' : 'right';
        this.setAttribute('data-layout', 'side');
        document.documentElement.style.setProperty('margin-' + position, width);
        document.documentElement.style.maxWidth = 'calc(100% - ' + width + ')';
        document.documentElement.style.setProperty('--solv-chat-panel-width', width);
        Object.assign(panel.style, {
          position: 'fixed', top: '0', bottom: '0', [position]: '0', width,
          backgroundColor: 'white', zIndex: '2147483647',
        });
        launcher.hidden = true;
      }
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      input.focus();
    });
    close.addEventListener('click', () => {
      this.removeAttribute('data-layout');
      document.documentElement.style.removeProperty('margin-left');
      document.documentElement.style.removeProperty('margin-right');
      document.documentElement.style.removeProperty('max-width');
      document.documentElement.style.removeProperty('--solv-chat-panel-width');
      panel.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    });
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

const CONFIG_META = new RegExp(`\\s*<meta name="${SITE_ASSISTANT_META_NAME}" data-endpoint="([^"]*)"[^>]*\\/>`);
const CSP_CONTENT = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;

/** `html` as a build without VITE_SOLV_* writes it: no config meta tag, and the policy without its origin. */
const withoutBuildAssistant = (html: string): string => {
  const endpoint = CONFIG_META.exec(html)?.[1];
  if (!endpoint) return html;
  return html.replace(CONFIG_META, '').replace(CSP_CONTENT, (_match, start: string, policy: string, end: string) => {
    const directives = policy.split(';').map(part => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return name === 'script-src' || name === 'connect-src' ? [name, ...sources.filter(source => source !== endpoint)].join(' ') : part.trim();
    });
    return `${start}${directives.filter(Boolean).join('; ')}${end}`;
  });
};

/** Serve every HTML page of the app as `transform` rewrites it. */
const rewriteDocuments = (page: Page, transform: (html: string) => string) =>
  page.route(`http://127.0.0.1:${APP_PORT}/**`, async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, body: transform(await response.text()) });
  });

const policyOf = (page: Page) => page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
const lazyLauncher = (page: Page) => page.locator('.site-assistant-launcher');

const expectBeforeDock = async (locator: Locator, edge: number) => {
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box !== null && box.x >= -1 && box.x + box.width <= edge + 1;
  }, { message: `${locator} fits inside the page beside the assistant` }).toBe(true);
};

test.describe('with VITE_SOLV_* unset', () => {
  test('the site renders with no assistant, no widget request and the policy unchanged', async ({ page }) => {
    const widgetRequests: string[] = [];
    page.on('request', request => { if (/widget\.js|solv/.test(request.url())) widgetRequests.push(request.url()); });
    await rewriteDocuments(page, withoutBuildAssistant);

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
    // Every HTML page as a build configured with the test endpoint writes it.
    await rewriteDocuments(page, html => applySiteAssistantToHtml(withoutBuildAssistant(html), CONFIG));
    await page.route(`${ENDPOINT}/**`, async route => {
      widgetRequests.push(route.request().url());
      const { pathname } = new URL(route.request().url());
      if (pathname === '/widget.js') {
        await route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_WIDGET });
      } else if (pathname === '/v1/check/frame') {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Check</title><p id="check">Checking</p>' });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      }
    });
  });

  test('a fixed launcher appears after idle and loads the widget only when pressed', async ({ page }) => {
    await page.goto('/learn');
    expect(await policyOf(page)).toMatch(new RegExp(`script-src [^;]*${ENDPOINT.replace(/\./g, '\\.')}`));
    await settle(page);

    const launcher = lazyLauncher(page);
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveAccessibleName(LAUNCHER_LABEL);
    const label = await launcher.textContent();
    expect(label).toBe(LAUNCHER_LABEL);
    await expect(launcher).toHaveCSS('position', 'fixed');
    await launcher.hover();
    await launcher.focus();
    expect(await page.evaluate(() => [localStorage, sessionStorage].flatMap(storage => (
      Object.keys(storage).filter(key => /siteAssistant|solv/i.test(key))
    )))).toEqual([]);
    expect(widgetRequests).toEqual([]);
    await expect(page.locator('solv-chat')).toHaveCount(0);

    await expect(launcher).toBeFocused();
    await page.keyboard.press('Enter');

    const widget = page.locator('solv-chat');
    await expect(widget).toHaveAttribute('assistant', 'pk_e2e_test');
    await expect(widget).toHaveAttribute('endpoint', ENDPOINT);
    await expect(widget).toHaveAttribute('launcher-label', LAUNCHER_LABEL);
    await expect(widget).toHaveAttribute('launcher-shortcut', 'none');
    await expect(widget).toHaveAttribute('launcher-position', 'right');
    await expect(widget).toHaveAttribute('launcher-accent-color', '#0d6efd');
    await expect(widget).toHaveAttribute('opens-as', 'side');
    await expect(widget).toHaveAttribute('data-layout', 'side');
    await expect(page.getByRole('dialog', { name: 'Stub chat' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Your question' })).toBeFocused();
    await expect(launcher).toBeHidden();
    await page.getByRole('button', { name: 'Close chat' }).click();
    await expect(widget.getByRole('button', { name: LAUNCHER_LABEL })).toHaveText(label!);
    expect(widgetRequests).toEqual([`${ENDPOINT}/widget.js`]);
    expect(policyViolations).toEqual([]);
  });

  test('the visitor check frame is created only on the first keystroke, from the chat service\'s origin', async ({ page }) => {
    await page.goto('/learn');
    await settle(page);
    const otherFrames = () => page.frames().filter(frame => frame !== page.mainFrame()).map(frame => frame.url());
    const framesBefore = otherFrames();
    expect(framesBefore.filter(url => url.startsWith(ENDPOINT))).toEqual([]);

    await lazyLauncher(page).click();
    const input = page.getByRole('textbox', { name: 'Your question' });
    // Opening the panel focuses the field by itself; that starts no check.
    await expect(input).toBeFocused();
    await page.waitForTimeout(300);
    await expect(page.locator('solv-chat iframe')).toHaveCount(0);
    expect(otherFrames()).toEqual(framesBefore);
    expect(widgetRequests).toEqual([`${ENDPOINT}/widget.js`]);

    await input.press('H');
    const frame = page.locator('solv-chat iframe');
    await expect(frame).toHaveCount(1);
    expect(new URL(await frame.getAttribute('src') ?? '', page.url()).origin).toBe(ENDPOINT);
    // The page's policy let it load: the frame shows the chat service's page, from that origin.
    await expect(page.frameLocator('solv-chat iframe').locator('#check')).toHaveText('Checking');
    const checkFrames = page.frames().filter(f => f.url().startsWith(ENDPOINT));
    expect(checkFrames.map(f => f.url())).toEqual([CHECK_FRAME]);
    expect(await checkFrames[0].evaluate(() => window.location.origin)).toBe(ENDPOINT);
    expect(widgetRequests).toEqual([`${ENDPOINT}/widget.js`, CHECK_FRAME]);

    // More typing reuses the one frame.
    await input.press('i');
    await expect(frame).toHaveCount(1);
    expect(policyViolations).toEqual([]);
  });

  for (const width of [1280, 1440, 1920]) {
    test(`the docked assistant leaves the playground usable at ${width}px`, async ({ page, baseURL }) => {
      // Chromium treats the intercepted document as a synthetic response.
      // Allow that page to reach the loopback MCP fixture.
      await page.context().grantPermissions(['local-network-access'], { origin: baseURL });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/');
      await expect(lazyLauncher(page)).toBeVisible();

      const header = page.locator('.app-header');
      const sidebar = page.locator('.desktop-sidebar');
      await expect(sidebar).toBeVisible();
      const closedHeader = await header.boundingBox();
      await lazyLauncher(page).click();
      const panel = page.getByRole('dialog', { name: 'Stub chat' });
      const edge = width - PANEL_WIDTH;
      await expect.poll(async () => (await panel.boundingBox())?.x).toBe(edge);

      await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
      await expectBeforeDock(page.getByRole('button', { name: 'Connect', exact: true }), edge);
      expect(await hasHorizontalScroll(page)).toBe(false);
      expect(await page.locator('.main-content').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

      await page.getByLabel('MCP endpoint URL').fill(mockUrl('2026'));
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();

      await expectBeforeDock(header, edge);
      await expectBeforeDock(page.getByRole('button', { name: 'Toggle color theme' }), edge);
      if (edge < 1180) {
        await expect(sidebar).toBeHidden();
        await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
        await expectBeforeDock(page.getByRole('dialog', { name: 'Navigation' }), edge);
        await expectBeforeDock(page.locator('.mobile-sidebar-overlay'), edge);
        await page.keyboard.press('Escape');
      } else {
        await expectBeforeDock(sidebar, edge);
      }
      for (const pane of ['capabilities', 'request', 'response']) {
        await expectBeforeDock(page.locator(`.workbench-${pane}`), edge);
      }
      expect(await hasHorizontalScroll(page)).toBe(false);
      expect(await page.locator('.main-content').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

      await page.getByRole('button', { name: 'Test tools' }).click();
      const testDialog = page.getByRole('dialog', { name: 'Deterministic tool tests' });
      await expectBeforeDock(testDialog, edge);
      await testDialog.getByRole('button', { name: 'Close deterministic tests' }).click();

      const lists = page.getByRole('navigation', { name: 'Playground tool lists' });
      await lists.getByRole('option', { name: /get_forecast/ }).click();
      await page.getByLabel(/^city/).fill('Oslo');
      await page.getByRole('button', { name: 'Run tool', exact: true }).click();
      await page.getByRole('button', { name: 'Expand result in fullscreen' }).click();
      const fullscreen = page.locator('.modal:visible');
      await expectBeforeDock(fullscreen.locator('.modal-content'), edge);
      await fullscreen.locator('.btn-close').click();

      if (edge < 1180) await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
      await page.getByRole('button', { name: 'Close chat' }).click();
      await expect(sidebar).toBeVisible();
      await expect(page.locator('body')).not.toHaveClass(/menu-open/);
      await expect.poll(() => header.boundingBox()).toEqual(closedHeader);
    });
  }

  test('the static HTML of a prerendered page carries no widget markup', async ({ page }) => {
    const response = await page.request.get('/learn');
    const html = applySiteAssistantToHtml(withoutBuildAssistant(await response.text()), CONFIG);
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
    const launcher = lazyLauncher(page);
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
    const launcher = lazyLauncher(page);
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
