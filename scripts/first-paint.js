#!/usr/bin/env node

/**
 * First-paint timeline for the home page: serves a built dist/ directory,
 * opens it in a cold headless Chromium context over the DevTools protocol
 * (Node's global WebSocket, no Playwright), and samples what is on screen
 * every 100 ms. Screenshots are capped because many full-page captures have
 * exhausted container memory before.
 *
 *   node scripts/first-paint.js [distDir] [--screenshots <dir>] [--color-scheme light|dark]
 *
 * scripts/first-paint.test.js asserts on the same measurement.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULTS = {
  durationMs: 4000,
  intervalMs: 100,
  maxScreenshots: 10,
  colorScheme: 'dark',
  viewport: { width: 1280, height: 800 },
  // A broadband-like link: slow enough that the static HTML, stylesheet,
  // font and bundle arrive in separate frames, fast enough to mount in 4 s.
  network: { latency: 40, downloadThroughput: (20 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 },
};

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

function findBrowser() {
  return BROWSER_CANDIDATES.find(candidate => fs.existsSync(candidate)) || null;
}

/** Static host resolution: file, directory index, `.html` sibling, then the SPA shell. */
function serveDist(distDir) {
  const root = path.resolve(distDir);
  const resolve = (pathname) => {
    const candidates = [
      path.join(root, pathname),
      path.join(root, pathname, 'index.html'),
      path.join(root, `${pathname.replace(/\/$/, '')}.html`),
    ];
    for (const candidate of candidates) {
      if (candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return path.join(root, 'index.html');
  };
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(pathname);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise({
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(done => server.close(done)),
    }));
  });
}

const LAUNCH_TIMEOUT_MS = Number(process.env.FIRST_PAINT_LAUNCH_TIMEOUT_MS) || 60000;
const LAUNCH_ATTEMPTS = 2;

function launchBrowser(browserPath, viewport) {
  return launchBrowserOnce(browserPath, viewport);
}

/** Launches Chromium, retrying once when the first attempt never reaches "DevTools listening". */
async function launchBrowserWithRetry(browserPath, viewport) {
  let lastError;
  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt += 1) {
    const browser = launchBrowserOnce(browserPath, viewport);
    try {
      const endpoint = await browser.endpoint;
      return { endpoint: Promise.resolve(endpoint), close: browser.close };
    } catch (error) {
      lastError = error;
      await browser.close();
      if (attempt < LAUNCH_ATTEMPTS) {
        process.stderr.write(`first-paint: Chromium launch attempt ${attempt} failed, retrying\n`);
      }
    }
  }
  throw lastError;
}

function launchBrowserOnce(browserPath, viewport) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-paint-'));
  const child = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${viewport.width},${viewport.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Chromium keeps writing to its profile for a moment after SIGKILL on slow runners, so
  // wait for the process to exit before removing the directory, and tolerate leftovers.
  const exited = new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 5000).unref();
  });
  const close = async () => {
    child.kill('SIGKILL');
    await exited;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 4) {
          process.stderr.write(`first-paint: could not remove ${userDataDir}: ${error.message}\n`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  };
  const endpoint = new Promise((resolvePromise, reject) => {
    let output = '';
    // Cold starts on shared CI runners can take well over 20 s before DevTools is listening.
    const timer = setTimeout(() => reject(new Error(`Chromium did not start: ${output}`)), LAUNCH_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolvePromise(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited with ${code}: ${output}`));
    });
  });
  return { endpoint, close };
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const handler = message.id && pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`));
    else handler.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }));
    socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)));
  });
}

/**
 * Installed before any page script: records when data-theme is set or
 * changed, and collects paint and layout-shift entries.
 */
const OBSERVER_SOURCE = `(() => {
  const state = window.__firstPaint = { themeChanges: [], paints: {}, cls: 0, shifts: [] };
  const recordTheme = () => {
    const html = document.documentElement;
    const value = html && html.getAttribute('data-theme');
    const last = state.themeChanges[state.themeChanges.length - 1];
    if ((last ? last.value : null) !== value) state.themeChanges.push({ t: performance.now(), value });
  };
  new MutationObserver(recordTheme).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) state.paints[entry.name] = entry.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      state.cls += entry.value;
      state.shifts.push({
        t: entry.startTime,
        value: entry.value,
        sources: (entry.sources || []).map(source => {
          const node = source.node;
          return node && node.nodeType === 1 ? node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).trim().split(/\\s+/).join('.') : '') : String(node && node.nodeName);
        }),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
})();`;

