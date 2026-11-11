---
title: "Bot protection blocking MCP clients: Cloudflare, Vercel and AWS WAF fixes"
navTitle: Bot protection and WAFs
summary: How CDN and WAF bot rules, challenges and rate limits break MCP endpoints, OAuth discovery documents and token endpoints, how to recognise a blocked request from its status and headers, how to add exceptions on Cloudflare, Vercel and AWS WAF, and how to confirm the fix.
track: build
level: practitioner
order: 37
category: Deployment
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "Bot Protection Blocking MCP Clients: Cloudflare, Vercel, AWS WAF | mcptest.io"
metaDescription: "Why Cloudflare Bot Fight Mode, Vercel Attack Mode and AWS WAF Bot Control block MCP clients and OAuth discovery, how to spot challenge responses, add path exceptions and confirm the fix."
relatedSlugs:
  - mcp-error-failed-to-discover-oauth-metadata
  - mcp-error-posting-to-endpoint
  - remote-mcp-server-401-unauthorized
  - deploy-remote-mcp-server
sourceLinks:
  - title: "Cloudflare: Bot Fight Mode"
    url: "https://developers.cloudflare.com/bots/get-started/bot-fight-mode/"
  - title: "Cloudflare: Super Bot Fight Mode"
    url: "https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/"
  - title: "Cloudflare: skip options for custom rules"
    url: "https://developers.cloudflare.com/waf/custom-rules/skip/options/"
  - title: "Cloudflare: detect a challenge page response"
    url: "https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/"
  - title: "Cloudflare: rate limiting rule parameters"
    url: "https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/"
  - title: "Vercel: Attack Mode"
    url: "https://vercel.com/docs/vercel-firewall/attack-mode"
  - title: "Vercel: Bot Management"
    url: "https://vercel.com/docs/bot-management"
  - title: "Vercel: system bypass rules"
    url: "https://vercel.com/docs/vercel-firewall/vercel-waf/system-bypass-rules"
  - title: "AWS WAF: CAPTCHA and Challenge actions"
    url: "https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html"
  - title: "AWS WAF: Bot Control rule group"
    url: "https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-bot.html"
  - title: "Anthropic: IP addresses"
    url: "https://platform.claude.com/docs/en/api/ip-addresses"
  - title: "OpenAI: IP addresses"
    url: "https://developers.openai.com/api/docs/guides/ip-addresses"
---

Bot protection is built for websites: it decides whether a visitor is a person in a browser and challenges or blocks whatever is not. An MCP client is never a person in a browser. It is a desktop app, a CLI, or a backend in a data center, and it expects JSON. When an edge rule answers with a challenge page, the client sees HTML where it expected a JSON-RPC response or an OAuth metadata document, and reports a parse failure, a failed OAuth discovery, or a connection error that never mentions the firewall.

## Which requests are at risk

| Request | Who sends it | Expected answer |
| --- | --- | --- |
| `POST /mcp` (your endpoint path) | The MCP client | JSON or an SSE stream, or `401` with `WWW-Authenticate` |
| `GET /.well-known/oauth-protected-resource` and its path-suffixed form | The MCP client | JSON |
| `GET /.well-known/oauth-authorization-server` or `/.well-known/openid-configuration` | The MCP client | JSON |
| Registration and token endpoints (`POST`) | The MCP client | JSON |
| Authorization endpoint (`GET`) | The user's browser | HTML login page |

Only the last row comes from a browser that can solve a challenge. Everything else must reach your origin untouched.

The origin of the traffic matters too. Claude connects to remote MCP servers "from Anthropic's cloud infrastructure, rather than from your local device", on every Claude client ([Claude help center](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)), and ChatGPT's connector traffic comes from OpenAI's published egress ranges. Rules that score data-center traffic as automated hit those requests first.

## Recognising a blocked request

The client's error rarely says "firewall". Look at the raw response instead:

| Platform | What the edge sends |
| --- | --- |
| Cloudflare challenge | A `cf-mitigated: challenge` header and `Content-Type: text/html` ([Cloudflare](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)) |
| Cloudflare block | `403`, from "WAF Custom or Managed Rules with the challenge or block action"; the `cf-ray` value identifies the request |
| Cloudflare rate limiting rule | `429` by default, configurable from 400 to 499 |
| AWS WAF Challenge | `202` with `x-amzn-waf-action: challenge` ([AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html)) |
| AWS WAF CAPTCHA | `405` with `x-amzn-waf-action: captcha` |
| AWS WAF Block, including rate-based rules | `403` by default, unless the rule sets a custom response |
| Vercel rate limiting | `429` by default ([Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)) |

