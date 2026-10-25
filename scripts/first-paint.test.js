// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import firstPaint from './first-paint.js';

const { DEFAULTS, findBrowser, formatTimeline, measureFirstPaint } = firstPaint;
const distDir = path.join(__dirname, '..', 'dist');

/**
 * Cold first load of the built home page in headless Chromium. Needs a fresh
 * `npm run build`, so it runs from `npm run test:first-paint` (CI runs it
 * after the build) rather than with the unit tests.
 */
describe.skipIf(!process.env.FIRST_PAINT)('first paint of the built home page', () => {
  it('paints the full shell first, in the stored theme, and mounts React without a visible change', async () => {
    expect(findBrowser(), 'Chromium is required; set CHROME_PATH').not.toBeNull();
    expect(fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')).toContain('seo-shell-fallback');

    const result = await measureFirstPaint({ distDir, colorScheme: 'dark' });
    console.log(formatTimeline(result));

    expect(result.screenshots.length).toBeLessThanOrEqual(DEFAULTS.maxScreenshots);
    expect(result.samples).toHaveLength(DEFAULTS.durationMs / DEFAULTS.intervalMs);

    // data-theme is set once, from the system preference, before anything paints.
    const firstPaintAt = result.paints['first-paint'];
    expect(firstPaintAt).toBeTypeOf('number');
    expect(result.themeChanges).toEqual([{ t: expect.any(Number), value: 'dark' }]);
    expect(result.themeChanges[0].t).toBeLessThanOrEqual(firstPaintAt);

    // Every painted frame is the whole shell: never blank, never a connection panel.
    const painted = result.samples.filter(sample => sample.painted);
    expect(painted.length).toBeGreaterThan(0);
    for (const sample of painted) {
      expect(sample, `frame at ${sample.t} ms`).toMatchObject({
        blank: false,
        theme: 'dark',
        header: true,
        sidebar: true,
        landing: true,
        connect: true,
        connectionPanel: false,
      });
      expect(['static', 'react']).toContain(sample.phase);
    }
    expect(result.samples.at(-1).phase, 'React mounted within the capture window').toBe('react');

    // A blank frame compresses to a fraction of a full one.
    const paintedShots = result.screenshots.filter(shot => painted.some(sample => sample.t === shot.t));
    const fullFrame = Math.max(...result.screenshots.map(shot => shot.bytes));
    for (const shot of paintedShots) {
      expect(shot.bytes, `screenshot at ${shot.t} ms`).toBeGreaterThan(fullFrame * 0.6);
    }

    expect(result.cls).toBeLessThan(0.05);
  }, 90000);
});


describe.skipIf(!process.env.FIRST_PAINT)('first paint of the built catalog', () => {
  it.each([
    { pathname: '/catalog?auth=oauth', controls: { catalogAuth: 'oauth' }, filtered: true },
    { pathname: '/catalog?q=github', controls: { catalogSearch: 'github' }, filtered: true },
    { pathname: '/catalog?category=Developer%20Tools', controls: { catalogCategory: 'Developer Tools' }, filtered: true },
    { pathname: '/catalog?sort=name', controls: { catalogSort: 'name' }, filtered: false },
    { pathname: '/catalog.html?auth=oauth&sort=name', controls: { catalogAuth: 'oauth', catalogSort: 'name' }, filtered: true },
  ])('mounts $pathname with its URL state without input', async ({ pathname, controls, filtered }) => {
    const html = fs.readFileSync(path.join(distDir, 'catalog.html'), 'utf8');
    const rowCount = (html.match(/class="catalog-server-row"/g) || []).length;
    const result = await measureFirstPaint({
      distDir, pathname, durationMs: 7000,
      // No synthetic input: filtered URLs must start React on their own.
    });
    const last = result.samples.at(-1);
    expect(last.phase, formatTimeline(result)).toBe('react');
    expect(last).toMatchObject({ catalog: true, ...controls });
    expect(last.catalogRows).toBeGreaterThan(0);
    if (filtered) expect(last.catalogRows).toBeLessThan(rowCount);
    else expect(last.catalogRows).toBe(rowCount);
  }, 90000);

  it.each([{ width: 1280, height: 800 }, { width: 390, height: 844 }])('paints every row and mounts without shifting at $width px', async (viewport) => {
    const html = fs.readFileSync(path.join(distDir, 'catalog.html'), 'utf8');
    const rowCount = (html.match(/class="catalog-server-row"/g) || []).length;
    expect(rowCount).toBeGreaterThan(0);
    expect(html).toContain('data-critical-css');
    const result = await measureFirstPaint({
      distDir, pathname: '/catalog', viewport, colorScheme: 'dark',
      durationMs: 7000, triggerMountAtMs: 1800,
    });
    console.log(formatTimeline(result));
    const painted = result.samples.filter(sample => sample.painted);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.some(sample => sample.phase === 'static')).toBe(true);
    for (const sample of painted) {
      expect(sample, `frame at ${sample.t} ms`).toMatchObject({
        blank: false, header: true, catalog: true, theme: 'dark',
      });
      expect(sample.catalogRows).toBeGreaterThan(0);
      expect(['static', 'react']).toContain(sample.phase);
    }
    expect(result.samples.at(-1).catalogRows).toBe(rowCount);
    expect(result.samples.at(-1).phase).toBe('react');
    expect(result.cls).toBeLessThan(0.05);
  }, 90000);
});


describe.skipIf(!process.env.FIRST_PAINT)('returning visitor first paint', () => {
  it.each([{ width: 1280, height: 800 }, { width: 390, height: 844 }])('paints the restored workspace without landing frames at $width px', async (viewport) => {
    const result = await measureFirstPaint({ distDir, viewport, durationMs: 7000,
      recentServers: [{ url: 'https://mcp.context7.com/mcp' }],
      savedTabs: [
        { id: 'default-tab', title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' },
        { id: 'saved-server', title: 'mcp.context7.com', serverUrl: 'https://mcp.context7.com/mcp', connectionStatus: 'Connected', autoConnect: false },
      ],
    });
    console.log(formatTimeline(result));
    const painted = result.samples.filter(s => s.painted);
    expect(painted.some(s => s.phase === 'static')).toBe(true);
    expect(painted.some(s => s.phase === 'react')).toBe(true);
    for (const sample of painted) expect(sample, `frame ${sample.t}ms`).toMatchObject({
      blank: false, header: true, sidebar: viewport.width > 768, landing: false, connectionPanel: true, workspaceRecent: true,
      tabs: ['New Connection', 'mcp.context7.com'],
    });
    expect(result.cls).toBeLessThan(0.05);
  }, 90000);
});
