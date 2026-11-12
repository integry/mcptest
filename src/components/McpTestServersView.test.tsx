import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import McpTestServersView from './McpTestServersView';
import { PUBLIC_FIXTURES, PUBLIC_FIXTURE_BEARER_TOKEN } from '../data/publicFixtures';
import { CLIENT_SETUPS, CURL_EXAMPLES, MCP_TEST_SERVERS_FAQ } from '../content/mcpTestServersCopy';
import { FIXTURE_SERVERS } from '../../cloudflare-worker/src/fixtureServers.js';

const render = (): HTMLElement => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/mcp-test-servers']}><McpTestServersView /></MemoryRouter>
  );
  return container;
};

const decode = (value: string): string => {
  const element = document.createElement('textarea');
  element.innerHTML = value;
  return element.value;
};

describe('McpTestServersView', () => {
  const page = render();
  const text = page.textContent ?? '';

  it('has one h1 and a section per fixture with its URL, every worker tool and a tester link', () => {
    expect(Array.from(page.querySelectorAll('h1'), heading => heading.textContent)).toEqual(['Public MCP test servers']);
    for (const fixture of PUBLIC_FIXTURES) {
      const section = page.querySelector(`[data-fixture="${fixture.id}"]`)!;
      expect(section, fixture.id).not.toBeNull();
      expect(section.querySelector('.reading-code pre')?.textContent).toBe(fixture.url);
      expect(section.querySelector('.reading-code-copy')).not.toBeNull();
      const tools = Array.from(section.querySelectorAll('li > code:first-child'), code => code.textContent);
      const workerTools = (FIXTURE_SERVERS as Record<string, { tools: { definition: { name: string } }[] }>)[fixture.id]
        .tools.map(tool => tool.definition.name);
      expect(tools).toEqual(workerTools);
      const link = section.querySelector<HTMLAnchorElement>(`a[data-test-fixture="${fixture.id}"]`);
      expect(link?.textContent?.trim()).toBe('Test in mcptest.io');
      expect(link?.getAttribute('href')).toBe(`/server/mcptest.io/fixtures/${fixture.id}/mcp`);
    }
    expect(page.querySelector('[data-fixture="auth-bearer"]')?.textContent).toContain(PUBLIC_FIXTURE_BEARER_TOKEN);
  });

  it('shows every client snippet and curl example with a copy button', () => {
    for (const setup of CLIENT_SETUPS) {
      expect(page.querySelector(`#client-${setup.id}`)?.textContent).toBe(setup.client);
      for (const snippet of setup.snippets) {
        if (snippet.code) expect(text).toContain(snippet.code);
        for (const step of snippet.steps ?? []) expect(text).toContain(step);
      }
    }
    for (const example of CURL_EXAMPLES) expect(text).toContain(example.code);
    const blocks = page.querySelectorAll('.reading-code');
    expect(page.querySelectorAll('.reading-code-copy')).toHaveLength(blocks.length);
    expect(text).toContain('claude mcp add --transport http mcptest-echo https://mcptest.io/fixtures/echo/mcp');
  });

  it('uses the client config formats the connect guides document', () => {
    const json = (id: string, index = 0) => JSON.parse(CLIENT_SETUPS.find(setup => setup.id === id)!.snippets[index].code!);
    expect(json('cursor')).toEqual({ mcpServers: { 'mcptest-echo': { url: 'https://mcptest.io/fixtures/echo/mcp' } } });
    expect(json('vs-code')).toEqual({ servers: { 'mcptest-echo': { type: 'http', url: 'https://mcptest.io/fixtures/echo/mcp' } } });
    expect(json('windsurf')).toEqual({ mcpServers: { 'mcptest-echo': { serverUrl: 'https://mcptest.io/fixtures/echo/mcp' } } });
    expect(json('cursor', 1).mcpServers['mcptest-auth'].headers).toEqual({ Authorization: `Bearer ${PUBLIC_FIXTURE_BEARER_TOKEN}` });
  });

  it('answers every FAQ question on the page', () => {
    const questions = Array.from(page.querySelectorAll('.mcp-test-servers-faq h3'), heading => heading.textContent);
    expect(questions).toEqual(MCP_TEST_SERVERS_FAQ.map(entry => entry.question));
    for (const entry of MCP_TEST_SERVERS_FAQ) expect(decode(page.innerHTML)).toContain(entry.answer);
  });

  it('sends valid JSON-RPC in every curl body', () => {
    for (const example of CURL_EXAMPLES) {
      const bodies = [...example.code.matchAll(/-d '([\s\S]*?)'/g)].map(match => match[1]);
      expect(bodies.length, example.id).toBeGreaterThan(0);
      for (const body of bodies) expect(JSON.parse(body).jsonrpc).toBe('2.0');
    }
  });
});