const SAMPLE_EXPRESSION = `(() => {
  const state = window.__firstPaint;
  const root = document.getElementById('root');
  const has = selector => Boolean(root && root.querySelector(selector));
  const text = document.body ? document.body.innerText.trim().length : 0;
  const inter = document.fonts ? [...document.fonts].some(face => face.family.replace(/"/g, '') === 'Inter Variable' && face.status === 'loaded') : false;
  let phase = 'no-document';
  if (root) {
    if (has('.seo-shell-fallback, .seo-landing-fallback')) phase = 'static';
    else if (root.children.length) phase = 'react';
    else phase = 'empty-root';
  }
  return {
    url: location.href,
    phase,
    blank: text === 0,
    theme: document.documentElement.getAttribute('data-theme'),
    header: has('.app-header'),
    // The static shell keeps the desktop nav in the DOM on mobile.
    // Layout boxes respect hidden ancestors as well as the nav's own display.
    sidebar: [...(root?.querySelectorAll('.desktop-sidebar .app-sidenav') || [])].some(el => el.getClientRects().length > 0),
    landing: has('.landing-title'),
    recent: [...document.querySelectorAll('.landing-recent')].some(el => getComputedStyle(el).display !== 'none'),
    newUserPicks: [...document.querySelectorAll('.landing-quick-picks')].some(el => el.textContent.includes('Try with') && getComputedStyle(el).display !== 'none'),
    recentHosts: [...document.querySelectorAll('.landing-recent-host')].map(el => el.textContent),
    connect: has('.landing-connect'),
    catalog: has('.catalog-view'),
    catalogRows: root ? root.querySelectorAll('.catalog-server-row').length : 0,
    catalogSearch: root?.querySelector('.catalog-search-field input')?.value,
    catalogAuth: root?.querySelector('#catalog-auth')?.value,
    catalogSort: root?.querySelector('#catalog-sort')?.value,
    catalogCategory: root?.querySelector('#catalog-category')?.value,
    connectionPanel: has('.connection-console'),
    inter,
    painted: Boolean(state && state.paints['first-paint'] !== undefined),
    cls: state ? state.cls : 0,
  };
})()`;

async function measureFirstPaint(options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const browserPath = settings.browserPath || findBrowser();
  if (!browserPath) throw new Error('No Chromium found; set CHROME_PATH.');
  const indexFile = path.join(settings.distDir, 'index.html');
  if (!fs.existsSync(indexFile)) throw new Error(`${indexFile} is missing; run npm run build first.`);

  const server = await serveDist(settings.distDir);
  const browser = await launchBrowserWithRetry(browserPath, settings.viewport);
  let cdp;
  try {
    cdp = await connect(await browser.endpoint);
    // A fresh browser context has an empty cache and empty localStorage.
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);

    await page('Page.enable');
    await page('Runtime.enable');
    await page('Network.enable');
    await page('Network.emulateNetworkConditions', { offline: false, ...settings.network });
    await page('Emulation.setDeviceMetricsOverride', {
      width: settings.viewport.width,
      height: settings.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: settings.colorScheme }],
    });
    await page('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER_SOURCE });

    if (settings.recentServers) await page('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('mcpRecentServers', ${JSON.stringify(JSON.stringify(settings.recentServers))})`,
    });

    const samples = [];
    const screenshots = [];
    const ticks = Math.floor(settings.durationMs / settings.intervalMs);
    const screenshotEvery = Math.max(1, Math.ceil(ticks / settings.maxScreenshots));
    const startedAt = Date.now();
    await page('Page.navigate', { url: `${server.origin}${settings.pathname || '/'}` });

    let inputTriggered = false;
    for (let tick = 0; tick < ticks; tick++) {
      const due = startedAt + tick * settings.intervalMs;
      const wait = due - Date.now();
      if (wait > 0) await new Promise(done => setTimeout(done, wait));
      const t = Date.now() - startedAt;
      if (settings.triggerMountAtMs !== undefined && t >= settings.triggerMountAtMs && !inputTriggered) {
        inputTriggered = true;
        // Synthetic input starts the deferred mount without excluding layout
        // shifts as recent user input, so the swap is part of the CLS budget.
        await page('Runtime.evaluate', { expression: "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))" });
      }
      const { result } = await page('Runtime.evaluate', { expression: SAMPLE_EXPRESSION, returnByValue: true });
      const sample = { t, ...(result.value || { phase: 'no-document', blank: true }) };
      if (!String(sample.url || '').startsWith(server.origin)) sample.phase = 'navigating';
      if (tick % screenshotEvery === 0 && screenshots.length < settings.maxScreenshots) {
        const { data } = await page('Page.captureScreenshot', { format: 'jpeg', quality: 40 });
        const bytes = Buffer.from(data, 'base64');
        sample.screenshotBytes = bytes.length;
        screenshots.push({ t, bytes });
      }
      samples.push(sample);
    }

    const { result } = await page('Runtime.evaluate', {
      expression: 'JSON.stringify({ ...window.__firstPaint, navigationStart: 0 })',
      returnByValue: true,
    });
    const observed = JSON.parse(result.value);

    if (settings.screenshotDir) {
      fs.mkdirSync(settings.screenshotDir, { recursive: true });
      for (const shot of screenshots) {
        fs.writeFileSync(path.join(settings.screenshotDir, `frame-${String(shot.t).padStart(4, '0')}ms.jpg`), shot.bytes);
      }
    }

    return {
      samples,
      screenshots: screenshots.map(({ t, bytes }) => ({ t, bytes: bytes.length })),
      themeChanges: observed.themeChanges,
      paints: observed.paints,
      cls: observed.cls,
      shifts: observed.shifts,
    };
  } finally {
    cdp?.close();
    await browser.close();
    await server.close();
  }
}

