---
title: How to connect a remote MCP server to Zed
navTitle: Connect a server to Zed
summary: Add a remote MCP server to Zed's context_servers setting, sign in with OAuth or pass a header, control which tools the agent may call, and fix the failures Zed users report.
track: use
level: practitioner
order: 30
category: Client setup
readingTimeMinutes: 5
lastReviewed: "2026-10-21"
metaTitle: Connect a Remote MCP Server to Zed | mcptest.io
metaDescription: How to add a remote MCP server to Zed. The context_servers settings for URL, headers, and OAuth client IDs, the Authenticate flow, tool permissions with mcp:server:tool keys, and known issues.
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - connect-mcp-server-to-cursor
  - remote-mcp-server-401-unauthorized
  - mcp-server-connected-but-no-tools
sourceLinks:
  - title: "Zed docs: Model Context Protocol"
    url: "https://zed.dev/docs/ai/mcp"
  - title: "Zed docs: tool permissions"
    url: "https://zed.dev/docs/ai/tool-permissions"
  - title: "Zed v0.230.0 release notes (OAuth for remote MCP servers)"
    url: "https://github.com/zed-industries/zed/releases/tag/v0.230.0"
  - title: "Zed v1.4.2 release notes (pre-registered OAuth clients)"
    url: "https://github.com/zed-industries/zed/releases/tag/v1.4.2"
  - title: "Zed settings source: ContextServerSettingsContent"
    url: "https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/project.rs"
---

Zed calls MCP servers "context servers". Its built-in agent can use tools and prompts from a remote server over Streamable HTTP, and since version 0.230.0 it can sign in to servers that use OAuth. This guide reflects Zed's MCP documentation and release notes reviewed on 21 October 2026, when the stable release was v1.24.4.

## Before you start

You need the exact MCP endpoint, for example `https://mcp.example.com/mcp`, and to know whether the server uses OAuth, a fixed token, or no authentication. [How to connect to a remote MCP server](/learn/connect-remote-mcp-server) explains how to find out. Zed supports MCP **tools** and **prompts**; resources are not listed as supported, so a server that only exposes resources will show nothing useful.

## Add the server

1. Open **Settings → AI → MCP Servers**. The `agent: open settings` action from the command palette also gets you there.
2. Click **Add Server**, then **Add Remote Server**.
3. Enter a name and the URL. Zed writes the entry into your settings file under `context_servers`.

You can also edit the settings file directly with `zed: open settings file`. A remote server with OAuth needs only a URL:

```json
{
  "context_servers": {
    "orders": {
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

The full set of fields for a remote entry, from Zed's settings schema:

| Field | Meaning |
| --- | --- |
| `url` | The MCP endpoint, including its path |
| `headers` | Headers sent on every request, for example `Authorization` |
| `enabled` | Defaults to `true`; set `false` to keep the entry but stop the server |
| `timeout` | Tool-call timeout in seconds; defaults to the global `context_server_timeout`, which is 60 |
| `oauth` | A pre-registered `client_id`, and `client_secret` for confidential clients |

## Sign in with OAuth

When a remote server has **no** `Authorization` header configured and answers `401` with OAuth metadata, Zed shows an **Authenticate** button next to the server. Clicking it opens the authorization server's page in your browser; after you approve, Zed stores the tokens in the system keychain.

Zed registers itself automatically when the authorization server allows it, using a Client ID Metadata Document or Dynamic Client Registration. If your provider only accepts clients registered in advance, register an app there and add its ID:

```json
{
  "context_servers": {
    "orders": {
      "url": "https://mcp.example.com/mcp",
      "oauth": { "client_id": "your-client-id" }
    }
  }
}
```

Zed's settings schema recommends leaving `client_secret` out of the file; Zed prompts for it and keeps it in the keychain.

Two releases matter if you are on an older build. v1.4.2 added pre-registered clients. v1.11.3 fixed servers that only challenge on `tools/call`, not on the first request, which previously never prompted for sign-in.

## Use a token instead

For servers that take an API key or personal access token, put it in `headers`:

```json
{
  "context_servers": {
    "orders": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Setting `Authorization` turns off the OAuth prompt for that server. Zed's documentation does not describe variable expansion in `headers`, so treat the value as a literal and keep the token out of a project settings file you commit.

## Check that it is running

In **Settings → AI → MCP Servers**, the dot next to the server turns green and its tooltip reads "Server is active" when the connection works. Other colors and tooltips describe the problem. For details, run `zed: open log` from the command palette; on macOS the log is `~/Library/Logs/Zed/Zed.log` and on Linux `~/.local/share/zed/logs/Zed.log`.

Each server row also has a toggle to disable it and a configure button to edit the entry.

## Control which tools the agent uses

Mentioning the server by name in a prompt helps the model pick its tools. To make sure only this server's tools are used, create an agent profile that turns off the built-in tools that overlap with the server's and enables specific server tools:

```json
{
  "agent": {
    "profiles": {
      "orders-only": {
        "name": "Orders only",
        "tools": { "terminal": false, "edit_file": false },
        "enable_all_context_servers": false,
        "context_servers": {
          "orders": { "tools": { "get-order": true } }
        }
      }
    }
  }
}
```

Approval is a separate setting. Since v0.224.0, `agent.tool_permissions.default` is `"confirm"`, so Zed asks before every tool call. Override it per MCP tool with a key of the form `mcp:<server>:<tool>`:

```json
{
  "agent": {
    "tool_permissions": {
      "tools": {
        "mcp:orders:get-order": { "default": "allow" }
      }
    }
  }
}
```

Only the `default` option applies to MCP tools; pattern rules match an empty string for them.

MCP servers configured in Zed are also forwarded to external agents over the Agent Client Protocol, but terminal threads use the CLI's own configuration.

## When it fails

### No Authenticate button, and the server stays red

The server did not return a usable `401` challenge, or it returned one without a `resource_metadata` parameter and has no metadata at the well-known locations. Check the first three steps of the [401 checklist](/learn/remote-mcp-server-401-unauthorized). If you have an `Authorization` header configured, Zed will not offer OAuth at all; remove the header.

### The provider rejects the redirect

Zed signs in through a loopback redirect on `127.0.0.1` with a port chosen at run time. Providers that require an exact, pre-registered redirect URI reject it; issue #56210 shows this with one hosted server. Use a provider that accepts loopback redirects on any port, as RFC 8252 recommends for native apps.

### Asked to sign in again after a while

Issue #65216, open at the time of writing, reports re-authentication after the provider rotates refresh tokens. If it happens on every refresh, check whether your provider rotates refresh tokens and whether the server's tokens are long-lived enough for your use.

### A tool call hangs

Issue #57180, also open, reports `tools/call` hanging after a server answers `404` to a stale `Mcp-Session-Id`. It affects servers that keep sessions in memory and lose them on restart or across replicas. Stateless servers, which never issue a session id, avoid it. Toggle the server off and on to recover.

### Tools appear but the model never calls them

Some models do not support every tool; Zed shows a warning icon near the model selector. Try another model or the profile above.

## Test the endpoint first

Zed's indicator tells you that something failed, not which request. Open the [MCP Playground](/), paste the endpoint, and connect before you edit settings. **Logs & Events** shows each request and response, including the `401` challenge and the OAuth discovery steps Zed will follow.
