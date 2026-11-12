---
title: How to connect a remote MCP server to GitHub Copilot CLI and the Copilot coding agent
navTitle: Copilot CLI and coding agent
summary: Add a remote MCP server to Copilot CLI with copilot mcp add or mcp-config.json, sign in with OAuth or pass a header from your environment, and configure the same server for Copilot cloud agent with COPILOT_MCP_ secrets.
track: use
level: practitioner
order: 32
category: Client setup
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: Connect an MCP Server to Copilot CLI and Coding Agent | mcptest.io
metaDescription: How to add a remote MCP server to GitHub Copilot CLI and Copilot cloud agent (coding agent). mcp-config.json, copilot mcp add, header variables, OAuth and /mcp auth, COPILOT_MCP_ secrets, tools allowlists.
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - connect-mcp-server-to-vs-code
  - mcp-server-authentication-patterns
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "GitHub Docs: add MCP servers to Copilot CLI"
    url: "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers"
  - title: "GitHub Docs: Copilot CLI command reference"
    url: "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference"
  - title: "GitHub Docs: configure MCP servers for Copilot cloud agent and code review"
    url: "https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers"
  - title: "GitHub Docs: secrets and variables for Copilot cloud agent"
    url: "https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/configure-secrets-and-variables"
  - title: Copilot CLI changelog
    url: "https://github.com/github/copilot-cli/blob/main/changelog.md"
---

GitHub Copilot has two agents that read MCP configuration, and they behave differently enough to need separate setup. **Copilot CLI** runs on your machine, supports OAuth, and reads headers from your shell environment. The **Copilot coding agent**, which GitHub's documentation now calls **Copilot cloud agent**, runs in GitHub Actions or a cloud sandbox for tasks assigned to Copilot, supports only tools, and cannot sign in with OAuth. This guide covers both, as documented on 11 November 2026, when the latest Copilot CLI release was 1.0.109. The CLI tests described below were run with Copilot CLI 1.0.101.

## Before you start

- **A Copilot plan.** Copilot CLI is available with all Copilot plans; if your Copilot comes from an organization, its Copilot CLI policy must be enabled. The cloud agent needs a paid Copilot plan.
- **The exact MCP endpoint**, including its path, for example `https://mcp.example.com/mcp`.
- **The sign-in method**: OAuth, a fixed API key or token, or none. The cloud agent cannot use OAuth, so an OAuth-only server works only in the CLI.
- **The tool names**, if you want an allowlist instead of all tools.

## At a glance

| | Copilot CLI | Copilot cloud agent |
| --- | --- | --- |
| Where it runs | Your terminal | GitHub Actions, per task |
| Config location | `~/.copilot/mcp-config.json`, plus `.mcp.json` or `.github/mcp.json` in the repository | Repository **Settings → Copilot → MCP servers** |
| Remote transports | `"type": "http"` (Streamable HTTP) or `"sse"` | `"http"` or `"sse"` |
| OAuth | Yes | No |
| Secrets in headers | `${VAR}` from your shell | `$COPILOT_MCP_*` Agents secrets (variables too, except in a cloud sandbox) |
| MCP features | Tools; the docs do not mention resources or prompts | Tools only, no resources or prompts |
| `tools` field | Required | Required |

## Copilot CLI

### Add the server

From a terminal:

```bash
copilot mcp add --transport http orders https://mcp.example.com/mcp
```

Inside an interactive session, `/mcp add` opens a form for the same fields; press Ctrl+S to save, and the server is available without restarting.

Both write the user configuration file, `~/.copilot/mcp-config.json`, or `mcp-config.json` under `COPILOT_HOME` if you set it. You can also edit it by hand:

```json
{
  "mcpServers": {
    "orders": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "tools": ["*"]
    }
  }
}
```

`type`, `url`, and `tools` are required for a remote server. `"streamable-http"` is accepted as an alias for `"http"`. `tools` is an allowlist: `["*"]` enables everything, and a list of names enables only those. `copilot mcp list` shows your servers next to the built-in `github-mcp-server`, and `copilot mcp get orders` shows one entry with header values masked.

The CLI also reads `.mcp.json` from the working directory up to the repository root, and `.github/mcp.json`, after you confirm that you trust the folder. It does not read VS Code's `.vscode/mcp.json`. When the same server name appears in several places, `--additional-mcp-config` wins, then project files, then the user file; in one directory, `.mcp.json` wins over `.github/mcp.json`.

### Sign in with OAuth

For a server that answers `401` with OAuth metadata, the CLI runs the sign-in itself: it registers a client, opens your browser, and stores and refreshes the tokens. OAuth arrived in version 0.0.389 in January 2026. When a token expires or you need another account, the server shows `needs-auth`; run `/mcp auth orders` to sign in again.

If the provider requires a pre-registered client, add its ID; the CLI then skips dynamic registration:

```json
{
  "mcpServers": {
    "orders": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "tools": ["*"],
      "oauthClientId": "your-client-id",
      "oauthScopes": ["orders:read"]
    }
  }
}
```

For CI with no browser, `"oauthGrantType": "client_credentials"` with `"oauthPublicClient": false` and a client secret stored in the system keychain makes the CLI request tokens directly from the token endpoint.

### Pass an API key from your environment

