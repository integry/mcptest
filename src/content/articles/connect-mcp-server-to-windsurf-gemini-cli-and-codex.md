---
title: How to connect a remote MCP server to Windsurf, Gemini CLI and Codex
navTitle: Windsurf, Gemini CLI and Codex
summary: Remote MCP setup for Windsurf (now Devin Desktop), Gemini CLI and OpenAI Codex, including how each config selects the transport and when you need the mcp-remote bridge.
track: use
level: practitioner
order: 24
category: Client setup
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - mcp-client-support-matrix
  - connect-mcp-server-to-chatgpt
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "Devin Desktop docs: Devin Local customizations (MCP servers)"
    url: "https://docs.devin.ai/desktop/devin-local/customizations"
  - title: Devin Desktop changelog
    url: "https://docs.devin.ai/desktop/changelog"
  - title: "Devin CLI docs: MCP configuration"
    url: "https://docs.devin.ai/cli/extensibility/mcp/configuration"
  - title: "Gemini CLI: MCP servers with Gemini CLI"
    url: "https://geminicli.com/docs/tools/mcp-server/"
  - title: "Gemini CLI source docs: mcp-server.md"
    url: "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md"
  - title: "Gemini CLI: configuration reference (environment variables in settings.json)"
    url: "https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md"
  - title: "ChatGPT Learn: Model Context Protocol in Codex"
    url: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli"
  - title: "Gemini CLI settings schema"
    url: "https://github.com/google-gemini/gemini-cli/blob/main/schemas/settings.schema.json"
  - title: "Codex: configuration reference"
    url: "https://learn.chatgpt.com/docs/config-file/config-reference"
  - title: Codex rust-v0.167.1 release
    url: "https://github.com/openai/codex/releases/tag/rust-v0.167.1"
  - title: mcp-remote
    url: "https://github.com/geelen/mcp-remote"
---
## Transport support at a glance

All three clients connect to remote Streamable HTTP servers directly. None of them is limited to stdio. They differ in how the config selects the transport and in legacy SSE support:

| Client | Streamable HTTP | Legacy SSE | Config file | Version reflected |
| --- | --- | --- | --- | --- |
| Windsurf / Devin Desktop (Devin Local) | Yes, `url` | Yes, automatic fallback or `"transport": "sse"` | `~/.config/devin/mcp_config.json` or `.devin/mcp_config.json` | v3.12.43 (9 November 2026) |
| Gemini CLI | Yes, `url` with `"type": "http"` | Yes, `url` with `"type": "sse"` | `~/.gemini/settings.json` or `.gemini/settings.json` | v0.68.0 (10 November 2026) |
| Codex | Yes, `url` | Not documented; use a bridge | `~/.codex/config.toml` | rust-v0.167.1 (10 November 2026) |

This guide was reviewed against each vendor's documentation on 11 November 2026.

## Before you start

- **The exact MCP endpoint**, including its path, for example `https://mcp.example.com/mcp`.
- **The sign-in method**: OAuth, a fixed API key or header, or no authentication.
- **A local browser** for OAuth. All three clients open one for sign-in.

For the checks to run on an endpoint before you configure any client, see [How to connect to a remote MCP server](/learn/connect-remote-mcp-server). For the wider client comparison, see [MCP clients compared](/learn/mcp-clients-compared).

### Verified compatibility

<!-- compat-matrix clients="windsurf,gemini-cli,codex-cli" limitations="true" -->

The compatibility table above still describes Windsurf's former Cascade agent in places; the steps below follow the current Devin Local documentation.

## Windsurf (Devin Desktop)

Windsurf has been renamed Devin Desktop, and `docs.windsurf.com` redirects to `docs.devin.ai`. Devin Desktop v3.9.19 (8 September 2026) removed the Cascade agent; Devin Local is now its only agent. Guides that describe the Cascade panel's MCP menu or `~/.codeium/windsurf/mcp_config.json` are out of date.

### Add the server

1. Open the **Customize** page from the Agents window and click **MCPs**.
2. In the **Install MCPs for** selector at the top, choose **This computer**. The list shows the servers your local agent loads.
3. To install a server from your MCP registry, find it under **Available** and click **Install**. To add any other server, open the config file from this page and edit it.
4. Add the server under `mcpServers`. A remote server needs `url`:

   ```json
   {
     "mcpServers": {
       "example": {
         "url": "https://mcp.example.com/mcp"
       }
     }
   }
   ```

