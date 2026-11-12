import { describe, expect, it } from 'vitest';
import {
  FIXTURE_NAMES,
  FIXTURE_SERVERS,
  MAX_DELAY_MS,
  PUBLIC_BEARER_TOKEN,
} from '../../cloudflare-worker/src/fixtureServers.js';
import {
  FIXTURE_PATH,
  LEGACY_PROTOCOL_VERSIONS,
  MAX_FIXTURE_BODY_BYTES,
  MODERN_PROTOCOL_VERSION,
} from '../../cloudflare-worker/src/fixtures.js';
import {
  LANDING_FIXTURE,
  PUBLIC_FIXTURES,
  PUBLIC_FIXTURE_BEARER_TOKEN,
  PUBLIC_FIXTURE_MAX_BODY_BYTES,
  PUBLIC_FIXTURE_MAX_DELAY_MS,
  PUBLIC_FIXTURE_ORIGIN,
  PUBLIC_FIXTURE_STATEFUL_VERSIONS,
  PUBLIC_FIXTURE_STATELESS_VERSION,
} from './publicFixtures';

type WorkerFixture = {
  name: string;
  tools: { definition: { name: string } }[];
  resources: { definition: { uri: string }; text?: string }[];
  prompts: { definition: { name: string } }[];
  auth?: { type: string; token: string };
};
const workerFixtures = FIXTURE_SERVERS as Record<string, WorkerFixture>;

/**
 * The /mcp-test-servers page, the landing preset and llms.txt describe the
 * worker's fixtures from src/data/publicFixtures.ts. These checks keep that
 * description identical to what the worker actually serves.
 */
describe('public fixture metadata matches the worker', () => {
  it('lists every worker fixture once, in the worker order', () => {
    expect(PUBLIC_FIXTURES.map(fixture => fixture.id)).toEqual([...FIXTURE_NAMES]);
  });

  it.each(PUBLIC_FIXTURES.map(fixture => [fixture.id, fixture] as const))('%s: URL, tools, resources, prompts and auth', (id, fixture) => {
    const worker = workerFixtures[id];
    const url = new URL(fixture.url);
    expect(url.origin).toBe(PUBLIC_FIXTURE_ORIGIN);
    expect(FIXTURE_PATH.exec(url.pathname)?.[1]).toBe(id);
    expect(fixture.tools.map(tool => tool.name)).toEqual(worker.tools.map(tool => tool.definition.name));
    expect(fixture.resources).toEqual(worker.resources.map(resource => resource.definition.uri));
    expect(fixture.prompts).toEqual(worker.prompts.map(prompt => prompt.definition.name));
    expect(fixture.auth).toEqual(worker.auth);
  });

  it('every documented URL is the one the worker README resource advertises', () => {
    const readme = workerFixtures.echo.resources[0].text ?? '';
    for (const fixture of PUBLIC_FIXTURES) expect(readme).toContain(fixture.url);
  });

  it('matches the worker limits, token and protocol versions', () => {
    expect(PUBLIC_FIXTURE_BEARER_TOKEN).toBe(PUBLIC_BEARER_TOKEN);
    expect(PUBLIC_FIXTURE_MAX_DELAY_MS).toBe(MAX_DELAY_MS);
    expect(PUBLIC_FIXTURE_MAX_BODY_BYTES).toBe(MAX_FIXTURE_BODY_BYTES);
    expect(PUBLIC_FIXTURE_STATELESS_VERSION).toBe(MODERN_PROTOCOL_VERSION);
    expect([...PUBLIC_FIXTURE_STATEFUL_VERSIONS]).toEqual(LEGACY_PROTOCOL_VERSIONS);
  });

  it('the landing preset is the no-auth echo fixture', () => {
    const echo = PUBLIC_FIXTURES.find(fixture => fixture.id === 'echo');
    expect(LANDING_FIXTURE.url).toBe(echo?.url);
    expect(workerFixtures.echo.auth).toBeUndefined();
  });
});