Vercel does not document a challenge response header, so on Vercel check which firewall features are active when a non-browser request gets an HTML response.

On the client side, the symptoms are the generic ones: a JSON parse error that mentions `<`, ["Failed to discover OAuth metadata"](/learn/mcp-error-failed-to-discover-oauth-metadata), ["Error POSTing to endpoint"](/learn/mcp-error-posting-to-endpoint) with an HTML body, or a `202` or `405` that the client treats as a protocol violation. None of these, nor a `403` with an HTML body and no `WWW-Authenticate` header, proves where the response came from: your origin, a framework error page or a reverse proxy can send the same thing. Treat them as reasons to look further, and attribute the failure to bot protection only when you have provider evidence: a challenge header from the table above, such as `cf-mitigated` or `x-amzn-waf-action`, or a matching entry in the edge's security log (for example, by Ray ID or request ID) with no corresponding request in your origin's logs.

On Cloudflare, search Security Events for the Ray ID: "The event shows which security feature and rule blocked the request" ([Cloudflare](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1020/)).

## Cloudflare

**Bot Fight Mode**, the free-plan feature, cannot be scoped to some paths: "You cannot bypass or skip Bot Fight Mode using WAF custom rules or Page Rules." Cloudflare warns it "may challenge API or mobile app traffic", and its documented options are to turn it off or move to Super Bot Fight Mode, which supports exceptions ([Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)).

**Super Bot Fight Mode** (Pro, Business and Enterprise) runs after custom rules. Create a custom rule with the **Skip** action that matches the MCP paths, and select **All Super Bot Fight Mode rules** ([Super Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/)). The same rule can also skip rate limiting rules, managed rules and products such as Browser Integrity Check, which "challenges visitors without a user agent or with a non-standard user agent" ([skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/)). An expression for the paths above:

```text
(http.request.uri.path eq "/mcp")
or starts_with(http.request.uri.path, "/.well-known/oauth-")
or (http.request.uri.path eq "/.well-known/openid-configuration")
or (http.request.uri.path in {"/oauth/token" "/oauth/register"})
```

Replace `/mcp` and the OAuth paths with your own, and put the authorization server's paths on its host if it runs elsewhere.

**Bot Management** (Enterprise) "does not block or challenge traffic on its own"; your own custom rules act on the bot score. Add a path condition to those rules rather than a skip.

**Rate limiting rules** count requests by IP on most plans, and many users of a hosted client share a few egress addresses. Raise the threshold for the MCP paths, or, with Advanced Rate Limiting, count by a header that identifies the user ([rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)).

**AI crawler and agent policies** in the Bots settings apply to "Verified bots with that behavior and matching unverified bots". Cloudflare uses Allow for agents by default on new domains; if someone changed that to Block, check whether your MCP clients are matched ([AI bots](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/)).

## Vercel

