import type { Page } from '@playwright/test';
import { connectAndWait, expect, test } from './fixtures';

/** The structured / content / JSON-RPC view inside the Result tab. */
const resultView = (page: Page) => page.getByRole('tabpanel', { name: 'Result' }).getByRole('tabpanel');

test.describe('playground against the mock MCP server', () => {
  test('2026-07-28 stateless: connect, capabilities, fuzzy search, structured output and error result', async ({ page, externalRequests }, testInfo) => {
    await connectAndWait(page, '2026');

    const era = page.getByTestId('connection-protocol-era');
    await expect(era).toHaveText('Stateless');
    await expect(era).toHaveAttribute('title', 'Negotiated MCP 2026-07-28');

    // Capabilities: tools, resources and prompts from the mock.
    await expect(page.getByText('2 tools · 1 resource · 1 prompt', { exact: true })).toBeVisible();
    const lists = page.getByRole('navigation', { name: 'Playground tool lists' });
    await expect(lists.getByRole('option', { name: /get_forecast/ })).toBeVisible();
    await expect(lists.getByRole('option', { name: /always_fails/ })).toBeVisible();
    await expect(lists.getByRole('option', { name: /readme/ })).toBeVisible();
    await expect(lists.getByRole('option', { name: /greeting/ })).toBeVisible();

    // Fuzzy search: a subsequence of the tool name finds it and nothing else.
    const search = page.getByRole('combobox', { name: 'Search tools, resources and prompts' });
    await search.fill('frcst');
    await expect(lists.getByRole('option', { name: /get_forecast/ })).toBeVisible();
    await expect(lists.getByRole('option')).toHaveCount(1);
    await search.press('Enter');
    await expect(page.locator('#executeBtn')).toHaveText('Run tool');

    // Structured tool: the verdict and the structured view.
    await page.getByLabel(/^city/).fill('Oslo');
    await page.locator('#executeBtn').click();
    await expect(page.getByRole('status').filter({ hasText: 'Structured output matches the declared output schema.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Structured' })).toHaveAttribute('aria-selected', 'true');
    await expect(resultView(page)).toContainText('"conditions": "Light rain"');
    await expect(resultView(page)).toContainText('"city": "Oslo"');
    await testInfo.attach('playground-structured-output', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Error tool: isError is surfaced and exempt from the output contract.
    await search.fill('');
    await lists.getByRole('option', { name: /always_fails/ }).click();
    await page.locator('#executeBtn').click();
    await expect(page.getByRole('alert').filter({ hasText: 'The tool reported an error (isError: true).' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Structured output matches' })).toHaveCount(0);

    expect(externalRequests).toEqual([]);
  });

  test('2025-11-25 stateful: falls back to initialize and keeps the session', async ({ page }) => {
    await connectAndWait(page, '2025');

    const era = page.getByTestId('connection-protocol-era');
    await expect(era).toHaveText('Stateful');
    await expect(era).toHaveAttribute('title', 'Negotiated MCP 2025-11-25');
    await expect(page.getByText('2 tools · 1 resource · 1 prompt', { exact: true })).toBeVisible();

    // A call after the handshake only succeeds when the session id is sent.
    const lists = page.getByRole('navigation', { name: 'Playground tool lists' });
    await lists.getByRole('option', { name: /get_forecast/ }).click();
    await page.getByLabel(/^city/).fill('Tartu');
    await page.locator('#executeBtn').click();
    await expect(page.getByRole('status').filter({ hasText: 'Structured output matches the declared output schema.' })).toBeVisible();
    await expect(resultView(page)).toContainText('"city": "Tartu"');
  });
});
