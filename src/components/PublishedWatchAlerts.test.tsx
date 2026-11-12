import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import PublishedWatchAlerts from './PublishedWatchAlerts';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });
it('labels the destination, associates errors, detects kind, and shows the signing secret only after setup', async () => {
  vi.stubEnv('VITE_CLOUDFLARE_WORKER_URL', 'https://worker.test');
  const fetchImpl = vi.fn(async (_url, init) => {
    if (init.method === 'GET') return Response.json({ alert: null });
    if (JSON.parse(init.body).url.includes('bad')) return Response.json({ message: 'Use a public HTTPS URL.' }, { status: 400 });
    return Response.json({ alert: { kind: 'webhook', host: 'receiver.acme.com', enabled: true, failures: 0, lastDelivery: null }, signingSecret: 'secret-shown-once' });
  });
  vi.stubGlobal('fetch', fetchImpl);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  cleanup = () => { act(() => root.unmount()); container.remove(); vi.unstubAllEnvs(); };
  await act(async () => root.render(<PublishedWatchAlerts id="owner" token="token" enabled />));
  const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
  expect(container.querySelector('label')?.htmlFor).toBe(input.id);
  const change = async (url: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, url);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await change('https://hooks.slack.com/services/A/B/secret');
  expect(container.textContent).toContain('Detected: Slack');
  await change('https://bad.local/hook');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(input.getAttribute('aria-invalid')).toBe('true');
  const error = container.querySelector('[role="alert"]')!;
  expect(input.getAttribute('aria-describedby')).toContain(error.id);
  await change('https://receiver.acme.com/hook');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(input.value).toBe('');
  expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('secret-shown-once');
  expect(container.textContent).toContain('Send test alert');
  expect(fetchImpl.mock.calls[1][1].headers['X-Removal-Token']).toBe('token');
});