/** One line per state change, for the PR description. */
function formatTimeline(result) {
  const describe = sample => [
    sample.painted ? sample.phase : `${sample.phase} (not yet painted)`,
    sample.blank ? 'BLANK' : null,
    sample.header ? 'header' : null,
    sample.sidebar ? 'sidebar' : null,
    sample.landing ? 'landing' : null,
    sample.connect ? 'connect-form' : null,
    sample.recent ? 'recent-chips' : null,
    sample.newUserPicks ? 'new-user-picks' : null,
    sample.connectionPanel ? 'connection-panel' : null,
    `theme=${sample.theme || 'unset'}`,
    sample.inter ? 'Inter' : 'fallback-font',
  ].filter(Boolean).join(' ');
  const lines = [];
  let previous = '';
  for (const sample of result.samples) {
    const state = describe(sample);
    if (state !== previous) lines.push(`${String(sample.t).padStart(5)} ms  ${state}`);
    previous = state;
  }
  const firstPaint = result.paints['first-paint'];
  const themeSet = result.themeChanges[0];
  lines.push(`first-paint ${firstPaint?.toFixed(0)} ms, first-contentful-paint ${result.paints['first-contentful-paint']?.toFixed(0)} ms (page clock)`);
  lines.push(`data-theme changes: ${result.themeChanges.map(change => `${change.value}@${change.t.toFixed(0)}ms`).join(', ') || 'none'}`);
  lines.push(`theme set before first paint: ${Boolean(themeSet && firstPaint !== undefined && themeSet.t <= firstPaint)}`);
  lines.push(`cumulative layout shift: ${result.cls.toFixed(4)}${result.shifts.length ? ` (${result.shifts.map(shift => `${shift.value.toFixed(4)}@${shift.t.toFixed(0)}ms ${shift.sources.join(',')}`).join('; ')})` : ''}`);
  lines.push(`screenshots: ${result.screenshots.length} (${result.screenshots.map(shot => `${shot.t}ms:${Math.round(shot.bytes / 1024)}KB`).join(' ')})`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const [, value] = args.splice(index, 2);
    return value;
  };
  const screenshotDir = option('--screenshots');
  const colorScheme = option('--color-scheme');
  const distDir = path.resolve(args[0] || path.join(__dirname, '..', 'dist'));
  const result = await measureFirstPaint({ distDir, screenshotDir, ...(colorScheme ? { colorScheme } : {}) });
  console.log(formatTimeline(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULTS, findBrowser, formatTimeline, measureFirstPaint };
