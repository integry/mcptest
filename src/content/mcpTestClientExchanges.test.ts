// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFixtureSessionId, handleFixtureRequest } from '../../cloudflare-worker/src/fixtures.js';
import { CLIENT_CHECKLISTS } from './mcpTestClientChecklist';
import { SELF_CHECK_EXCHANGES } from './mcpTestClientCopy';
import {
  BASE_REQUEST_HEADERS,
  ISSUED_SESSION_ID,
  SESSION_ID_PLACEHOLDER,
  exchangeContentType,
  formatEventStream,
  formatExchangeRequest,
  formatExchangeResponse,
  type HttpExchange,
} from './mcpTestClientExchanges';
import { PUBLIC_FIXTURES } from '../data/publicFixtures';

const ISSUED_SESSION_PATTERN = /^mcptest-fx-[0-9a-f]{32}\.[0-9a-f]{16}$/;
// Response headers the page either lists or must not leave out.
const PROTOCOL_HEADERS = ['mcp-protocol-version', 'mcp-session-id', 'www-authenticate'];

const allExchanges: HttpExchange[] = [
  ...CLIENT_CHECKLISTS.flatMap(checklist => checklist.items.flatMap(item => item.exchanges)),
  ...SELF_CHECK_EXCHANGES,
];

/** Sends the documented request to the worker's fixture handler, as a client would over HTTP. */
const replay = async (exchange: HttpExchange): Promise<Response> => {
  const session = await createFixtureSessionId(exchange.fixture);
  const requestHeaders: Record<string, string> = { ...BASE_REQUEST_HEADERS, ...exchange.request.headers };
  const headers = Object.fromEntries(Object.entries(requestHeaders)
    .map(([name, value]) => [name, value === SESSION_ID_PLACEHOLDER ? session : value]));
  const request = new Request(`https://mcptest.io/fixtures/${exchange.fixture}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(exchange.request.body),
  });
  const response = await handleFixtureRequest(request, { wait: () => Promise.resolve() });
  if (!response) throw new Error(`${exchange.id}: the fixture handler did not answer`);
  return response;
};

/**
 * Every request/response pair on /mcp-test-client is what the worker really
 * sends: these replay each documented request through
 * cloudflare-worker/src/fixtures.js and compare status, headers and body.
 */
describe('/mcp-test-client exchanges match the fixture responses', () => {
  it('has unique ids and only targets real fixtures', () => {
    const ids = allExchanges.map(exchange => exchange.id);
    expect(new Set(ids).size).toBe(ids.length);
    const fixtures = new Set(PUBLIC_FIXTURES.map(fixture => fixture.id));
    for (const exchange of allExchanges) expect(fixtures.has(exchange.fixture), exchange.id).toBe(true);
    // Every checklist covers its fixture only.
    for (const checklist of CLIENT_CHECKLISTS) {
      for (const item of checklist.items) for (const exchange of item.exchanges) expect(exchange.fixture).toBe(checklist.fixture);
    }
  });

  it.each(allExchanges.map(exchange => [exchange.id, exchange] as const))('%s', async (_id, exchange) => {
    const response = await replay(exchange);
    const expected = exchange.response;
    expect(response.status).toBe(expected.status);

    const contentType = exchangeContentType(expected);
    if (contentType) expect(response.headers.get('content-type')).toBe(contentType);
    else expect(response.headers.get('content-type')).toBeNull();

    const listed = Object.fromEntries(Object.entries(expected.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    for (const name of PROTOCOL_HEADERS) {
      const actual = response.headers.get(name);
      if (!(name in listed)) {
        expect(actual, `${name} is sent but not shown`).toBeNull();
      } else if (listed[name] === ISSUED_SESSION_ID) {
        expect(actual).toMatch(ISSUED_SESSION_PATTERN);
      } else {
        expect(actual).toBe(listed[name]);
      }
    }
    for (const name of Object.keys(listed)) expect(PROTOCOL_HEADERS, name).toContain(name);

    const text = await response.text();
    if (expected.events) {
      expect(text.trimEnd()).toBe(formatEventStream(expected.events));
    } else if (expected.body === undefined) {
      expect(text).toBe('');
    } else if (exchange.abbreviated) {
      expect(JSON.parse(text)).toMatchObject(expected.body as object);
    } else {
      expect(JSON.parse(text)).toEqual(expected.body);
    }
  });

  it('formats requests and responses as HTTP messages', () => {
    const [initialize] = CLIENT_CHECKLISTS[0].items[0].exchanges;
    const request = formatExchangeRequest(initialize);
    expect(request.split('\n').slice(0, 4)).toEqual([
      'POST /fixtures/echo/mcp HTTP/1.1',
      'Host: mcptest.io',
      'Content-Type: application/json',
      'Accept: application/json, text/event-stream',
    ]);
    expect(JSON.parse(request.slice(request.indexOf('\n\n') + 2))).toEqual(initialize.request.body);
    const response = formatExchangeResponse(initialize);
    expect(response.split('\n').slice(0, 4)).toEqual([
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      'MCP-Protocol-Version: 2025-11-25',
      `Mcp-Session-Id: ${ISSUED_SESSION_ID}`,
    ]);
    expect(formatExchangeResponse(CLIENT_CHECKLISTS[0].items[0].exchanges[1])).toBe('HTTP/1.1 202 Accepted');
  });
});