**Attack Mode** makes every visitor pass a challenge, and Vercel warns that "Standalone APIs, other backend frameworks, and non-recognized automated services may not be able to pass challenges and could be blocked" ([Attack Mode](https://vercel.com/docs/vercel-firewall/attack-mode)). The firewall evaluates Attack Mode before custom rules, and Vercel documents no per-path exception for it, so a custom rule cannot save the MCP path while it is on. **System bypass rules** take IP addresses or CIDR ranges, not paths ([system bypass rules](https://vercel.com/docs/vercel-firewall/vercel-waf/system-bypass-rules)). Turn Attack Mode on for the shortest window you can, and expect MCP clients to fail while it runs.

The **Bot Protection managed ruleset**, inactive by default, serves "a JavaScript challenge to traffic that is unlikely to be a browser" in challenge mode. If you enable it, add a custom rule with the **Bypass** action for the MCP and OAuth paths; Vercel recommends bypass rules "for trusted automated traffic" ([Bot Management](https://vercel.com/docs/bot-management)). The **AI Bots** ruleset can block the AI Assistants category, "Bots that retrieve pages in response to user actions", as well as crawlers, so leave assistants allowed for an MCP project or bypass the same paths ([managed rulesets](https://vercel.com/docs/vercel-firewall/vercel-waf/managed-rulesets)).

## AWS WAF

The **Bot Control** managed rule group blocks traffic that MCP clients produce by default. `SignalNonBrowserUserAgent` blocks user agents that "don't seem to be from a web browser. This category can include API requests", `CategoryHttpLibrary` covers HTTP libraries, and `SignalKnownBotDataCenter` blocks bots in data centers ([Bot Control](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-bot.html)). Exclude the MCP paths with a scope-down statement on the rule group:

```json
{
  "NotStatement": {
    "Statement": {
      "OrStatement": {
        "Statements": [
          {
            "ByteMatchStatement": {
              "SearchString": "/mcp",
              "FieldToMatch": { "UriPath": {} },
              "TextTransformations": [{ "Priority": 0, "Type": "NONE" }],
              "PositionalConstraint": "EXACTLY"
            }
          },
          {
            "ByteMatchStatement": {
              "SearchString": "/.well-known/",
              "FieldToMatch": { "UriPath": {} },
              "TextTransformations": [{ "Priority": 0, "Type": "NONE" }],
              "PositionalConstraint": "STARTS_WITH"
            }
          }
        ]
      }
    }
  }
}
```

Add a statement for the token and registration paths if they are on the same host.

**Challenge and CAPTCHA** actions only work for browsers loading pages. AWS says to send them only "in response to GET text/html requests" and that "You can't run either the puzzle or the challenge in response to POST requests". Never put them in front of `POST /mcp`.

**Rate-based rules** block with `403` unless you set a custom response. Configure `429` with a `Retry-After` header on the MCP paths, so clients and agents can tell throttling from a denial.

## Allowlisting by IP address

Hosted clients publish their egress ranges. Anthropic lists `160.79.104.0/21` and `153.61.208.0/20` as the addresses it "uses for outbound requests (for example, when making MCP tool calls to external servers)" ([Anthropic IP addresses](https://platform.claude.com/docs/en/api/ip-addresses)). OpenAI publishes the ranges for "Plugins, connectors, GPT Actions" at `openai.com/chatgpt-connectors.json` and says they can change, so fetch the file regularly ([OpenAI IP addresses](https://developers.openai.com/api/docs/guides/ip-addresses)).

An IP allowlist only covers those hosted clients. Desktop apps and CLIs connect from users' own networks, so a path exception is still the general fix. Neither replaces authentication: an exception removes bot scoring from the MCP paths, and the server still answers `401` without a valid token.

## Confirming the fix

Fetch each document the way a client would, from outside a browser and ideally from a cloud machine such as a CI runner:

```bash
curl -sS -D - -o /dev/null https://mcp.example.com/.well-known/oauth-protected-resource

curl -sS -D - -X POST https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The metadata request should return `200` with `application/json`. The POST should return JSON, an SSE stream, or a `401` with `WWW-Authenticate`; even a JSON-RPC error proves the request reached your server. A `cf-mitigated` or `x-amzn-waf-action` header means the edge still answered. A `text/html` body, a `202`, a `405` or a bare `403` only means something is still wrong: check the edge's security events and your origin's request logs for that request before deciding whether the edge or your server sent it.

Then run the [OAuth checker](/tools/oauth-check): it lists the status and `Content-Type` of every metadata request it makes, so a possible block or challenge stands out as a `403`, a `429` or a `text/html` row; confirm it with the response headers and logs as above. Finally, connect in the [playground](/) and in each client you support, and make several calls in a row to make sure no rate limit trips.

## FAQ

### Why does my server work in a browser but not in Claude or ChatGPT?

A browser solves challenges and carries clearance cookies; MCP clients do neither. Their requests also come from data centers, which bot scoring treats differently from your own connection.

### Is it safe to turn off bot protection for the MCP path?

Exempt the paths from bot scoring and challenges, and keep everything else: authentication on every request, per-user rate limits, request size limits and normal WAF managed rules.

### My OAuth metadata URL returns 403. Is it my server?

Not necessarily. A `403` with an HTML body and no `WWW-Authenticate` is worth investigating, but your server, framework or proxy can send one too. It points to the edge only if the response carries a provider challenge header such as `cf-mitigated` or `x-amzn-waf-action`, or the edge's security log records the block and your origin's logs show no matching request. If the origin did receive it, fix your authorization code; see [401 Unauthorized](/learn/remote-mcp-server-401-unauthorized) for the responses your server should send.
