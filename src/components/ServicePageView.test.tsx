import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServicePageView from './ServicePageView';
import ReleaseReadinessReport from './ReleaseReadinessReport';
import { ESTIMATE_NOTE, HOW_IT_WORKS, INDEPENDENCE_STATEMENT, ORDERS_CLOSED, PRICE_FALLBACK, REPORT_HELP_LINK, howItWorks, taxNote } from '../content/servicePageCopy';
import { SERVICE_PAGE_OFF, type ServicePageConfig } from '../servicePage/config.mts';
import { parseServiceOffer, type ServiceOffer } from '../servicePage/offer';
import type { QuoteAssistant } from '../servicePage/quoteAssistant';
import type { EvaluationReport } from '../utils/evaluation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OFFER = parseServiceOffer({
  ordersOpen: true,
  currency: 'USD',
  offers: [
    { id: 'basic-build', name: 'MCP server from your API', fromPrice: 49900, deliveryDays: 5 },
    { id: 'audit-fix', name: 'Audit and fix', fromPrice: 75000, deliveryDays: 5 },
  ],
  maintenance: { monthlyPrice: 3900 },
  updatedAt: '2026-11-18T00:00:00Z',
})!;

const WITH_API: ServicePageConfig = { enabled: true, serviceApi: 'https://service.example.com', quoteAssistant: null };
const WITH_ASSISTANT: ServicePageConfig = { ...WITH_API, quoteAssistant: { endpoint: 'https://chat.example.com', assistantKey: 'pk_quote' } };

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const mount = async (props: React.ComponentProps<typeof ServicePageView>): Promise<HTMLElement> => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={['/mcp-server-development']}><ServicePageView {...props} /></MemoryRouter>);
  });
  // Let the offer promise settle.
  await act(async () => {});
  return container;
};

const prices = (page: HTMLElement) => page.querySelector<HTMLElement>('.service-offer')!;
const estimateNote = (page: HTMLElement) => prices(page).querySelector('[data-note="estimate"]')?.textContent;
const taxNoteText = (page: HTMLElement) => prices(page).querySelector('[data-note="tax"]')?.textContent;
const NEUTRAL_TAX_NOTE = 'Prices exclude tax, + tax if applicable. Payment is by invoice.';
const steps = (page: HTMLElement) => Array.from(page.querySelectorAll('#how-it-works + ol li'), step => step.textContent ?? '');
const INVOICE_STEPS = [
  'Request your invoice from the quote page and give us your billing details.',
  'Pay the invoice (+ tax if applicable). Work starts once the payment is received.',
];
const ONLINE_STEP = 'You pay once you have the confirmed quote (+ tax if applicable). Work starts after the payment.';
// Nothing may promise or imply instant online payment or a card checkout.
const ONLINE_PAYMENT = /\bonline\b|\bcard\b|checkout|instant/i;

