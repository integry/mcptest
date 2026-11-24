/**
 * Copy for /mcp-server-development (src/components/ServicePageView.tsx), a
 * page only in builds with VITE_SERVICE_PAGE_ENABLED=true. Prices are not
 * here: the page reads them at runtime from the service's public offer
 * (docs/service-offer-contract.md) and falls back to PRICE_FALLBACK. Both
 * states carry ESTIMATE_NOTE: a quote is an estimate until we confirm it.
 * Prices exclude tax, which is added to the invoice where it applies, so both
 * states also carry taxNote(). Payment is by invoice unless the offer says
 * otherwise (`paymentMethod`, see howItWorks()).
 */

import type { PaymentMethod } from '../servicePage/offer';

export const SERVICE_PAGE_COPY = {
  breadcrumb: 'MCP server development',
  heading: 'MCP server development',
  lede: 'We build a tested remote MCP server from your existing, documented API. It is delivered with a passing mcptest report, a listing in the catalog and a badge.',
  pageViewTitle: 'MCP server development',
} as const;

export const WHAT_YOU_GET: readonly string[] = [
  'A remote MCP server (Streamable HTTP) that exposes the API endpoints you choose as MCP tools, with names, descriptions and input schemas written for AI clients.',
  'A passing mcptest report for the delivered server: the same report anyone can run from the Report page.',
  'A listing in the mcptest server catalog and a badge for your README or documentation.',
  'The source code, deployment notes and a list of the tools and the API calls behind each one.',
];

export const BASIC_SCOPE: readonly string[] = [
  'Your API is already documented: an OpenAPI file or a written reference we can work from.',
  'Authentication is an API key that the server sends on every call.',
  'Up to about 10 tools.',
  'One round of revisions after delivery.',
];

export const QUOTED_TIER: readonly { label: string; detail: string }[] = [
  { label: 'OAuth', detail: 'the server signs visitors in with your identity provider instead of using one API key.' },
  { label: 'Per-user accounts', detail: 'each person connects their own account, so the server keeps separate credentials per user.' },
  { label: 'Undocumented APIs', detail: 'we first have to work out the API from its traffic or source code.' },
  { label: 'Write-heavy actions', detail: 'tools that create, change or delete data need confirmation steps and more testing than read-only tools.' },
];

export const SERVICE_OPTIONS: readonly { id: string; title: string; detail: string }[] = [
  { id: 'build-only', title: 'Build only', detail: 'We build and test the server and hand over the code. You host and run it.' },
  { id: 'hosting', title: 'Hosting and maintenance', detail: 'We host the server and keep it passing as the MCP specification and your API change, for a monthly fee.' },
  { id: 'audit-fix', title: 'Audit and fix', detail: 'You already have an MCP server. We run the full report, fix what fails and hand back the changes.' },
];

const BEFORE_PAYMENT: readonly string[] = [
  'Describe your API to the quote assistant: where its documentation is, how it authenticates and what the server should let an AI client do.',
  'Get an estimate of the scope, price and delivery time and, if you want hosting, of the maintenance.',
  'Confirm your email address.',
  'We review the scope and confirm the quote or adjust it.',
];
const PAYMENT_STEPS: Record<PaymentMethod, readonly string[]> = {
  invoice: [
    'Request your invoice from the quote page and give us your billing details.',
    'Pay the invoice (+ tax if applicable). Work starts once the payment is received.',
  ],
  polar: ['You pay once you have the confirmed quote (+ tax if applicable). Work starts after the payment.'],
};
/**
 * The steps for the offer's payment method: by invoice (the default, also in
 * the prerendered HTML) or, when the offer says `"polar"`, online.
 */
export const howItWorks = (paymentMethod: PaymentMethod = 'invoice'): readonly string[] => [
  ...BEFORE_PAYMENT,
  ...PAYMENT_STEPS[paymentMethod],
];
export const HOW_IT_WORKS: readonly string[] = howItWorks();

export const INDEPENDENCE_STATEMENT = 'Validation results, catalog status and badges are produced the same way for every server and are not affected by buying this service. A server we build is tested by the same checks, listed under the same rules and gets the same badge as any other server.';

export const PRICE_FALLBACK = 'Prices depend on your API and the options you choose. Describe your API to the assistant to get an estimate of the price and delivery time.';
/**
 * The short note directly under the prices, with or without the public offer:
 * prices exclude tax, which is added where it applies, and payment is by
 * invoice unless the offer says it is online. The currency is only known once
 * the offer has loaded.
 */
export const taxNote = (currency: string | null, paymentMethod: PaymentMethod = 'invoice'): string => {
  const tax = currency ? `Prices are in ${currency}, + tax if applicable.` : 'Prices exclude tax, + tax if applicable.';
  return paymentMethod === 'invoice' ? `${tax} Payment is by invoice.` : tax;
};
/** The maintenance price, `$39 per month, billed by invoice`. */
export const maintenancePrice = (monthly: string, paymentMethod: PaymentMethod = 'invoice'): string =>
  paymentMethod === 'invoice' ? `${monthly} per month, billed by invoice` : `${monthly} per month`;
/** Shown next to the prices and the quote action, with or without the public offer. */
export const ESTIMATE_NOTE = 'Prices shown and quotes from the assistant are initial estimates. The final price and delivery time may change once the requirements are clarified, and we confirm both with you before any work starts.';
export const ORDERS_CLOSED = 'We are not taking orders right now. The prices above show the usual offer.';
export const QUOTE_ACTION_LABEL = 'Get a quote';
export const QUOTE_LOADING_LABEL = 'Loading the quote assistant';
export const QUOTE_FAILED = 'The quote assistant could not load. Try again, or use the contact page.';
/** Where "Get a quote" goes when this build has no quote assistant. */
export const QUOTE_CONTACT_PATH = '/docs/contact';

/** The link on reports with failing checks (src/components/ReleaseReadinessReport.tsx). */
export const REPORT_HELP_LINK = 'Need help fixing this?';
