---
title: How to add a remote MCP server to Claude
navTitle: Add a server to Claude
summary: Step-by-step setup for remote MCP servers in claude.ai custom connectors, Claude Desktop and Claude Code, with the plan differences and the real failure modes for each.
track: use
level: newcomer
order: 20
category: Client setup
readingTimeMinutes: 10
lastReviewed: "2026-11-11"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - mcp-client-support-matrix
  - remote-mcp-server-401-unauthorized
  - mcp-server-connected-but-no-tools
sourceLinks:
  - title: "Claude Help Center: Get started with custom connectors using remote MCP"
    url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
  - title: "Claude docs: Add a connector that isn't in the directory"
    url: "https://claude.com/docs/connectors/custom/add-unlisted"
  - title: "Claude docs: Authentication for connectors"
    url: "https://claude.com/docs/connectors/building/authentication"
  - title: "Claude docs: Test your connector"
    url: "https://claude.com/docs/connectors/building/testing"
  - title: "Claude docs: Troubleshoot your connector"
    url: "https://claude.com/docs/connectors/building/troubleshooting"
  - title: "Claude Code: Connect Claude Code to tools via MCP"
    url: "https://code.claude.com/docs/en/mcp"
  - title: Claude Code changelog
    url: "https://code.claude.com/docs/en/changelog"
  - title: "Anthropic API: IP addresses"
    url: "https://platform.claude.com/docs/en/api/ip-addresses"
  - title: "anthropics/claude-code#5826: custom connector OAuth failures traced to server responses"
    url: "https://github.com/anthropics/claude-code/issues/5826"
---
## Which Claude surface you are configuring

Claude has three places where you can add a remote MCP server. Each is configured differently:

| Surface | Where the server is added | Where requests come from |
| --- | --- | --- |
| claude.ai (web and mobile) | Custom connectors | Anthropic's cloud |
| Claude Desktop | The same custom connectors, through your Claude account | Anthropic's cloud |
| Claude Code | `claude mcp add` or a `.mcp.json` file | Your own machine |

This guide reflects the Claude connector documentation and Claude Code v2.1.322 (10 November 2026), reviewed on 11 November 2026. It covers remote servers only.

## Before you start

- **The exact endpoint.** You need the server's MCP URL, including its path, for example `https://mcp.example.com/mcp`. A homepage or REST API base URL will not work.
- **The sign-in method.** Find out whether the server uses OAuth, a fixed API key, or no authentication.
- **Public reachability, for claude.ai and Desktop.** Connectors are called from Anthropic's cloud, so the server must be reachable from the public internet over IPv4. Claude Code connects from your machine and has no such limit.
- **Your plan and role.** Custom connectors are available on Free, Pro, Max, Ultra, Team and Enterprise. Free accounts can add one. On Team and Enterprise, only an Owner (or an Enterprise member with the right custom role) can add one.

If you have not yet confirmed that your URL is a working MCP endpoint, read [How to connect to a remote MCP server](/learn/connect-remote-mcp-server) first.

## Compatibility at a glance

<!-- compat-matrix clients="claude-ai,claude-desktop,claude-code" limitations="true" -->

## claude.ai custom connectors

The steps differ between individual plans and organization plans.

### Free, Pro, Max and Ultra

1. Open **Customize > Connectors** (claude.ai/customize/connectors).
2. Click **+ Add**, then **Add custom connector**.
3. Enter a name and the remote MCP server URL, then click **Continue**.
4. Review the authentication settings. If Claude can read them from the server, it selects them and marks them **Detected**. Keep detected options unless the server's documentation says otherwise.
   - **Sign in now**: you sign in through the server's OAuth flow before you use the connector.
   - **Sign in when needed**: Claude connects without credentials and asks you to sign in when the server requires it.
   - **No sign-in**: no OAuth. If the server takes an API key, choose this and add the key under **Request headers** (see below).
5. For OAuth, keep **Use Claude's published identity (Recommended)** unless the server's documentation says otherwise. The other options are **Register automatically** (Dynamic Client Registration) and **Use your own OAuth client**, which takes a client ID and, only if the authorization server requires one, a secret.
6. Click **Add**. If the connector then shows **Connect**, click it. A browser window opens on the server's authorization page. Check the address before you sign in.

The dialog layout varies by organization. If yours shows everything on one screen, the OAuth client and request header fields are under **Advanced**.

**Request headers for API keys.** Request header authentication is in beta and only some organizations have it. If you see a **Request headers** section, pick a header name such as `authorization` or `x-api-key` and enter the value. Claude sends the value exactly as entered, so for a bearer token type `Bearer ` (with the space) before the token. You can add up to four headers. On an OAuth connection you cannot set `Authorization` as a request header, because OAuth uses it.

