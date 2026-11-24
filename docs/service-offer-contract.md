# Service offer contract

The MCP server development page (`/mcp-server-development`, issue #638) reads
its prices from the private admin service at runtime. This is the contract that
service implements. The page's parser is `parseServiceOffer` in
`src/servicePage/offer.ts`.

## Prices and quotes are estimates

The "from" prices in the offer and every quote from the quote assistant are
initial estimates, not final prices. The flow is: the visitor describes their
API to the assistant, gets an estimate of scope, price, delivery and
maintenance, and confirms their email address. An operator then reviews the
scope and confirms the quote or adjusts it, and only a confirmed quote can be
paid. For the launch, payment is by invoice: the visitor requests an invoice
from the quote page with their billing details and pays it, and work starts
once the payment is received (see `paymentMethod` below). The page says so next to the prices and the quote action, both with the
offer and with the neutral fallback copy. This does not change the JSON shape
below; the page's prices still come only from this endpoint.

## Build variables

| Variable | Effect |
| --- | --- |
| `VITE_SERVICE_PAGE_ENABLED` | `true` adds the page: its route, the footer link, `routes.txt`, `sitemap.xml`, page metadata, its Open Graph card and the "Need help fixing this?" link on reports with failing checks. Any other value (or unset): none of them exist and the build is unchanged. |
| `VITE_SERVICE_API` | The admin service's base URL, `https` only, no query or credentials (for example `https://service.example.com`). Its origin is added to `connect-src`. Unset or invalid: the page shows neutral price copy. |
| `VITE_SOLV_QUOTE_ASSISTANT_KEY` | The public key of a second solv.chat assistant, on the same `VITE_SOLV_ENDPOINT` as the site assistant. Shown only on this page; the endpoint is added to `script-src` and `connect-src`. Unset: "Get a quote" links to the contact page. |

The CSP additions go through the same helper as the site assistant
(`extendCsp` in `src/siteAssistant/config.mts`) and only when the page is
enabled and the variable is set.

## `GET ${VITE_SERVICE_API}/public/offer`

The page sends a plain `GET` with `Accept: application/json` and no cookies
(`credentials: 'omit'`). The response must allow the site origin with CORS
(`Access-Control-Allow-Origin: https://mcptest.io`, or the origin of the
deployment). It should be cacheable for a short time; the page fetches it on
every visit.

```json
{
  "ordersOpen": true,
  "currency": "USD",
  "offers": [
    { "id": "basic-build", "name": "MCP server from your API", "fromPrice": 49900, "deliveryDays": 5 },
    { "id": "audit-fix", "name": "Audit and fix", "fromPrice": 75000, "deliveryDays": 5 }
  ],
  "maintenance": { "monthlyPrice": 3900 },
  "updatedAt": "2026-11-18T00:00:00Z"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ordersOpen` | boolean, required | `false`: the page still shows the offer but replaces the quote action with a "not taking orders right now" note. |
| `currency` | string, required | ISO 4217 code. Every price is in its minor units. |
| `offers` | array, required | Rendered in order. Offers may be added or removed; the page renders whatever is listed. |
| `offers[].id` | string, required | Stable id (also used for quote pages). |
| `offers[].name` | string, required | Shown as is. |
| `offers[].fromPrice` | integer ≥ 0, required | The starting price in minor units, shown as "from $499". Excludes tax. An estimate; the operator confirms the final price. |
| `offers[].deliveryDays` | integer > 0, optional | Shown as "delivery in about N days"; omitted when missing. |
| `maintenance` | object or `null`, required | `null` when hosting and maintenance is not offered. |
| `maintenance.monthlyPrice` | integer ≥ 0 | Monthly price in minor units. Excludes tax. |
| `paymentMethod` | `"invoice"` or `"polar"`, optional | How a confirmed quote is paid. Missing or any other value: `"invoice"`. |
| `updatedAt` | ISO 8601 string, optional | When the offer last changed. Not shown. |

`fromPrice` and `monthlyPrice` exclude tax: sales tax or VAT is added where it
applies. The page says so in one short note under the prices ("Prices are in
USD, + tax if applicable. Payment is by invoice."), and in its neutral copy too
("Prices exclude tax, + tax if applicable. Payment is by invoice.").

`paymentMethod` is optional and additive: the example above omits it, and a
service that does not send it keeps working. It only changes wording, never
the prices or whether the quote action is shown:

- `"invoice"`, missing, or any other value (the prerendered HTML too): the
  last two "How it works" steps are "Request your invoice from the quote page
  and give us your billing details." and "Pay the invoice (+ tax if
  applicable). Work starts once the payment is received.", the note under the
  prices ends with "Payment is by invoice.", and maintenance is shown as "$39
  per month, billed by invoice". Nothing on the page offers online or card
  payment.
- `"polar"`: the last step is "You pay once you have the confirmed quote (+ tax
  if applicable). Work starts after the payment.", and the invoice wording is
  left out of the note and the maintenance price.

Prices are formatted with `Intl.NumberFormat` in the currency's own number of
minor digits (USD 49900 is `$499`, 49950 is `$499.50`, JPY 5000 is `¥5,000`).
Unknown fields are ignored. An offer entry without a string `id` and `name`
and an integer `fromPrice` is dropped. The whole response is treated as
unavailable, and the page shows its neutral copy with a "Get a quote" action,
when:

- `VITE_SERVICE_API` is unset or invalid,
- the request fails, times out (8 seconds) or returns a non-2xx status,
- the body is not JSON, `ordersOpen` is not a boolean, `offers` is not an
  array, `currency` is not a known three-letter code, or `maintenance` is
  neither `null` nor an object with an integer `monthlyPrice`.

## Quote pages: `${VITE_SERVICE_API}/q/<id>`

The quote assistant has one page action, `open_quote({ url })`, registered
with `confirm: true`, so the solv.chat widget asks the visitor before it runs.
A quote page shows the estimate until an operator has confirmed or adjusted
it; payment (an invoice request, or online payment when `paymentMethod` is
`"polar"`) is offered only for a confirmed quote. The action navigates the
tab only to an `https` URL on the `VITE_SERVICE_API` origin
whose path is under `<base path>/q/`; any other URL is refused with
`{ "opened": false, "error": "That destination is not allowed. …" }` and
nothing happens. The action is removed when the visitor leaves the page, so
the site assistant never sees it.

## Independence

Validation results, catalog status and badges are produced the same way for
every server and are not affected by buying this service. Nothing in the
catalog, the badges (`cloudflare-worker`) or published report permalinks
(`/r/*`) links to this page; the only link outside the footer is "Need help
fixing this?" on a report the visitor runs themselves, when it has failing
checks.
