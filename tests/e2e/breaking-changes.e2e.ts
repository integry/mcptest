import { expect, mockUrl, test } from './fixtures';

/** The mock server's tools/list response, fetched from Node so the browser stays hermetic. */
const listMockTools = async (request: import('@playwright/test').APIRequestContext) => {
  const response = await request.post(mockUrl('2026'), {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/list',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ jsonrpc: '2.0'; id: number; result: { tools: Array<Record<string, any>> } }>;
};

test('breaking changes: classifies two pasted tools/list payloads from the mock server', async ({ page, request, externalRequests }) => {
  const before = await listMockTools(request);
  expect(before.result.tools.map((tool) => tool.name)).toEqual(['get_forecast', 'always_fails']);

  // The next deploy: one tool gone, a new required input, an output field
  // removed, a read-only tool that may now write, and one new tool.
  const after = structuredClone(before);
  const forecast = after.result.tools.find((tool) => tool.name === 'get_forecast')!;
  forecast.inputSchema.properties.units = { type: 'string', enum: ['metric', 'imperial'] };
  forecast.inputSchema.required.push('units');
  delete forecast.outputSchema.properties.conditions;
  forecast.outputSchema.required = ['city', 'temperatureC'];
  forecast.annotations.readOnlyHint = false;
  after.result.tools = [
    forecast,
    { name: 'get_alerts', description: 'Weather alerts for a region.', inputSchema: { type: 'object', properties: { region: { type: 'string' } } } },
  ];

  const response = await page.goto('/tools/breaking-changes');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('MCP Breaking Change Checker for tools/list | mcptest.io');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://mcptest.io/tools/breaking-changes');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'MCP breaking-change check' })).toBeVisible();
  await expect(page.locator('#app-sidenav-desktop a[href="/tools/breaking-changes"]')).toHaveClass(/active/);

  await main.getByLabel('Before (currently deployed)').fill(JSON.stringify(before, null, 2));
  await main.getByLabel('After (about to ship)').fill(JSON.stringify(after, null, 2));
  await main.getByRole('button', { name: 'Compare', exact: true }).click();

  const results = main.getByRole('region', { name: 'Results' });
  await expect(results.getByTestId('breaking-changes-summary')).toHaveText('3 breaking, 1 risky, 1 safe');

  const removed = results.getByRole('region', { name: /Tool\s*always_fails/ });
  await expect(removed).toContainText('Tool removed');
  await expect(removed).toContainText('unknown-tool error');

  const changed = results.getByRole('region', { name: /Tool\s*get_forecast/ });
  await expect(changed).toContainText('Input "units" is now required');
  await expect(changed).toContainText('Output field "conditions" removed');
  await expect(changed).toContainText('readOnlyHint changed from true to false');
  await expect(changed.getByRole('link', { name: 'Why: Input "units" is now required' }))
    .toHaveAttribute('href', '/learn/which-mcp-tool-changes-break-clients#adding-a-required-input');

  await expect(results.getByRole('region', { name: /Tool\s*get_alerts/ })).toContainText('Tool added');

  // Breaking groups come first.
  const subjects = await results.locator('.breaking-findings-subject code').allTextContents();
  expect(subjects).toEqual(['always_fails', 'get_forecast', 'get_alerts']);

  // An invalid payload is explained on its field instead of comparing.
  await main.getByLabel('After (about to ship)').fill('{"prompts": []}');
  await main.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(main.getByText('No "tools" array found. Paste the result of a tools/list request.')).toBeVisible();
  await expect(results).toHaveCount(0);

  expect(externalRequests).toEqual([]);
});

test('breaking changes: the explanation link opens the guide section', async ({ page }) => {
  await page.goto('/tools/breaking-changes');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Load an example' }).click();
  await main.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(main.getByTestId('breaking-changes-summary')).toContainText('breaking');
  await main.getByRole('link', { name: /^Why: Renamed to/ }).click();
  await expect(page).toHaveURL('/learn/which-mcp-tool-changes-break-clients#removing-or-renaming-a-tool');
  await expect(page.getByRole('heading', { level: 2, name: 'Removing or renaming a tool' })).toBeVisible();
});
