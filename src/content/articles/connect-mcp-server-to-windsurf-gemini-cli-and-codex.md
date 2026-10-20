---
title: How to connect a remote MCP server to Windsurf, Gemini CLI and Codex
navTitle: Windsurf, Gemini CLI and Codex
summary: Remote MCP setup for Windsurf (now Devin Desktop), Gemini CLI and OpenAI Codex, including which transport each key selects and when you need the mcp-remote bridge.
track: use
level: practitioner
order: 24
category: Client setup
readingTimeMinutes: 6
lastReviewed: "2026-10-20"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - connect-mcp-server-to-chatgpt
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "Devin Desktop docs: Cascade MCP configuration (formerly docs.windsurf.com)"
    url: "https://docs.devin.ai/desktop/cascade/mcp"
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
  - title: Codex rust-v0.163.0 release
    url: "https://github.com/openai/codex/releases/tag/rust-v0.163.0"
  - title: mcp-remote
    url: "https://github.com/geelen/mcp-remote"
---
## Transport support at a glance

All three clients connect to remote Streamable HTTP servers directly. None of them is limited to stdio. The differences are in which key selects which transport and in legacy SSE support:

| Client | Streamable HTTP | Legacy SSE | Config file | Version reflected |
| --- | --- | --- | --- | --- |
| Windsurf / Devin Desktop (Cascade) | Yes, `serverUrl` or `url` | Yes | `~/.config/devin/mcp_config.json` | Docs reviewed 20 October 2026 |
| Gemini CLI | Yes, `httpUrl` | Yes, `url` | `~/.gemini/settings.json` or `.gemini/settings.json` | Docs reviewed 20 October 2026 |
| Codex | Yes, `url` | Not documented; use a bridge | `~/.codex/config.toml` | rust-v0.163.0 (15 October 2026) |

For the checks to run on an endpoint before you configure any client, see [How to connect to a remote MCP server](/learn/connect-remote-mcp-server). For the wider client comparison, see [MCP clients compared](/learn/mcp-clients-compared).

## Windsurf (Devin Desktop)

Windsurf has been renamed Devin Desktop, and `docs.windsurf.com` now redirects to `docs.devin.ai`. The MCP setup below applies to the Cascade agent, which the documentation now calls legacy; new conversations start in Devin Local, which reads `.devin/mcp_config.json` in the project or the same user file.

### Add the server

1. In the Cascade panel, open the `...` menu at the top right and select the **Open MCP config file** icon in the **MCPs** section. The file is `~/.config/devin/mcp_config.json` on macOS and Linux, and `%APPDATA%\devin\mcp_config.json` on Windows.
2. Add the server under `mcpServers`. Remote servers need `serverUrl` or `url`:

   ```json
   {
     "mcpServers": {
       "example": {
         "serverUrl": "https://mcp.example.com/mcp",
         "headers": {
           "Authorization": "Bearer ${env:EXAMPLE_TOKEN}"
         }
       }
     }
   }
   ```

3. Save the file. The **MCPs** section lists each server and how many of its tools are enabled, with a switch for each server.

`${env:VAR}` and `${file:/path/to/file}` are expanded in `serverUrl`, `url` and `headers`. OAuth is supported for every transport; leave out the `Authorization` header and Cascade starts the sign-in when the server challenges. Cascade has no MCP marketplace or one-click install.

### When it fails

- **The server is ignored on a team plan.** Team admins can allowlist MCP servers. Once a single server is allowlisted, every other server is blocked. The allowlist ID must match the key in `mcp_config.json` exactly, including case.
- **Some tools are missing.** Cascade can use at most 100 tools at a time. Switch off tools or servers you do not need in the **MCPs** section.
- **You edited the old Windsurf file.** Older guides point to `~/.codeium/windsurf/mcp_config.json`. Current builds read `~/.config/devin/mcp_config.json`.
- **MCP does nothing on Enterprise.** Enterprise users must turn MCP on in settings first.

## Gemini CLI

Unpaid-tier and Google One users were moved from Gemini CLI to Antigravity CLI on 18 June 2026. The steps below are for Gemini CLI as documented on geminicli.com.

### Add the server

