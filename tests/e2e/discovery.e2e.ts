import { DISCOVERY_PORT, MOCK_PORT } from '../../playwright.config';
import { expect, test } from './fixtures';

const DOMAIN = `127.0.0.1:${DISCOVERY_PORT}`;
const ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/2026/mcp`;

test.describe('MCP discovery checker', () => {
  test('is a prerendered page linked from the sidebar', async ({ page }) => {
    const response = await page.goto('/tools/discovery');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/MCP Discovery Checker/);
    await expect(page.getByRole('heading', { level: 1, name: 'MCP discovery checker' })).toBeVisible();
    await expect(page.locator('#app-sidenav-desktop').getByRole('link', { name: 'Discovery check' })).toHaveAttribute('aria-current', 'page');
  });

  test('finds the endpoint a local domain advertises, validates each location and opens it in the inspector', async ({ page, externalRequests }) => {
    await page.goto('/tools/discovery');
    await page.getByLabel('Domain', { exact: true }).fill(DOMAIN);
    await page.getByRole('button', { name: 'Check domain' }).click();

    await expect(page).toHaveURL(new RegExp(`/tools/discovery\\?domain=${encodeURIComponent(DOMAIN)}$`));
    await expect(page.getByRole('heading', { name: `1 MCP endpoint on ${DOMAIN}` })).toBeVisible();

    const row = (id: string) => page.getByTestId(`discovery-row-${id}`);
    await expect(row('well-known-server-card')).toHaveAttribute('data-status', 'found');
    await expect(row('well-known-server-card')).toContainText(`http://${DOMAIN}/.well-known/mcp/server-card.json`);
    await expect(row('well-known-server-card')).toContainText('A valid Server Card for E2E Forecast 1.0.0');
    await expect(row('well-known-server-cards')).toHaveAttribute('data-status', 'not-found');
    await expect(row('legacy-mcp-json')).toHaveAttribute('data-status', 'invalid');
    await expect(row('legacy-mcp-json')).toContainText('$schema');
    await expect(row('ai-catalog')).toHaveAttribute('data-status', 'not-found');
    await expect(row('ai-catalog')).toContainText('HTML page');
    await expect(row('endpoint-server-card-0')).toHaveAttribute('data-status', 'not-found');
    await expect(row('endpoint-server-card-0')).toContainText(`${ENDPOINT}/server-card`);
    await expect(row('oauth-0')).toHaveAttribute('data-status', 'not-found');
    await expect(row('registry')).toHaveAttribute('data-status', 'skipped');
    await expect(row('catalog')).toHaveAttribute('data-status', 'not-found');
    // A valid card was found, so there is nothing to fix.
    await expect(page.getByRole('heading', { name: /Publish a Server Card/ })).toHaveCount(0);

    // The canonical inspector link preserves the endpoint and connects automatically.
    const inspectorLink = page.getByRole('link', { name: 'Test in inspector' });
    await expect(inspectorLink).toHaveAttribute('href', `/server/http:127.0.0.1:${MOCK_PORT}/2026/mcp?transport=http`);
    await inspectorLink.click();
    await expect(page).toHaveURL(`/server/http:127.0.0.1:${MOCK_PORT}/2026/mcp?transport=http`);
    await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
    await expect(page.locator('code').filter({ hasText: ENDPOINT })).toBeVisible();
    expect(externalRequests).toEqual([]);
  });

  test('offers a copy-paste Server Card for a domain without one', async ({ page }) => {
    await page.goto(`/tools/discovery?domain=127.0.0.1:${MOCK_PORT}`);
    await expect(page.getByRole('heading', { name: `No MCP endpoint advertised by 127.0.0.1:${MOCK_PORT}` })).toBeVisible();
    await expect(page.getByTestId('discovery-row-well-known-server-card')).toHaveAttribute('data-status', 'not-found');

    const fix = page.getByRole('region', { name: `Publish a Server Card for 127.0.0.1:${MOCK_PORT}` });
    await expect(fix).toBeVisible();
    await expect(fix).toContainText('Content-Type: application/mcp-server-card+json');
    await expect(fix).toContainText(`http://127.0.0.1:${MOCK_PORT}/mcp/server-card`);
    await expect(fix).toContainText('"$schema": "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json"');
    await expect(fix).toContainText(`http://127.0.0.1:${MOCK_PORT}/.well-known/ai-catalog.json`);
  });
});
