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
