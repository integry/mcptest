import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import SubmitServerView from './SubmitServerView';
import type { CatalogSubmissionEvidence } from '../utils/catalogSubmission';

const ENDPOINT = 'https://mcp.acme-weather.dev/mcp';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const evidenceFor = (url: string, overrides: Partial<CatalogSubmissionEvidence> = {}): CatalogSubmissionEvidence => ({
  checkedAt: '2026-10-20T10:00:00.000Z',
  endpointUrl: url,
  outcome: 'mcp',
  validatedUrl: url,
  transport: 'streamable-http',
  protocolVersion: '2025-06-18',
  protocolEra: 'stateless',
  authChallenge: 'none',
  browserAccess: 'direct',
  toolCount: 4,
  detail: 'Negotiated stateless MCP.',
  ...overrides,
});

const render = (props: Partial<React.ComponentProps<typeof SubmitServerView>> = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const probe = vi.fn(async (url: string) => evidenceFor(url));
  root = createRoot(container);
  act(() => root!.render(<SubmitServerView probe={probe} submitUrl="/api/catalog/submissions" turnstileSiteKey="" {...props} />));
  return { container, probe };
};

const byLabel = <T extends HTMLElement>(container: HTMLElement, label: string): T => {
  const element = Array.from(container.querySelectorAll('label')).find((candidate) => candidate.textContent?.startsWith(label));
  if (!element) throw new Error(`No label ${label}`);
  return container.ownerDocument.getElementById(element.htmlFor) as T;
};

const type = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};

const button = (container: HTMLElement, text: string) => Array.from(container.querySelectorAll('button'))
  .find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement;

const check = async (container: HTMLElement) => {
  await act(async () => { button(container, 'Check endpoint').click(); });
};

const fillListing = (container: HTMLElement) => {
  type(byLabel(container, 'Display name'), 'Acme Weather');
  type(byLabel(container, 'Category'), 'Search');
  type(byLabel(container, 'Description'), 'Read-only forecasts and alerts for any coordinates. No authentication.');
  type(byLabel(container, 'Homepage URL'), 'https://acme-weather.dev');
  act(() => byLabel<HTMLInputElement>(container, 'No logo').click());
  type(byLabel(container, 'Contact email'), 'owner@acme-weather.dev');
  act(() => byLabel<HTMLInputElement>(container, 'I am authorized').click());
};

