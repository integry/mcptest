import AxeBuilder from '@axe-core/playwright';
import { DISCOVERY_PORT } from '../../playwright.config';
import { expect, test } from './fixtures';

for (const theme of ['light', 'dark']) {
  test(`OAuth checker discovers local issuer-path metadata without registration (${theme})`, async ({ page, externalRequests }) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    const forbidden: string[] = [];
    page.on('request', request => {
      if (/\/(register|authorize|token)$/.test(new URL(request.url()).pathname)) forbidden.push(request.url());
    });
    const response = await page.goto('/tools/oauth-check');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/MCP OAuth Checker: Test Your Server/);
    await page.keyboard.press('Shift');
    await expect(page.locator('#root > [data-deferred-mount]')).toHaveCount(0);
    await page.getByLabel('MCP endpoint URL').fill(`http://127.0.0.1:${DISCOVERY_PORT}/oauth-mcp`);
    await page.getByRole('button', { name: 'Check OAuth', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Clients can start OAuth (metadata checks passed)', exact: true })).toBeVisible();
    await expect(page.getByTestId('oauth-challenge')).toContainText('POST initialize HTTP 401');
    await expect(page.getByTestId('oauth-issuer')).toContainText(`/tenant`);
    await expect(page.getByTestId('oauth-registration')).toContainText('no registration was attempted');
    await expect(page.getByTestId('oauth-pkce')).toContainText('S256');
    await expect(page.getByRole('link', { name: 'Open in inspector' })).toHaveAttribute('href', `/server/http:127.0.0.1:${DISCOVERY_PORT}/oauth-mcp`);
    await expect(page.getByRole('heading', { name: 'Client redirect URIs' })).toBeVisible();
    await expect(page.getByText('https://vscode.dev/redirect', { exact: false })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
    expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    expect(forbidden).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}