### Team and Enterprise

On organization plans an Owner adds the connector once, and each member then connects with their own account.

1. An Owner or Primary Owner opens **Organization settings > Connectors** (claude.ai/admin-settings/connectors). On Enterprise, a member with a custom role that includes "Manage access to Libraries" can also do this.
2. Click **Add**, then **Custom**. If asked for the connector type, choose **Web**.
3. Enter the name and URL, click **Continue** if shown, choose the authentication settings as above, and click **Add**.
4. Each member opens **Customize > Connectors**, finds the connector marked **Custom**, and clicks **Connect** to sign in. If the URL matches a Connectors Directory listing, the connector shows that service's name instead of the **Custom** label.

Adding the connector to the organization does not sign anyone in, unless it uses a shared credential such as a request header. Each member still has to click **Connect**.

### Turn the connector on in a conversation

Connectors are enabled per conversation. In a chat, click the **+** button, select **Connectors**, and switch on the ones you want. A connector that is installed but switched off contributes no tools.

### Settings you cannot change later

You cannot change authentication settings after you add a connector. To switch from no sign-in to OAuth, or to change the client ID, remove the connector and add it again. Change **Advanced > Transport** only if the server's documentation says to. A URL ending in `/sse` selects the older SSE transport; Anthropic recommends Streamable HTTP.

## Claude Desktop

Claude Desktop uses the same connectors as claude.ai. Add the remote server through **Customize > Connectors** as described above, signed in with the same account, and it appears in Desktop.

Do not add a remote URL to `claude_desktop_config.json`. That file defines local servers that Desktop starts as processes on your computer, and those are not available in claude.ai or Cowork. A remote connector is brokered through your Claude account, so its requests come from Anthropic's infrastructure and not from your machine.

## Claude Code

Claude Code connects from your own machine, so it can reach servers on a private network or VPN that claude.ai cannot. When you are signed in with a claude.ai account, connectors you added in claude.ai are also available in Claude Code automatically.

### Add the server

1. Run the add command with the HTTP transport. Claude Code tries Streamable HTTP and falls back to SSE if the server only offers that.

   ```bash
   claude mcp add --transport http example https://mcp.example.com/mcp
   ```

2. Choose a scope with `--scope`:
   - `local` (the default): only you, in the current project. Stored in `~/.claude.json`.
   - `project`: writes a `.mcp.json` file in the project to share with your team.
   - `user`: you, in every project. Stored in `~/.claude.json`.
3. If the server uses a fixed API key instead of OAuth, pass it as a header:

   ```bash
   claude mcp add --transport http example https://mcp.example.com/mcp \
     --header 'Authorization: Bearer ${EXAMPLE_TOKEN}'
   ```

   Keep the single quotes. They stop your shell from expanding `${EXAMPLE_TOKEN}`, so Claude Code stores the reference and reads the token from your environment when it connects. With double quotes the shell writes the token itself into the config, and with `--scope project` that secret ends up in the shared `.mcp.json`.

A project-scoped `.mcp.json` entry looks like this. `${VAR}` and `${VAR:-default}` are expanded from your environment, so the token stays out of the file:

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${EXAMPLE_TOKEN}"
      }
    }
  }
}
```

Claude Code asks you to approve servers from a project's `.mcp.json` the first time you run `claude` in that project. Until you approve, `claude mcp list` shows them as **Pending approval**. Some credential-style variable names, such as `ANTHROPIC_API_KEY`, `NPM_TOKEN` and `HTTPS_PROXY`, read as empty in a remote server's `url` and `headers`; use your own variable name.

### Complete the OAuth login

1. Start Claude Code and run `/mcp`.
2. Select the server marked as needing authentication and choose to authenticate. A browser opens on the authorization page.
3. Approve access. The browser redirects to `http://localhost:<port>/callback` and Claude Code stores the token.

From a terminal, `claude mcp login example` does the same. Add `--no-browser` to print the URL instead of opening it; after you sign in elsewhere, paste the full redirect URL back at the prompt. `claude mcp logout example` removes the stored token, and **Clear authentication** in `/mcp` does the same inside a session.

Claude Code registers itself automatically, with a Client ID Metadata Document (CIMD) or Dynamic Client Registration (DCR). If the authorization server supports neither, register an app with the provider and pass its client ID. `--client-secret` with no value opens a masked prompt; you can also set `MCP_CLIENT_SECRET`:

```bash
claude mcp add --transport http --client-id your-client-id --client-secret \
  --callback-port 8080 example https://mcp.example.com/mcp
```

## Check that it worked

