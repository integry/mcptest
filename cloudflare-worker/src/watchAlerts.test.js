import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { validateAlertDestination, renderAlert, signAlert, deliverAlert } from './watchAlerts.js';
import { PublishedReports } from './PublishedReports.js';

const URL_SECRET = 'https://receiver.acme.com/private-hook?key=never-return-this';
const entry = { severity: 'breaking', summary: '1 breaking', observedAt: '2026-10-25T00:00:00.000Z', counts: { breaking: 1, risky: 0, safe: 0 }, findings: [{ severity: 'breaking', subject: '@everyone', title: 'Tool removed' }] };
const data = { endpoint: 'https://server.acme.com/mcp', entry, feedUrl: 'https://mcptest.io/feed' };
function object() {
  const map = new Map([
    ['index', [{ id: 'owner', removalTokenHash: 'hash' }]],
    ['watch:config', { enabled: true, endpoint: data.endpoint }],
  ]);
  const storage = {
    get: async (key) => map.get(key),
    put: async (key, value) => { map.set(key, structuredClone(value)); },
    delete: async (key) => map.delete(key),
  };
  return { obj: new PublishedReports({ storage }), map };
}
const setup = (obj) => obj.ownerAlerts({ method: 'POST' }, { id: 'owner', removalTokenHash: 'hash', url: URL_SECRET });

describe('watch alert destinations', () => {
  it.each([
    'http://receiver.acme.com/a', 'https://user:pass@receiver.acme.com/a', 'https://@receiver.acme.com/a',
    'https://receiver.acme.com:444/a', 'https://localhost/a', 'https://127.0.0.1/a',
    'https://10.0.0.1/a', 'https://192.168.1.1/a', 'https://169.254.169.254/a',
    'https://[::1]/a', 'https://[fc00::1]/a', 'https://[fe80::1]/a', 'https://[::ffff:127.0.0.1]/a',
    'https://2130706433/a', 'https://0x7f000001/a', 'https://host.local./a',
    'https://host.internal/a', 'https://receiver.acme.com/a#fragment',
    'https://hooks.slack.com/wrong', 'https://discord.com/api/webhooks/bad',
    `https://receiver.acme.com/${'a'.repeat(2048)}`,
  ])('rejects %s', (url) => expect(validateAlertDestination(url)).toBeUndefined());
  it('detects providers and accepts only the default HTTPS port', () => {
    expect(validateAlertDestination('https://hooks.slack.com/services/A/B/secret')).toMatchObject({ kind: 'slack' });
    for (const host of ['discord.com', 'discordapp.com']) expect(validateAlertDestination(`https://${host}/api/webhooks/123/secret`)).toMatchObject({ kind: 'discord' });
    expect(validateAlertDestination('https://receiver.acme.com:443/hook')).toMatchObject({ kind: 'webhook' });
  });
});
describe('payloads and delivery', () => {
  it('renders generic JSON and links', () => {
    expect(renderAlert('webhook', data)).toMatchObject({ event: 'watch.breaking', classifiedAt: entry.observedAt, counts: entry.counts, topFindings: entry.findings, reportUrl: expect.stringContaining('https://mcptest.io/report/'), guideUrl: expect.stringContaining('/learn/'), feedUrl: data.feedUrl });
    expect(renderAlert('webhook', { ...data, test: true }).event).toBe('watch.test');
  });
  it('renders Slack blocks with plain text and Discord embeds without mentions', () => {
    const slack = renderAlert('slack', data);
    expect(slack.blocks[0].text).toMatchObject({ type: 'plain_text', text: expect.stringContaining('Tool removed') });
    expect(slack.blocks[1].elements).toHaveLength(2);
    expect(renderAlert('discord', data)).toMatchObject({ allowed_mentions: { parse: [] }, embeds: [{ description: expect.stringContaining('Tool removed'), url: expect.stringContaining('/report/'), timestamp: entry.observedAt, title: expect.any(String), fields: expect.any(Array) }] });
  });
  it('signs the exact body using HMAC-SHA256 and retries at most once', async () => {
    const secret = 'abcd';
    const payload = renderAlert('webhook', data);
    const expected = `sha256=${createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')}`;
    expect(await signAlert(secret, JSON.stringify(payload))).toBe(expected);
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error(URL_SECRET)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await deliverAlert({ url: URL_SECRET, kind: 'webhook', secret }, payload, { fetchImpl, now: 1 })).toMatchObject({ status: 'ok', httpStatus: 204 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { 'X-Mcptest-Signature': expected }, body: JSON.stringify(payload), signal: expect.any(AbortSignal) });
  });
  it('records HTTP failures without response bodies or thrown URLs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(URL_SECRET, { status: 302 }));
    expect(await deliverAlert({ url: URL_SECRET, kind: 'slack' }, {}, { fetchImpl })).toMatchObject({ status: 'failed', httpStatus: 302 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('limits per run and day, permits changed classification, and disables after five failures', async () => {
    const { obj, map } = object();
    await setup(obj);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const now = Date.parse(entry.observedAt);
      await obj.sendAlert({ entry, now });
      await obj.sendAlert({ entry: { ...entry, severity: 'risky' }, now });
      await obj.sendAlert({ entry, now: now + 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await obj.sendAlert({ entry: { ...entry, severity: 'risky' }, now: now + 2 });
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      for (let day = 1; day <= 4; day++) await obj.sendAlert({ entry, now: now + day * 86400000 });
      expect(fetchImpl).toHaveBeenCalledTimes(10);
      expect(map.get('watch:alert-destination')).toMatchObject({ enabled: false, failures: 5, lastDelivery: { status: 'failed', httpStatus: 503 } });
    } finally { vi.unstubAllGlobals(); }
  });
  it('resets consecutive failures after success and ignores safe changes', async () => {
    const { obj, map } = object(); await setup(obj);
    map.get('watch:alert-destination').failures = 4;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetchImpl);
    try {
      await obj.sendAlert({ entry: { ...entry, severity: 'safe' }, now: 1 });
      expect(fetchImpl).not.toHaveBeenCalled();
      await obj.sendAlert({ entry, now: 2 });
      expect(map.get('watch:alert-destination')).toMatchObject({ enabled: true, failures: 0 });
    } finally { vi.unstubAllGlobals(); }
  });
  it('returns secret once and never returns the destination URL', async () => {
    const { obj } = object();
    const first = await (await setup(obj)).json();
    expect(first.signingSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain(URL_SECRET);
    const status = await (await obj.ownerAlerts({ method: 'GET' }, { id: 'owner', removalTokenHash: 'hash' })).json();
    expect(status).toEqual({ alert: { kind: 'webhook', host: 'receiver.acme.com', enabled: true, failures: 0, lastDelivery: null } });
    expect(JSON.stringify(status)).not.toContain(first.signingSecret);
    expect(await (await obj.fetch(new Request('https://internal/watch'))).text()).not.toContain(URL_SECRET);
    expect(await (await obj.fetch(new Request('https://internal/snapshots'))).text()).not.toContain(URL_SECRET);
  });
});

it('hands off delivery without blocking the cron response', async () => {
  const background = [];
  const obj = new PublishedReports({ storage: {}, waitUntil: (promise) => background.push(promise) });
  let finish;
  obj.sendAlert = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const response = await obj.fetch(new Request('https://internal/watch/alert', {
    method: 'POST', body: JSON.stringify({ entry, now: 1 }),
  }));
  expect(await response.json()).toEqual({ accepted: true });
  expect(background).toHaveLength(1);
  finish();
  await background[0];
});
