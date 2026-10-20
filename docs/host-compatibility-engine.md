# Host compatibility engine

The compatibility engine lives in `src/compatibility` and has no UI, network,
storage, entitlement, or clock dependencies. Discovery code supplies a complete
`ObservedServerFactsV1`; the evaluator applies a versioned `HostProfileV1` and
returns one of:

- `compatible`
- `compatible-with-caveats`
- `incompatible`
- `unknown`

Unknown observations are values, not exceptions. A rule returns `unknown` when
a material fact needed by that rule is unknown. Optional branches, such as the
OAuth rules for a public server, do not run unless observations establish that
they apply.

## Boundaries

`target-server`, `authorization-server`, and `client-environment` are separate
finding scopes. Browser CORS failures and use of the mcptest proxy are recorded
as client-environment evidence. They do not prove that a cloud or desktop host
cannot reach the target. A generic SDK profile reports blocked CORS as a caveat
because the SDK might be used in a browser.

An HTTP authorization challenge is also not a broken connection. It establishes
that authorization is required. Compatibility then depends on the advertised
scheme and, for OAuth, discovery, registration, PKCE, refresh, and redirect facts.
Whether the current mcptest user supplied a credential is deliberately not part
of `ObservedServerFactsV1`.

## Client data is the source of truth

What each client documents (transports, protocol versions, OAuth registration
modes, static credentials, headers, private-host reach, consumed capabilities,
callback URIs, limitations and configuration surfaces) lives in
`src/data/clientCompatibility.json`, typed and validated by
`src/data/clientCompatibility.ts`. The same data feeds three outputs:

- `profiles.ts` builds each host profile's transports, auth schemes,
  registration modes, exact callback URIs, supported and ignored capabilities,
  and assumption sources from the entry whose `hostProfileId` matches. The
  profile version is `<entry verifiedOn>.1`.
- The `<!-- compat-matrix clients="..." -->` directive in Learn articles is
  expanded into a Markdown table when the article is created
  (`src/content/compatMatrix.ts`), so the React page, the prerendered HTML and
  the `.md` export carry the same table. Add `limitations="true"` to list each
  client's sourced limitations under the table.
- The release-readiness report's host compatibility cards cite the client name,
  version, verification date and documentation link.

Only `supported` cells change engine behavior. `limited` (beta, plan-gated or a
subset of accounts), `unsupported`, `bridge-required` and `unknown` are all
treated as not available, so a capability the host does not document becomes a
caveat rather than an assumed pass. Callback patterns with a variable port are
kept in the cell `note` and are not used for exact-match redirect checks.

What stays in `profiles.ts` is modeling rather than client fact: accepted
protocol eras, session behavior, whether stateful servers get a scaling caveat,
the callback style (`hosted-https`, `loopback` or `flexible`) and whether
browser CORS matters for the host. Rules remain data and the evaluator contains
no host names or host-specific branches. Do not reinterpret old stored
assessments under new assumptions; retain the returned `profileVersion` with
the assessment.

All current profiles accept the 2024, 2025, and 2026 protocol-era vocabulary.
Protocol era and session behavior are independent facts: both stateful and
stateless Streamable HTTP servers have dedicated fixtures. Legacy HTTP+SSE is
accepted with a migration caveat because it is deprecated by the MCP transport
specification.

## Updating a client cell

Every cell is `{ "value", "source", "verifiedOn", "note"? }`. Limitations and
configuration surfaces are `{ "text", "source", "verifiedOn" }`.

1. Open the cell's `source` page (or the client's current official
   documentation if the page moved) and read what it states today.
2. Set `value` to what the page says. Support cells take `supported`,
   `limited`, `unsupported`, `bridge-required` or `unknown`. Use `unknown` when
   the vendor does not document it; never infer support from a forum post or
   a third-party blog. Put qualifiers in `note`.
3. Set `source` to the exact page that establishes the value. A new page must
   also be added to the entry's `sources` list with a title.
4. Set `verifiedOn` to the day you read it, and set the entry's `verifiedOn`
   to the oldest `verifiedOn` among its cells. Re-checking a cell that did not
   change still updates its `verifiedOn`.
5. Run `npm run check-client-compat`, then `npm test`. A changed value that
   alters a host verdict shows up in `src/compatibility/compatibility.test.ts`;
   update the expectation only when the new documentation supports it, and say
   why in the pull request.

`npm run check-client-compat` fails when any cell was verified more than 90
days ago (pass `-- --today YYYY-MM-DD` to check against another day) or when
the data is structurally invalid. The data module also refuses to load invalid
data, so a broken edit fails the build and the tests.

## Profile assumptions

Each profile's assumptions are generated from its client entry: one assumption
per source page, listing the engine-relevant cells that page establishes, with
that page's verification date. The MCP authorization specification is an
additional modeling assumption on every profile, reviewed on 2026-08-11.

- **ChatGPT** (`chatgpt`): ChatGPT custom MCP servers and connectors, not the
  separately configurable OpenAI API hosted MCP tool. Stateful Streamable HTTP
  is accepted with an operational caveat because hosted, horizontally scaled
  use requires durable session routing.
- **Claude** (`claude-ai`): claude.ai custom connectors; Claude Desktop uses
  the same connectors. The documented hosted callback is
  `https://claude.ai/api/mcp/auth_callback`.
- **Cursor** (`cursor`): modeled as a local public OAuth client with loopback
  callbacks and PKCE.
- **VS Code/Copilot** (`vscode-copilot`): the desktop OAuth client is modeled
  with loopback callbacks.
- **Generic MCP SDK** (`generic-sdk`): what a configurable client on the
  TypeScript SDK can implement, not what every application using an SDK has
  wired up. Browser CORS is therefore a runtime-dependent caveat.

## Canonical fixtures

`fixtures.ts` exports public, OAuth-protected, stateful Streamable HTTP,
stateless Streamable HTTP, and legacy SSE facts. Fixtures include evidence on
every observation and intentionally leave non-applicable OAuth details unknown
for public servers.
