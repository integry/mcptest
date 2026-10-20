---
title: How to add a remote MCP server to Claude
navTitle: Add a server to Claude
summary: Step-by-step setup for remote MCP servers in claude.ai custom connectors, Claude Desktop and Claude Code, with the plan differences and the real failure modes for each.
track: use
level: newcomer
order: 20
category: Client setup
readingTimeMinutes: 7
lastReviewed: "2026-10-20"
relatedSlugs:
  - connect-remote-mcp-server
  - mcp-clients-compared
  - remote-mcp-server-401-unauthorized
  - mcp-server-connected-but-no-tools
sourceLinks:
  - title: "Claude Help Center: Get started with custom connectors using remote MCP"
    url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
  - title: "Claude docs: Add a connector that isn't in the directory"
    url: "https://claude.com/docs/connectors/custom/add-unlisted"
  - title: "Claude docs: Authentication for connectors"
    url: "https://claude.com/docs/connectors/building/authentication"
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

Claude has three places where a remote MCP server can be added, and they are configured differently:

| Surface | Where the server is added | Where requests come from |
| --- | --- | --- |
| claude.ai (web and mobile) | Custom connectors | Anthropic's cloud |
| Claude Desktop | The same custom connectors, through your Claude account | Anthropic's cloud |
| Claude Code | `claude mcp add` or a `.mcp.json` file | Your own machine |

This guide reflects the claude.ai connector documentation reviewed on 20 October 2026 and Claude Code v2.1.304 (19 October 2026). It covers remote servers only. If you have not yet confirmed that your URL is a working MCP endpoint, read [How to connect to a remote MCP server](/learn/connect-remote-mcp-server) first.

## Compatibility at a glance

<!-- compat-matrix clients="claude-ai,claude-desktop,claude-code" limitations="true" -->

## claude.ai custom connectors

Custom connectors are available on Free, Pro, Max, Team and Enterprise plans. Free accounts are limited to one custom connector. The steps differ between individual plans and organization plans.

### Free, Pro and Max

1. Open **Customize > Connectors** (claude.ai/customize/connectors).
2. Click **+ Add**, then **Add custom connector**.
3. Enter the **MCP server URL**, for example `https://mcp.example.com/mcp`.
4. Under **Authentication**, choose **Sign in now**, **Sign in when needed** or **No sign-in**, depending on what the server requires.
5. Under **OAuth client**, keep **Use Claude's published identity (Recommended)** unless the server's documentation says otherwise. The other options are **Register automatically** (Dynamic Client Registration) and **Use your own OAuth client**, which takes a client ID and secret. In some accounts these fields appear under **Advanced settings** instead.
6. Save. If you chose to sign in now, a browser window opens on the server's authorization page. Check the address before you sign in.

### Team and Enterprise

On organization plans an Owner adds the connector once and each member connects to it separately.

1. An Owner or Primary Owner opens **Organization settings > Connectors** (claude.ai/admin-settings/connectors). On Enterprise, a custom role with "Manage access to Libraries" can also do this.
2. Click **Add**, then **Custom**, then **Web**, and fill in the same URL and authentication fields as above.
3. Each member opens **Customize > Connectors**, finds the connector marked **Custom**, and clicks **Connect** to sign in with their own account.

Unless the connector uses a shared credential, adding it to the organization does not sign anyone in. Each member still has to click **Connect**.

### Turn the connector on in a conversation

Connectors are enabled per conversation. In a chat, click the **+** button, select **Connectors**, and switch on the ones you want. A connector that is installed but switched off contributes no tools.

### Settings you cannot change later

Authentication settings cannot be edited after the connector is saved. To switch from no sign-in to OAuth, or to change the client ID, remove the connector and add it again. Change **Advanced > Transport** only if the server's documentation asks for it. A URL ending in `/sse` selects the older SSE transport; Claude recommends Streamable HTTP.

## Claude Desktop

Claude Desktop uses the same connectors as claude.ai. Add the remote server through **Customize > Connectors** as described above, signed in with the same account, and it appears in Desktop.

Do not add a remote URL to `claude_desktop_config.json`. That file (opened through **Settings > Developer > Edit Config**) defines local servers that Desktop starts as processes on your computer. Servers configured there are not available in claude.ai or Cowork. A remote connector, on the other hand, is brokered through your Claude account, so its requests come from Anthropic's infrastructure and not from your machine.

## Claude Code

Claude Code connects from your own machine, so it can reach servers on a private network or VPN that claude.ai cannot.

### Add the server

1. Run the add command with the HTTP transport:

   ```bash
   claude mcp add --transport http example https://mcp.example.com/mcp
   ```