describe('ServicePageView', () => {
  it('covers the offer, the scope, the options, how it works and the independence statement', () => {
    const page = document.createElement('div');
    page.innerHTML = renderToStaticMarkup(<MemoryRouter><ServicePageView config={WITH_API} /></MemoryRouter>);
    expect(Array.from(page.querySelectorAll('h1'), heading => heading.textContent)).toEqual(['MCP server development']);
    expect(Array.from(page.querySelectorAll('h2'), heading => heading.id)).toEqual(['what-you-get', 'scope', 'options', 'prices', 'how-it-works', 'independence']);
    const text = page.textContent ?? '';
    for (const phrase of ['passing mcptest report', 'catalog', 'badge', 'API key', 'about 10 tools', 'One round of revisions', 'OAuth', 'Per-user accounts', 'Undocumented APIs', 'Write-heavy actions']) {
      expect(text, phrase).toContain(phrase);
    }
    expect(Array.from(page.querySelectorAll('[data-option]'), option => option.getAttribute('data-option'))).toEqual(['build-only', 'hosting', 'audit-fix']);
    // A quote is an estimate we confirm before payment; payment is by invoice, last.
    const listed = steps(page);
    expect(listed).toEqual([...HOW_IT_WORKS]);
    expect(listed).toHaveLength(6);
    expect(listed[0]).toMatch(/^Describe your API to the quote assistant/);
    expect(listed[1]).toMatch(/estimate of the scope, price and delivery time.*maintenance/);
    expect(listed[2]).toMatch(/Confirm your email/);
    expect(listed[3]).toBe('We review the scope and confirm the quote or adjust it.');
    expect(listed.slice(4)).toEqual(INVOICE_STEPS);
    // Tax is mentioned once in the steps, in the paying step.
    expect(listed.filter(step => /tax/i.test(step))).toEqual([listed[5]]);
    expect(listed.slice(0, 4).join(' ')).not.toMatch(/\bpay/i);
    expect(text).not.toMatch(ONLINE_PAYMENT);
    expect(text).toContain(INDEPENDENCE_STATEMENT);
    // The prerendered HTML has no prices, only the neutral copy and the action.
    expect(prices(page).textContent).toContain(PRICE_FALLBACK);
    expect(taxNoteText(page)).toBe(NEUTRAL_TAX_NOTE);
    expect(estimateNote(page)).toBe(ESTIMATE_NOTE);
    expect(prices(page).textContent).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/fixed price/i);
  });

  it('shows the neutral copy and a contact quote link when the service API is unset', async () => {
    const loadOffer = vi.fn();
    const page = await mount({ config: { ...SERVICE_PAGE_OFF, enabled: true }, loadOffer });
    expect(loadOffer).not.toHaveBeenCalled();
    expect(prices(page).dataset.offerState).toBe('unavailable');
    expect(prices(page).textContent).toContain(PRICE_FALLBACK);
    expect(taxNoteText(page)).toBe(NEUTRAL_TAX_NOTE);
    expect(estimateNote(page)).toBe(ESTIMATE_NOTE);
    const quote = prices(page).querySelector('a.btn-primary')!;
    expect(quote.textContent).toBe('Get a quote');
    expect(quote.getAttribute('href')).toBe('/docs/contact');
  });

  it('shows the prices from the public offer', async () => {
    const loadOffer = vi.fn(async () => OFFER);
    const page = await mount({ config: WITH_API, loadOffer });
    expect(loadOffer).toHaveBeenCalledWith('https://service.example.com', expect.any(AbortSignal));
    expect(prices(page).dataset.offerState).toBe('ready');
    const rows = Array.from(prices(page).querySelectorAll('[data-offer]'), row => row.textContent);
    expect(rows).toEqual([
      'MCP server from your APIfrom $499delivery in about 5 days',
      'Audit and fixfrom $750delivery in about 5 days',
      'Hosting and maintenance: $39 per month, billed by invoice.',
    ]);
    expect(prices(page).textContent).not.toContain(PRICE_FALLBACK);
    // One tax note directly under the prices, then the estimate note, then the quote action.
    const tax = prices(page).querySelector('[data-note="tax"]')!;
    expect(tax.textContent).toBe('Prices are in USD, + tax if applicable. Payment is by invoice.');
    expect(prices(page).querySelectorAll('[data-note="tax"]')).toHaveLength(1);
    expect(prices(page).querySelector('[data-offer="maintenance"]')!.nextElementSibling).toBe(tax);
    const note = prices(page).querySelector('[data-note="estimate"]')!;
    expect(note.textContent).toBe(ESTIMATE_NOTE);
    expect(tax.nextElementSibling).toBe(note);
    const quote = prices(page).querySelector('.btn-primary')!;
    expect(quote.textContent).toBe('Get a quote');
    expect(prices(page).querySelector('.service-offer-list')!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(steps(page).slice(4)).toEqual(INVOICE_STEPS);
    expect(page.textContent).not.toMatch(ONLINE_PAYMENT);
  });

  it.each([
    ['"invoice"', 'invoice'],
    ['an unknown value', 'card'],
  ])('uses the invoice wording when paymentMethod is %s', async (_label, paymentMethod) => {
    const offer = parseServiceOffer({ ordersOpen: true, currency: 'USD', offers: [{ id: 'basic-build', name: 'Build', fromPrice: 49900 }], maintenance: { monthlyPrice: 3900 }, paymentMethod })!;
    expect(offer.paymentMethod).toBe('invoice');
    const page = await mount({ config: WITH_API, loadOffer: async () => offer });
    expect(steps(page)).toEqual([...HOW_IT_WORKS]);
    expect(taxNoteText(page)).toBe('Prices are in USD, + tax if applicable. Payment is by invoice.');
    expect(prices(page).querySelector('[data-offer="maintenance"]')?.textContent).toBe('Hosting and maintenance: $39 per month, billed by invoice.');
  });

  it('uses the online paying step when paymentMethod is "polar"', async () => {
    const page = await mount({ config: WITH_API, loadOffer: async () => ({ ...OFFER, paymentMethod: 'polar' }) });
    const listed = steps(page);
    expect(listed).toEqual([...howItWorks('polar')]);
    expect(listed.slice(0, 4)).toEqual(HOW_IT_WORKS.slice(0, 4));
    expect(listed.slice(4)).toEqual([ONLINE_STEP]);
    expect(taxNoteText(page)).toBe('Prices are in USD, + tax if applicable.');
    expect(prices(page).querySelector('[data-offer="maintenance"]')?.textContent).toBe('Hosting and maintenance: $39 per month.');
    expect(page.textContent).not.toMatch(/invoice/i);
  });

  it('renders whatever offers are listed, without maintenance when it is null', async () => {
    const offer: ServiceOffer = { ...OFFER, offers: [OFFER.offers[1]], maintenanceMonthlyPrice: null };
    const page = await mount({ config: WITH_API, loadOffer: async () => offer });
    expect(Array.from(prices(page).querySelectorAll('[data-offer]'), row => row.getAttribute('data-offer'))).toEqual(['audit-fix']);
    expect(prices(page).textContent).not.toContain('Hosting and maintenance');
    expect(prices(page).querySelector('.service-offer-list')!.nextElementSibling?.textContent).toBe('Prices are in USD, + tax if applicable. Payment is by invoice.');
  });

  it('names the offer currency in the tax note', () => {
    expect(taxNote('EUR')).toBe('Prices are in EUR, + tax if applicable. Payment is by invoice.');
    expect(taxNote('EUR', 'polar')).toBe('Prices are in EUR, + tax if applicable.');
    expect(taxNote(null)).toBe(NEUTRAL_TAX_NOTE);
  });

  it.each([
    ['the request fails', async () => { throw new Error('network'); }],
    ['the response is outside the contract', async () => null],
  ])('falls back to the neutral copy when %s', async (_label, loadOffer) => {
    const page = await mount({ config: WITH_API, loadOffer });
    expect(prices(page).dataset.offerState).toBe('unavailable');
    expect(prices(page).textContent).toContain(PRICE_FALLBACK);
    expect(taxNoteText(page)).toBe(NEUTRAL_TAX_NOTE);
    expect(estimateNote(page)).toBe(ESTIMATE_NOTE);
    expect(prices(page).querySelector('.btn-primary')?.textContent).toBe('Get a quote');
  });

  it('replaces the quote action with a note when orders are closed', async () => {
    const page = await mount({ config: WITH_ASSISTANT, loadOffer: async () => ({ ...OFFER, ordersOpen: false }) });
    expect(prices(page).textContent).toContain('from $499');
    expect(prices(page).querySelector('.service-orders-closed')?.textContent).toBe(ORDERS_CLOSED);
    expect(taxNoteText(page)).toBe(taxNote('USD'));
    expect(estimateNote(page)).toBe(ESTIMATE_NOTE);
    expect(prices(page).querySelector('.btn-primary')).toBeNull();
  });

  it('opens the quote assistant on "Get a quote" and removes it on leaving', async () => {
    const assistant: QuoteAssistant = { open: vi.fn(async () => true), destroy: vi.fn() };
    const createAssistant = vi.fn(() => assistant);
    const page = await mount({ config: WITH_ASSISTANT, loadOffer: async () => OFFER, createAssistant });
    // Nothing is created (or fetched from solv.chat) before the press.
    expect(createAssistant).not.toHaveBeenCalled();
    const button = prices(page).querySelector<HTMLButtonElement>('button.btn-primary')!;
    await act(async () => button.click());
    expect(createAssistant).toHaveBeenCalledWith(WITH_ASSISTANT.quoteAssistant, 'https://service.example.com');
    expect(assistant.open).toHaveBeenCalledOnce();
    act(() => root?.unmount());
    root = null;
    expect(assistant.destroy).toHaveBeenCalledOnce();
  });

  it('says so when the quote assistant cannot load', async () => {
    const assistant: QuoteAssistant = { open: vi.fn(async () => false), destroy: vi.fn() };
    const page = await mount({ config: WITH_ASSISTANT, loadOffer: async () => OFFER, createAssistant: () => assistant });
    await act(async () => prices(page).querySelector<HTMLButtonElement>('button.btn-primary')!.click());
    expect(prices(page).querySelector('[role="alert"]')?.textContent).toContain('could not load');
    expect(prices(page).querySelector('[role="alert"] a')?.getAttribute('href')).toBe('/docs/contact');
  });
});