describe('SubmitServerView', () => {
  it('prefills the endpoint from the playground connection', () => {
    const { container } = render({ initialUrl: ENDPOINT });
    expect(byLabel<HTMLInputElement>(container, 'Endpoint URL').value).toBe(ENDPOINT);
  });

  it('keeps submit disabled until a check on the current URL succeeds', async () => {
    const { container, probe } = render({ initialUrl: ENDPOINT });
    const submit = button(container, 'Submit for review');
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('Run the endpoint check before submitting.');

    await check(container);
    expect(probe).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(submit.disabled).toBe(false);
    const evidence = container.querySelector('[data-testid="submission-evidence"]')!;
    for (const term of ['Reachable', 'Transport', 'Protocol version', 'Auth challenge', 'Browser CORS', 'Tools without credentials']) {
      expect(evidence.textContent).toContain(term);
    }
    expect(evidence.textContent).toContain('Streamable HTTP');
    expect(evidence.textContent).toContain('2025-06-18 (stateless)');
    expect(evidence.textContent).toContain('Readable directly from the browser');

    type(byLabel(container, 'Endpoint URL'), 'https://mcp.acme-weather.dev/sse');
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('The endpoint URL changed after the check.');
  });

  it('enables submit for a recognized auth challenge but not for an unreachable endpoint', async () => {
    const challenge = render({
      initialUrl: ENDPOINT,
      probe: vi.fn(async (url: string) => evidenceFor(url, {
        outcome: 'auth-challenge', authChallenge: 'oauth', authStatus: 401, transport: undefined, toolCount: undefined,
      })),
    });
    await check(challenge.container);
    expect(button(challenge.container, 'Submit for review').disabled).toBe(false);
    expect(challenge.container.textContent).toContain('OAuth (protected resource metadata)');
    expect(challenge.container.textContent).toContain('Listed after authorization');
    act(() => root?.unmount());

    const unreachable = render({
      initialUrl: ENDPOINT,
      probe: vi.fn(async (url: string) => evidenceFor(url, { outcome: 'unreachable', transport: undefined, browserAccess: 'unknown' })),
    });
    await check(unreachable.container);
    expect(button(unreachable.container, 'Submit for review').disabled).toBe(true);
    expect(unreachable.container.textContent).toContain('Not submittable yet');
  });

  it('refuses to check an endpoint with credentials or a private host', async () => {
    const { container, probe } = render();
    type(byLabel(container, 'Endpoint URL'), 'https://user:pass@mcp.acme-weather.dev/mcp');
    await check(container);
    expect(probe).not.toHaveBeenCalled();
    expect(container.textContent).toContain('must not contain credentials');

    type(byLabel(container, 'Endpoint URL'), 'https://localhost:8080/mcp');
    await check(container);
    expect(probe).not.toHaveBeenCalled();
    expect(container.textContent).toContain('public host name');
  });

  it('shows field errors and does not post an incomplete listing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render({ initialUrl: ENDPOINT });
    await check(container);
    await act(async () => { button(container, 'Submit for review').click(); });

    expect(fetchMock).not.toHaveBeenCalled();
    for (const message of ['Display name is required.', 'Choose a category.', 'Choose a logo license statement.', 'Confirm that you are authorized']) {
      expect(container.textContent).toContain(message);
    }
    expect(byLabel(container, 'Display name').getAttribute('aria-invalid')).toBe('true');
  });

  it('asks for a logo URL only for a licensed logo', () => {
    const { container } = render();
    expect(container.textContent).not.toContain('Logo URL');
    act(() => byLabel<HTMLInputElement>(container, 'From Simple Icons').click());
    expect(byLabel<HTMLInputElement>(container, 'Logo URL').placeholder).toContain('simple-icons');
  });

  it('posts the listing with the probe evidence and shows the submission id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      submissionId: '6f1c2a9e-4b7d-4c1e-9a53-2f8e0d4b7c11',
      proposedCatalogId: 'acme-weather',
      status: 'queued',
      nextStep: 'A GitHub Actions workflow opens a pull request on submissions/acme-weather.',
      docsUrl: 'https://github.com/integry/mcptest/blob/master/docs/catalog-submissions.md',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render({ initialUrl: ENDPOINT });
    await check(container);
    fillListing(container);
    await act(async () => { button(container, 'Submit for review').click(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/catalog/submissions');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      url: ENDPOINT,
      name: 'Acme Weather',
      category: 'Search',
      logoLicense: 'none',
      contactEmail: 'owner@acme-weather.dev',
      authorized: true,
      evidence: { endpointUrl: ENDPOINT, outcome: 'mcp', toolCount: 4 },
    });
    expect(body).not.toHaveProperty('logoUrl');

    expect(container.textContent).toContain('Submission received');
    expect(container.textContent).toContain('6f1c2a9e-4b7d-4c1e-9a53-2f8e0d4b7c11');
    const docs = Array.from(container.querySelectorAll('a')).find((link) => link.textContent?.includes('What happens next'));
    expect(docs?.getAttribute('href')).toContain('docs/catalog-submissions.md');
  });

  it('shows the Worker error, including a link to an existing listing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'already_listed',
      message: 'This endpoint is already listed as Acme Weather.',
      catalogId: 'acme-weather',
    }), { status: 409 })));
    const { container } = render({ initialUrl: ENDPOINT });
    await check(container);
    fillListing(container);
    await act(async () => { button(container, 'Submit for review').click(); });

    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('already listed as Acme Weather');
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/servers/acme-weather');
    expect(button(container, 'Submit for review').disabled).toBe(false);
  });

  it('points out an endpoint that the bundled catalog already lists', () => {
    const { container } = render({ initialUrl: 'https://mcp.context7.com/mcp' });
    expect(container.textContent).toContain('already listed as');
    expect(container.querySelector('a[href="/servers/context7"]')).not.toBeNull();
  });
});
