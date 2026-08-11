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

## Updating profiles

Rules are data in `profiles.ts`. The evaluator only interprets conditions and
does not contain host names or host-specific branches. Update a profile version,
its assumptions, and its generated constraints when a host changes. Do not
reinterpret old stored assessments under new assumptions; retain the returned
`profileVersion` with the assessment.

All current profiles accept the 2024, 2025, and 2026 protocol-era vocabulary.
Protocol era and session behavior are independent facts: both stateful and
stateless Streamable HTTP servers have dedicated fixtures. Legacy HTTP+SSE is
accepted with a migration caveat because it is deprecated by the MCP transport
specification.

## Profile assumptions

Assumptions were reviewed on 2026-08-11. Each profile also carries these sources
as machine-readable evidence.

### ChatGPT

- [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt): remote custom servers can be public or OAuth-protected; OAuth refresh support affects continued connectivity. This profile represents ChatGPT custom apps/connectors, not the separately configurable OpenAI API hosted MCP tool.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): protected-resource and authorization-server discovery, PKCE, client registration, and exact redirect validation.
- Only tools are treated as a usable ChatGPT capability in this foundation profile. Other advertised MCP capabilities produce caveats rather than transport failures.
- Stateful Streamable HTTP is accepted with an operational caveat because hosted, horizontally scaled use requires durable session routing.

### Claude

- [Building custom integrations via remote MCP servers](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers): Streamable HTTP and SSE, authless and OAuth servers, DCR, tools, prompts, and resources are supported. Resource subscriptions, sampling, and other advanced capabilities are documented as unsupported.
- The documented hosted callback is `https://claude.ai/api/mcp/auth_callback`.

### Cursor

- [Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol): remote SSE and Streamable HTTP endpoints and OAuth are supported.
- The compatibility baseline is tool consumption. Other server capabilities are caveats until Cursor documents them as supported for remote servers.
- As a local public OAuth client, Cursor is modeled with loopback callbacks and PKCE. Static bearer/API-key credentials can be provided through client configuration.

### VS Code/Copilot

- [Add and manage MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers): HTTP with SSE fallback, tools, resources, prompts, and interactive capabilities.
- [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration): arbitrary HTTP authentication headers and pre-registered OAuth client IDs can be configured.
- The desktop OAuth client is modeled with loopback callbacks. Resource subscriptions and sampling remain caveats in the host profile.

### Generic MCP SDK

- [MCP TypeScript SDK client guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect): Streamable HTTP, legacy SSE, OAuth composition, and the protocol capability surface.
- This profile describes what a configurable SDK client can implement, not what every application using an SDK has wired up. Browser CORS is therefore a runtime-dependent caveat.

## Canonical fixtures

`fixtures.ts` exports public, OAuth-protected, stateful Streamable HTTP,
stateless Streamable HTTP, and legacy SSE facts. Fixtures include evidence on
every observation and intentionally leave non-applicable OAuth details unknown
for public servers.