5. Save the file and refresh the list on the **MCPs** page.

Pick the file by who should see the server:

| Scope | File | Shared with the team |
| --- | --- | --- |
| Project | `.devin/mcp_config.json` | Yes, committed to the repository |
| Local override | `.devin/mcp_config.local.json` | No, gitignored |
| User | `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json` on Windows) | No |

Devin Local tries Streamable HTTP first and falls back to SSE on the same URL if the server answers a 4xx such as `404` or `405`. Set `"transport": "sse"` only if the SSE endpoint has a different path.

**OAuth.** Leave out any `Authorization` header. When the server challenges, Devin Local registers itself with Dynamic Client Registration and opens your browser. For a provider that needs a pre-registered client, add `oauthClientId` (and `oauthClientSecret` for confidential clients, written as `${env:VAR}` or `${file:/path}` so the secret stays out of the file). From a terminal, `devin mcp login example` starts the same sign-in.

**API keys.** Put a fixed key in `headers`, for example `"headers": { "Authorization": "Bearer <token>" }`. Devin documents environment-variable expansion for OAuth fields, not for headers, so keep keys in the user file or in `.devin/mcp_config.local.json`, never in the committed project file.

### Check that it worked

On **Customize > MCPs > This computer**, the server is switched on and does not show **Needs authentication**. Each server writes its log to an `MCP: <server>` output channel. From a terminal, `devin mcp list` and `devin mcp get example` show the same state. By default the agent asks for approval before it calls any MCP tool.

### When it fails

- **The server shows Needs authentication.** The stored OAuth credentials are missing or expired. Click **Authenticate** to clear them and sign in again.
- **The server is blocked on a team plan.** Team admins can turn MCP off entirely, restrict servers to an allowlist, or enforce an MCP registry. Ask an admin which applies.
- **You edited the old Windsurf file.** `~/.codeium/windsurf/mcp_config.json` is not where Devin Local reads servers. Move the entry to one of the files above.
- **Sign-in fails with a provider that does not support registration.** Add `oauthClientId`; see [Does not support dynamic client registration](/learn/mcp-error-dynamic-client-registration).

## Gemini CLI

Unpaid-tier and Google One users were moved from Gemini CLI to Antigravity CLI on 18 June 2026. Gemini CLI is still available with paid Gemini API keys, Gemini Enterprise Agent Platform keys and Gemini Code Assist Standard or Enterprise. The steps below follow the Gemini CLI documentation and source.

### Add the server

1. Run the add command with the HTTP transport. Without `--transport` the default is stdio, and the default scope is the project:

   ```bash
   gemini mcp add --transport http example https://mcp.example.com/mcp
   ```

2. Or edit `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project). Set `url` and say which transport it is with `type`:

   ```json
   {
     "mcpServers": {
       "example": {
         "url": "https://mcp.example.com/mcp",
         "type": "http",
         "headers": {
           "Authorization": "Bearer $EXAMPLE_TOKEN"
         },
         "timeout": 30000
       }
     }
   }
   ```

3. Start Gemini CLI and run `/mcp list`.

String values in `settings.json` can reference environment variables as `$VAR`, `${VAR}` or `${VAR:-default}`, so the token itself stays out of the file. `timeout` is in milliseconds and defaults to 600,000 (10 minutes).

`type` is `http` for Streamable HTTP or `sse` for legacy SSE. Older guides, and parts of the Gemini CLI reference, use `httpUrl` for Streamable HTTP and a bare `url` for SSE. Current releases still accept `httpUrl` but log that it is deprecated, and a bare `url` without `type` is tried as Streamable HTTP first. Setting `type` explicitly works in both old and new releases.

### Sign in with OAuth

For servers that support OAuth discovery, leave out the `oauth` block. Gemini CLI detects the `401`, discovers the endpoints, registers itself dynamically and opens a browser. Run `/mcp auth example` to start or repeat the sign-in. Tokens are stored in `~/.gemini/mcp-oauth-tokens.json`.

For a provider that needs a pre-registered client, add `"oauth": { "enabled": true, "clientId": "...", "scopes": ["..."] }`, plus `clientSecret` for confidential clients. The callback uses a random local port (`http://localhost:<port>/oauth/callback`); set `redirectUri` if the provider needs a fixed one.

### Check that it worked