2. Choose a scope with `--scope`. `local` is the default and applies only to you in the current project. `project` writes a `.mcp.json` file to share with your team. `user` makes the server available in all your projects.
3. If the server uses a fixed API key instead of OAuth, pass it as a header:

   ```bash
   claude mcp add --transport http example https://mcp.example.com/mcp \
     --header 'Authorization: Bearer ${EXAMPLE_TOKEN}'
   ```

   Keep the single quotes. They stop your shell from expanding `${EXAMPLE_TOKEN}`, so Claude Code stores the reference and reads the token from your environment when it connects. With double quotes the shell substitutes the token itself, and with `--scope project` that secret ends up in the shared `.mcp.json`.

4. Run `claude mcp list`. Each server shows **Connected**, **Needs authentication** or **Failed to connect**.

A project-scoped `.mcp.json` entry looks like this. `${VAR}` and `${VAR:-default}` are expanded from your environment, so the token itself stays out of the file:

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

### Complete the OAuth login

1. Start Claude Code and run `/mcp`.
2. Select the server marked as needing authentication and choose to authenticate. A browser opens on the authorization page.
3. Approve access. The browser redirects to `http://localhost:<port>/callback` and Claude Code stores the token.

From a terminal, `claude mcp login example` does the same. Add `--no-browser` to print the URL instead of opening it. `claude mcp logout example` removes the stored token, and **Clear authentication** in `/mcp` does the same from inside a session.

If the authorization server does not support automatic registration, register an app with the provider and pass its credentials. `--client-secret` with no value opens a masked prompt:

```bash
claude mcp add --transport http --client-id your-client-id --client-secret \
  --callback-port 8080 example https://mcp.example.com/mcp
```

## When it fails

### claude.ai: "Couldn't reach the MCP server"

claude.ai connects from Anthropic's cloud, so the server must be reachable from the public internet over IPv4. Common causes:

- The hostname resolves to a private, loopback or carrier-grade NAT address, or only to IPv6. This is why a server can work in Claude Code or `curl` on your laptop and still fail in claude.ai. Use a public host or a tunnel such as Cloudflare Tunnel or ngrok.
- A firewall, WAF or CDN blocks or rate-limits Anthropic's requests. Allow the outbound range `160.79.104.0/21` and remove any old `34.162.x.x` entries.
- OAuth discovery fails: the well-known metadata paths return `404`, or the `401` has no `resource_metadata` pointer. See the [401 checklist](/learn/remote-mcp-server-401-unauthorized).

### claude.ai: "Authorization with the MCP server failed"

Older reports show the banner "There was an error connecting to the MCP server. Please check your server URL and make sure your server handles auth correctly." The OAuth flow never visibly starts. Anthropic's maintainers traced several of these reports ([#5826](https://github.com/anthropics/claude-code/issues/5826)) to server-side faults:

- The token endpoint rejected the authorization code it had just issued.
- The registration response returned `client_secret_expires_at` as a decimal number. RFC 7591 requires an integer, and Claude rejects the response.
- The authorization server does not allow the exact callback `https://claude.ai/api/mcp/auth_callback`.
- The server does not support PKCE `S256`, or its discovery, registration or token endpoints take longer than 10 seconds to answer.
- A redirect to another host dropped the `Authorization` header, or the token's audience does not match the MCP server's URL.

Copy the `ofid_` value from the error page's URL when you report a failure. It expires, so file it promptly in the anthropics/claude-ai-mcp repository, which is where claude.ai and Desktop connector bugs belong.

### claude.ai: the connector is added but Claude never uses it

Open **+ > Connectors** in the conversation and check that it is switched on. On Team and Enterprise, check that you clicked **Connect** yourself; the Owner adding it is not enough. If the connector is on and still lists nothing, follow [MCP server connected but no tools](/learn/mcp-server-connected-but-no-tools).

### Claude Code: "Incompatible auth server: does not support dynamic client registration"

The authorization server will not register Claude Code automatically. Create an OAuth app with the provider, register `http://localhost:<port>/callback` as its redirect URI, and add the server again with `--client-id`, `--client-secret` and a matching `--callback-port`.

### Claude Code: redirect URI mismatch after sign-in

By default Claude Code picks a random callback port. Providers that require an exact redirect URI reject it. Fix the port with `--callback-port` and register that exact URL. v2.1.229 briefly sent `127.0.0.1` instead of `localhost` and caused mismatches; v2.1.231 and later send `localhost` again, so update if you are on that build.

### Claude Code: OAuth works interactively but not in scripts

`claude -p` and Agent SDK runs cannot open a browser. Sign in once from an interactive session with `/mcp`; the stored token is then reused. A server that rejects a fixed `Authorization` header does not fall back to OAuth, so remove the header if the server expects OAuth.

### Claude Code: 403 insufficient_scope on a tool call

The token is valid but lacks a scope that the tool needs. Add the scope to the server's `oauth.scopes` setting, then use **Clear authentication** in `/mcp` and sign in again.

## Verify the endpoint before you add it

Most Claude connector failures come from the server rather than Claude. Open the [MCP Playground](/), paste the endpoint and connect before you add it to Claude. The playground shows the `401` challenge, every OAuth discovery request, and the tool list exactly as the server returns them. A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
