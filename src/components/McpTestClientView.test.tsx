import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import McpTestClientView from './McpTestClientView';
import McpTestServersView from './McpTestServersView';
import { PUBLIC_FIXTURES } from '../data/publicFixtures';
import { CLIENT_CHECKLISTS } from '../content/mcpTestClientChecklist';
import { MCP_TEST_CLIENT_FAQ, SELF_CHECK_EXCHANGES, SELF_CHECK_FIELDS } from '../content/mcpTestClientCopy';
import { formatExchangeRequest, formatExchangeResponse } from '../content/mcpTestClientExchanges';

const render = (element: React.ReactElement, path: string): HTMLElement => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
  return container;
};

const decode = (value: string): string => {
  const element = document.createElement('textarea');
  element.innerHTML = value;
  return element.value;
};

describe('McpTestClientView', () => {
  const page = render(<McpTestClientView />, '/mcp-test-client');
  const hrefs = Array.from(page.querySelectorAll('a'), link => link.getAttribute('href'));

  it('has one h1 and a checklist section per fixture, in fixture order', () => {
    expect(Array.from(page.querySelectorAll('h1'), heading => heading.textContent)).toEqual(['Test your MCP client']);
    expect(Array.from(page.querySelectorAll('[data-checklist]'), section => section.getAttribute('data-checklist')))
      .toEqual(PUBLIC_FIXTURES.map(fixture => fixture.id));
    for (const fixture of PUBLIC_FIXTURES) {
      const section = page.querySelector(`[data-checklist="${fixture.id}"]`)!;
      expect(section.querySelector('.reading-code pre')?.textContent).toBe(fixture.url);
      expect(section.querySelector(`a[data-test-fixture="${fixture.id}"]`)?.getAttribute('href'))
        .toBe(`/server/mcptest.io/fixtures/${fixture.id}/mcp`);
    }
  });

  it('covers every check the issue asks for', () => {
    const checks = CLIENT_CHECKLISTS.flatMap(checklist => checklist.items.map(item => `${checklist.fixture}: ${item.check}`)).join('\n');
    for (const phrase of [
      /echo: .*initialize.*notifications\/initialized/,
      /echo: Negotiates the protocol version/,
      /echo: Lists tools and calls them/,
      /auth-bearer: Handles a 401 with WWW-Authenticate/,
      /auth-bearer: Sends the bearer token/,
      /errors: Shows JSON-RPC errors/,
      /errors: .*isError/,
      /slow: Enforces a request timeout/,
      /slow: .*progress/,
      /schemas: .*nested, enum, array/,
      /schemas: .*structuredContent.*outputSchema/,
    ]) expect(checks).toMatch(phrase);
  });

  it('renders every check with its request and expected response in copyable blocks', () => {
    for (const checklist of CLIENT_CHECKLISTS) {
      for (const item of checklist.items) {
        const section = page.querySelector(`[data-check="${item.id}"]`)!;
        expect(section.querySelector('h3')?.textContent).toBe(item.check);
        for (const exchange of item.exchanges) {
          const blocks = Array.from(section.querySelectorAll(`[data-exchange="${exchange.id}"] .reading-code pre`), pre => pre.textContent);
          expect(blocks).toEqual([formatExchangeRequest(exchange), formatExchangeResponse(exchange)]);
        }
      }
    }
    expect(page.querySelectorAll('.reading-code-copy')).toHaveLength(page.querySelectorAll('.reading-code').length);
  });

  it('includes the whoami/headers self-check and how to read it', () => {
    const selfCheck = page.textContent ?? '';
    for (const exchange of SELF_CHECK_EXCHANGES) expect(page.querySelector(`[data-exchange="${exchange.id}"]`)).not.toBeNull();
    for (const row of SELF_CHECK_FIELDS) expect(selfCheck).toContain(row.field);
  });

  it('answers every FAQ question on the page', () => {
    const questions = Array.from(page.querySelectorAll('.mcp-test-client-faq h3'), heading => heading.textContent);
    expect(questions).toEqual(MCP_TEST_CLIENT_FAQ.map(entry => entry.question));
    for (const entry of MCP_TEST_CLIENT_FAQ) expect(decode(page.innerHTML)).toContain(entry.answer);
  });

  it('links the client guides, the support matrix, the comparison and the test servers page', () => {
    for (const path of [
      '/learn/mcp-client-support-matrix',
      '/learn/mcp-clients-compared',
      '/mcp-test-servers',
      '/learn/connect-mcp-server-to-cursor',
      '/learn/connect-mcp-server-to-vs-code',
      '/learn/connect-mcp-server-to-chatgpt',
      '/learn/add-remote-mcp-server-to-claude',
    ]) expect(hrefs).toContain(path);
  });

  it('is linked from /mcp-test-servers', () => {
    const servers = render(<McpTestServersView />, '/mcp-test-servers');
    expect(Array.from(servers.querySelectorAll('a'), link => link.getAttribute('href'))).toContain('/mcp-test-client');
  });
});