```bash
copilot mcp add --transport http \
  --header 'Authorization: Bearer ${ORDERS_MCP_TOKEN}' \
  --tools get-order \
  orders https://mcp.example.com/mcp
```

The single quotes keep your shell from expanding the variable when you add the server. The CLI writes it literally:

```json
{
  "mcpServers": {
    "orders": {
      "tools": ["get-order"],
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${ORDERS_MCP_TOKEN}"
      }
    }
  }
}
```

and expands it from the environment of the `copilot` process when it connects. Pointed at a test server that logs request headers and started with `ORDERS_MCP_TOKEN=expanded-ok`, Copilot CLI 1.0.101 sent `Authorization: Bearer expanded-ok`. Its first request was a 2026-07-28 `server/discover` with `MCP-Protocol-Version: 2026-07-28`.

The same test showed one behavior to expect. When the server rejected the header with `401`, the CLI went on to request `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource`, and `/mcp/.well-known/oauth-protected-resource`, looking for OAuth. An open issue, github/copilot-cli#3100, reports this as OAuth discovery replacing header authentication. If you see those requests in your server logs, the key is wrong or missing, not the OAuth setup.

### One-off and disabled servers

- `--additional-mcp-config @servers.json` adds servers for one session, overriding a configured server of the same name. Do not put tokens in this argument.
- `--disable-mcp-server orders` turns one server off for a session.
- `--disable-builtin-mcps` turns off the built-in servers, including `github-mcp-server`.

### Check that it worked

Run `copilot mcp list` and check that the server appears without `needs-auth`. Inside a session, `/mcp show` lists the servers and their tools. Then ask for something only one of the server's tools can do, and approve the tool call when the CLI asks.

## Copilot cloud agent

### Add the configuration

1. In the repository, open **Settings**.
2. Under "Code, planning, and automation", click **Copilot**, then **MCP servers**.
3. Paste the JSON into **MCP configuration** and click **Save MCP configuration**. GitHub validates the syntax.

```json
{
  "mcpServers": {
    "orders": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "tools": ["get-order"],
      "headers": {
        "Authorization": "$COPILOT_MCP_ORDERS_AUTHORIZATION"
      }
    }
  }
}
```

This page is now shared by the cloud agent (including automations) and Copilot code review; configurations from the older coding-agent settings page were moved here automatically. The GitHub and Playwright MCP servers are enabled by default alongside yours.

### Store the secret

The agent can only substitute **Agents** secrets and variables whose names start with `COPILOT_MCP_`. Use a secret, not a variable: when Copilot runs in a cloud sandbox, only secrets are available. In the repository, open **Settings**, then **Secrets and variables > Agents** under "Security", and create `COPILOT_MCP_ORDERS_AUTHORIZATION` with the whole header value, for example `Bearer sk_live_...`. GitHub documents `$NAME`, `${NAME}`, and `${NAME:-default}` as substitution forms for every string field except `tools` and `type`; storing the full value avoids depending on substitution in the middle of a string.

### What the cloud agent cannot do

- **No OAuth.** GitHub's documentation states that the cloud agent and code review do not support remote servers that use OAuth. A server that only offers OAuth needs a second credential, such as a personal access token, for this agent. [Authentication patterns](/learn/mcp-server-authentication-patterns) shows how to accept both.
- **Tools only.** Resources and prompts from the server are ignored.
- **No confirmation prompts.** The agent calls the tools in your allowlist on its own. GitHub recommends listing specific read-only tools rather than `"*"`.
- **Code review needs `readOnlyHint`.** Copilot code review uses a tool only if its `tools/list` entry sets `annotations.readOnlyHint` to `true`.

### Check that it worked

Assign an issue to Copilot, open the pull request it creates, and click **View session**. In the log viewer's menu, choose **Copilot**, then expand the **Start MCP Servers** step. When the server started, its tools are listed at the bottom of that step. If it needs software the Actions runner does not have, install it in a `copilot-setup-steps.yml` workflow.

## When it fails

| Symptom | Likely cause |
| --- | --- |
| CLI shows `needs-auth` | Token expired or another account is needed; run `/mcp auth <name>` |
| CLI logs show requests to `oauth-protected-resource` paths for a key-based server | The header was rejected; check the variable is set in the shell that started `copilot` |
| Cloud agent's **Start MCP Servers** step lists no tools for the server | Secret name lacks the `COPILOT_MCP_` prefix, the value is a variable in a cloud sandbox session, `tools` names do not match, or the server needs OAuth |
| Long `Authorization` tokens rejected | github/copilot-cli#2960, still open, reports a header length limit too low for some Microsoft Entra ID tokens |
| CLI sign-in fails with a provider that does not support registration | Add `oauthClientId`; see [Does not support dynamic client registration](/learn/mcp-error-dynamic-client-registration) |

For a `401` that the server returns even with the right credential, work through the [401 checklist](/learn/remote-mcp-server-401-unauthorized).

## Verify the endpoint before you add it

Open the [MCP Playground](/), paste the endpoint and click **Connect**. For an OAuth server the playground runs the sign-in in your browser; for a catalog server that takes an API key or bearer token, it asks for the key. **Logs & Events** shows each request, so you can confirm the tool names for your `tools` allowlist and see whether the server answers a 2026 `server/discover` before Copilot does. A link such as `https://mcptest.io/server/mcp.example.com/mcp` opens the playground with `https://mcp.example.com/mcp` already filled in.