describe('the report link to the service page', () => {
  const failed: EvaluationReport = { serverUrl: 'https://broken.example/mcp', outcome: 'failed', finalScore: 0, sections: {} };
  const authorization: EvaluationReport = {
    serverUrl: 'https://oauth.example/mcp',
    outcome: 'authorization-required',
    finalScore: 0,
    sections: { auth: { name: 'Authorization required', description: 'OAuth', score: 0, maxScore: 0, details: [{ text: '⚠ OAuth authorization required' }] } },
  };
  const render = (report: EvaluationReport, showServiceLink?: boolean) => {
    const page = document.createElement('div');
    page.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <ReleaseReadinessReport report={report} expandedItems={new Set()} onToggleItem={() => {}} showServiceLink={showServiceLink} />
      </MemoryRouter>,
    );
    return Array.from(page.querySelectorAll('a'), link => [link.textContent, link.getAttribute('href')]);
  };

  it('is one link on a report with failing checks', () => {
    expect(render(failed, true).filter(([text]) => text === REPORT_HELP_LINK)).toEqual([[REPORT_HELP_LINK, '/mcp-server-development']]);
  });

  it('is absent without failing checks and when the build has no service page', () => {
    expect(render(authorization, true).some(([, href]) => href === '/mcp-server-development')).toBe(false);
    expect(render(failed).some(([, href]) => href === '/mcp-server-development')).toBe(false);
    expect(render(failed, false).some(([text]) => text === REPORT_HELP_LINK)).toBe(false);
  });
});