1. Run the add command with the HTTP transport. Without `--transport`, the default is stdio, and the default scope is the project:

   ```bash
   gemini mcp add --transport http example https://mcp.example.com/mcp
   ```

2. Or edit `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project). The key you choose selects the transport, and there is no `type` field:

   ```json
   {
     "mcpServers": {
       "example": {
         "httpUrl": "https://mcp.example.com/mcp",
         "headers": {
           "Authorization": "Bearer $EXAMPLE_TOKEN"
         },
         "timeout": 30000
       }
     }
   }
   ```

3. Start Gemini CLI and run `/mcp list` for each server's status and tools.

String values in `settings.json` can reference environment variables as `$VAR`, `${VAR}` or `${VAR:-default}`, so the token itself stays out of the file.

`httpUrl` selects Streamable HTTP. `url` selects SSE. Putting a Streamable HTTP endpoint under `url` is the most common Gemini CLI configuration mistake.

### Sign in with OAuth

For servers that support OAuth discovery, leave out the `oauth` block. Gemini CLI detects the `401`, discovers the endpoints, registers itself dynamically and opens a browser. Run `/mcp auth example` to start or repeat the sign-in. Tokens are stored in `~/.gemini/mcp-oauth-tokens.json`.

For a provider that needs a pre-registered client, add `"oauth": { "enabled": true, "clientId": "...", "scopes": ["..."] }`. The callback uses a random local port (`http://localhost:<port>/oauth/callback`); set `redirectUri` if the provider needs a fixed one.

### When it fails

- **`/mcp list` shows the server disconnected.** Check that the endpoint is under `httpUrl`, not `url`.
- **The browser never opens.** The OAuth flow needs a local browser. It does not work over SSH without X11 forwarding or in containers without a browser. Sign in on a machine with a browser, or use a header token.
- **Tool calls run without asking.** `"trust": true` skips all confirmations for that server. Remove it unless you trust every tool.
- **Some tools are missing.** Check `includeTools` and `excludeTools` in the server entry.

## Codex

Codex (CLI, IDE extension and desktop app) shares one configuration in `~/.codex/config.toml`. Project-level `.codex/config.toml` files are read only in trusted projects. Streamable HTTP and OAuth no longer need an experimental flag.

### Add the server

1. Add it from the command line:

   ```bash
   codex mcp add example --url https://mcp.example.com/mcp
   ```

2. For OAuth, sign in. Add `--no-browser` to print the URL instead:

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

4. In the IDE extension, open the gear menu, choose **MCP servers**, then **Add server**, pick **Streamable HTTP** and enter the URL. Select **Restart extension** afterwards. Servers that need OAuth show **Authenticate**.

For providers that require a pre-registered client, pass `--oauth-client-id`, and `--oauth-client-secret` for confidential clients; Codex saves the secret in `config.toml`. `--oauth-client-registration` takes `auto`, `cimd` or `dcr`. The default callback is `http://127.0.0.1/callback`; set `oauth.callback_port` to fix the port.

### When it fails

- **The server only offers legacy SSE.** Codex documents Streamable HTTP only. Ask the publisher for a Streamable HTTP endpoint, or run the `mcp-remote` bridge as a stdio server:

  ```toml
  [mcp_servers.example]
  command = "npx"
  args = ["-y", "mcp-remote", "https://mcp.example.com/sse", "--transport", "sse-only"]
  ```

  `mcp-remote` is community software; review it before running it.
- **Startup times out.** The default `startup_timeout_sec` is 10 seconds. Raise it for slow servers. Tool calls time out after `tool_timeout_sec`, 60 seconds by default.
- **Tools are missing.** Check `enabled_tools` and `disabled_tools`. The deny list is applied after the allow list. `enabled = false` turns off the whole server.
- **The token is not sent.** `bearer_token_env_var` takes the name of the variable, not the token. Codex must be started from a shell where that variable is set.
- **Codex will not start.** `required = true` makes startup fail when the server cannot initialize. Remove it while you debug.

## Verify the endpoint before you add it

Each of these clients reports a failed connection in its own way. Open the [MCP Playground](/), paste the endpoint and connect before you edit any config. The connection badges show whether the server answered over HTTP or SSE, which tells you whether to use `httpUrl` or `url` in Gemini CLI and whether Codex needs the bridge. A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
