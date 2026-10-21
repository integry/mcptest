import { connect, expect, test, type MockPath } from './fixtures';

const MODES: Array<{ path: MockPath; id: string; detail: RegExp }> = [
  {
    path: 'accept-406',
    id: 'transport.accept-header-406',
    detail: /answered POST initialize with HTTP 406 although the request sent Accept: application\/json, text\/event-stream/,
  },
  {
    path: 'no-expose',
    id: 'transport.cors-expose-headers-missing',
    detail: /the browser could not read Mcp-Session-Id/,
  },
  {
    path: 'rate-limited',
    id: 'transport.target-rate-limited-429',
    detail: /The server asked clients to wait 2 minutes/,
  },
];

test.describe('transport diagnostics per misbehavior mode', () => {
  for (const mode of MODES) {
    test(`${mode.path} → ${mode.id}`, async ({ page }, testInfo) => {
      await connect(page, mode.path);

      const detected = page.getByTestId('transport-diagnostic')
        .filter({ has: page.getByText(mode.id, { exact: true }) });
      await expect(detected).toHaveCount(1);
      await expect(detected.locator('.badge')).toHaveText('Error');
      await expect(detected).toContainText(mode.detail);
      // Only the expected id is detected; any other entry is "Not checked".
      const others = await page.getByTestId('transport-diagnostic')
        .filter({ hasNotText: mode.id })
        .locator('.badge')
        .allInnerTexts();
      expect(others.filter(label => label !== 'Not checked')).toEqual([]);
      await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toHaveCount(0);

      if (mode.path === 'accept-406') {
        await detected.scrollIntoViewIfNeeded();
        await testInfo.attach('transport-diagnostic-406', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      }
    });
  }
});