- **claude.ai and Desktop:** under **Customize > Connectors**, the connector shows **Connected**. If it shows **Connect** or **Reconnect**, sign-in did not finish. Open the connector's page and check that every tool is listed under **Tool permissions**. Then switch the connector on with **+ > Connectors** and ask Claude to use one of its tools.
- **Claude Code:** run `claude mcp get example`. It shows **Connected**, **Needs authentication** or **Failed to connect**. On failure, an `Issue:` line gives the HTTP status or error the server returned. Inside a session, `/mcp` lists each server and its tools.

## When it fails

### claude.ai: "Couldn't reach the MCP server"

claude.ai connects from Anthropic's cloud, so the server must be reachable from the public internet over IPv4. Common causes:

- The hostname resolves to a private, loopback or carrier-grade NAT address, or only to IPv6. This is why a server can work in Claude Code or `curl` on your laptop and still fail in claude.ai. Use a public host or a tunnel such as Cloudflare Tunnel or ngrok.
- A firewall, WAF or CDN blocks or rate-limits Anthropic's requests. Allow both outbound ranges on Anthropic's IP address page, `160.79.104.0/21` and `153.61.208.0/20`, and remove old `34.162.x.x` entries, which are phased out.
- OAuth discovery fails: the well-known metadata paths return `404`, or the `401` has no `resource_metadata` pointer. See [Failed to discover OAuth metadata](/learn/mcp-error-failed-to-discover-oauth-metadata) and the [401 checklist](/learn/remote-mcp-server-401-unauthorized).

### claude.ai: "Authorization with the MCP server failed"

The sign-in started but did not complete. Anthropic's documentation and maintainers ([#5826](https://github.com/anthropics/claude-code/issues/5826)) trace most of these to the server:

- The authorization server does not allow the exact callback `https://claude.ai/api/mcp/auth_callback`. See [invalid_redirect_uri](/learn/mcp-error-invalid-redirect-uri).
- The server does not support PKCE `S256`, or its discovery, registration or token endpoints take longer than 10 seconds to answer.
- A redirect to another host dropped the `Authorization` header, or the token's audience does not match the MCP server's URL.
- The token endpoint rejected the authorization code it had just issued (reported in #5826).
- The registration response returned `client_secret_expires_at` as a decimal number (reported in #5826). RFC 7591 requires an integer, and Claude rejects the response.

Copy the `ofid_` value from the error page's URL when you report a failure. It is time-limited, so report promptly in the anthropics/claude-ai-mcp repository, which is where claude.ai and Desktop connector bugs belong.

### claude.ai: the connector is added but Claude never uses it

Open **+ > Connectors** in the conversation and check that it is switched on. On Team and Enterprise, check that you clicked **Connect** yourself; the Owner adding it is not enough. If the connector is on and still lists nothing, follow [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools).

### Claude Code: "Incompatible auth server: does not support dynamic client registration"

The authorization server will not register Claude Code automatically. Create an OAuth app with the provider, register `http://localhost:<port>/callback` as its redirect URI, and add the server again with `--client-id`, `--client-secret` and a matching `--callback-port`. [Does not support dynamic client registration](/learn/mcp-error-dynamic-client-registration) explains the options.

### Claude Code: redirect URI mismatch after sign-in

By default Claude Code picks a random callback port, and its client metadata declares both `http://localhost/callback` and `http://127.0.0.1/callback`. Providers that require an exact redirect URI reject it. Either fix the port with `--callback-port` and register that exact URL, or, if you run the authorization server, accept both loopback forms on any port. v2.1.229 briefly sent `127.0.0.1` instead of `localhost`; v2.1.231 and later send `localhost` again, so update if you are on that build.

### Claude Code: OAuth works interactively but not in scripts

`claude -p` and Agent SDK runs cannot open a browser. Sign in once from an interactive session with `/mcp`; the stored token is then reused. If you configured a fixed `Authorization` header, Claude Code uses it as the credential and does not fall back to OAuth, so remove the header if the server expects OAuth.

### Claude Code: 403 insufficient_scope on a tool call

The token is valid but lacks a scope the tool needs. If you pinned scopes in the server's `oauth.scopes` setting, add the missing scope there. Then run `/mcp` and authenticate the server again.

## Verify the endpoint before you add it

Most Claude connector failures come from the server, not from Claude. Open the [MCP Playground](/), paste the endpoint and click **Connect** before you add it to Claude. **Logs & Events** shows the `401` challenge, every OAuth discovery request and the tool list as the server returns them. For OAuth problems, the [MCP OAuth checker](/tools/oauth-check) tests each discovery step without signing in. A link such as `https://mcptest.io/server/mcp.example.com/mcp` opens the playground with `https://mcp.example.com/mcp` already filled in.