Run `gemini mcp list` from your shell for each server's connection status, or `/mcp list` in a session for its tools. After editing the config, `/mcp reload` discovers the tools again. Tools appear to the model as `mcp_<server>_<tool>`, so avoid underscores in server names.

### When it fails

- **`gemini mcp list` shows the server disconnected.** Check that the entry has `"type": "http"` for a Streamable HTTP endpoint, and that the path is the MCP endpoint, not the site root. For a `404` on an SSE endpoint, see [SSE error: Non-200 status code (404)](/learn/mcp-error-sse-non-200-404).
- **The browser never opens.** The OAuth flow needs a local browser. It does not work over SSH without X11 forwarding or in containers without a browser. Sign in on a machine with a browser, or use a header token.
- **Tool calls run without asking.** `"trust": true` skips all confirmations for that server. Remove it unless you trust every tool.
- **Some tools are missing.** Check `includeTools` and `excludeTools` in the server entry. `excludeTools` wins when a tool is in both.

## Codex

The ChatGPT desktop app, the Codex CLI and the Codex IDE extension share one MCP configuration in `~/.codex/config.toml`. Project-level `.codex/config.toml` files are read only in trusted projects. Streamable HTTP and OAuth no longer need an experimental flag.

### Add the server

1. Add it from the command line:

   ```bash
   codex mcp add example --url https://mcp.example.com/mcp
   ```

2. For OAuth, sign in. Add `--no-browser` to print the URL instead; after you sign in, paste the full redirect URL back into the terminal:

   ```bash
   codex mcp login example
   ```

3. Or write the entry directly. `bearer_token_env_var` names an environment variable that holds the token:

   ```toml
   [mcp_servers.example]
   url = "https://mcp.example.com/mcp"
   bearer_token_env_var = "EXAMPLE_TOKEN"
   startup_timeout_sec = 20
   ```

4. In the IDE extension, open the gear menu, choose **MCP servers**, then **Add server**. Enter a name, pick **Streamable HTTP** and enter the URL. Save the server, then select **Restart extension**. Servers that need OAuth show **Authenticate**.

For providers that require a pre-registered client, pass `--oauth-client-id` to `codex mcp add`, and `--oauth-client-secret` for confidential clients; Codex saves the secret in `config.toml`. To force a registration method for one sign-in, run `codex mcp login example --oauth-client-registration cimd` (or `dcr`; the default is `auto`). That choice is not saved. Codex listens for the OAuth callback on a loopback address with a variable port, so the authorization server must accept any loopback port. To fix the port, set `mcp_oauth_callback_port` globally or `mcp_servers.example.oauth.callback_port` for one server.

### Check that it worked

Run `codex mcp list` for the configured servers. In the CLI, `/mcp` lists the active servers and their tools. In the IDE extension, the MCP server list shows which servers are enabled and which still need OAuth.

### When it fails

- **The server only offers legacy SSE.** Codex documents stdio and Streamable HTTP only. Ask the publisher for a Streamable HTTP endpoint, or run the `mcp-remote` bridge as a stdio server:

  ```toml
  [mcp_servers.example]
  command = "npx"
  args = ["-y", "mcp-remote", "https://mcp.example.com/sse", "--transport", "sse-only"]
  ```

  `mcp-remote` is community software; review it before running it.
- **Startup times out.** The default `startup_timeout_sec` is 10 seconds. Raise it for slow servers. Tool calls time out after `tool_timeout_sec`, 60 seconds by default. See [MCP error -32001: Request timed out](/learn/mcp-error-request-timed-out).
- **Tools are missing.** Check `enabled_tools` and `disabled_tools`. The deny list is applied after the allow list. `enabled = false` turns off the whole server.
- **The token is not sent.** `bearer_token_env_var` takes the name of the variable, not the token. Codex must be started from a shell where that variable is set.
- **Codex will not start.** `required = true` makes startup fail when the server cannot initialize. Remove it while you debug.

## Verify the endpoint before you add it

Each of these clients reports a failed connection in its own way. Open the [MCP Playground](/), paste the endpoint and click **Connect** before you edit any config. The connection badge shows **HTTP** or **SSE**, which tells you which `type` to use in Gemini CLI and whether Codex needs the bridge. A link such as `https://mcptest.io/server/mcp.example.com/mcp` opens the playground with `https://mcp.example.com/mcp` already filled in.
