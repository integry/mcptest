# OAuth pre-login sweep — October 2026

Started: 2026-10-25T01:10:25.944Z. Completed 182/182 catalog OAuth entries.

Run manually with Node 22: `npm run oauth-sweep -- --report docs/oauth-sweep-2026-10.md`. Sequential requests, 300 ms between requests, 12-second timeout per request. Uses the real `beginOAuthFlow`, SDK discovery, provider policies, PKCE and redirect construction. Redirect URI: https://mcptest.io/oauth/callback. No login, credentials, callback completion or token exchange. Public registrations are reused from a local, untracked cache; at most one registration POST per server per run. This Node probe cannot establish browser CORS compatibility. A responding HTML page is only a pre-login result, never proof of end-to-end authorization.

Counts: {"server non-compliance": 26, "unsupported client mode": 43, "pre-login success": 64, "transient": 49, "mcptest bug": 0}.

## Findings and before/after counts

The initial full sweep began at 2026-10-25T01:02:17Z. The full re-sweep began at 2026-10-25T01:10:25Z; 38 sequential targeted follow-ups began at 2026-10-25T01:18:22Z. Each row and request section below uses the latest observation for that server. All 182 validation entries reporting OAuth were included, rather than only the prominent catalog entries.

Three mcptest bug classes affected five catalog servers. **Misdiagnosed server cases: 5 before → 0 after**, confirmed by recorded-fixture regression tests and the live re-sweep:

| Affected server | Before: mcptest bug | After |
| --- | --- | --- |
| GitHub | HTTP 200 discovery at the catalog's slashless /mcp URL bypassed the trusted GitHub policy; the inspector suggested a generic public client ID. | Both exact /mcp and /mcp/ aliases use the issuer-bound GitHub policy, operator application guidance and PAT alternative. Unknown paths, queries and issuers remain untrusted. |
| Dropbox | Registration HTTP 403, registration_not_supported, explicitly limited access to pre-registered trusted partners; the inspector recommended retrying registration. | Provider approval prerequisite, with the arbitrary client form suppressed. |
| Harness | Registration HTTP 403, insufficient_scope, explicitly rejected an untrusted host/domain; the inspector recommended retrying registration. | Provider approval prerequisite. The recorded test also exercises RFC 8414/OIDC issuer-path fallback. |
| ZoomInfo | Registration HTTP 400, invalid_client_metadata, said the vendor was not in the approved vendor list; the inspector suggested correcting metadata. | Provider approval prerequisite. |
| Similarweb | Both authorization-server discovery URLs returned HTTP 403 with a CloudFront block page, which mcptest treated as proof of absent metadata and used to offer endpoint overrides. | Access-denied discovery guidance; endpoint overrides are offered only for actual missing-document HTTP 404/410 responses. The live block remains transient/unverified. |

The source fixtures in src/utils/fixtures/oauth-sweep record the public discovery documents and rejection bodies used by the regression tests. No live network is used in these unit tests.

| Probe outcome | Initial exploratory sweep | Final reviewed sweep |
| --- | ---: | ---: |
| Pre-login HTML success | 101 | 64 |
| Unsupported client mode | 11 | 43 |
| Server non-compliance / incompatible response | 67 | 26 |
| Transient or headless-unverified | 3 | 49 |
| Total servers | 182 | 182 |

The initial aggregate classifications preceded stricter login-page checks and client-mode classification. In particular, an empty SPA shell, a WAF response or embedded CAPTCHA library no longer automatically proves either login success or a server defect. These aggregate differences are **not a causal before/after measure of OAuth compatibility**. The five corrected diagnostic cases are counted separately above; the fixes do not claim to make provider approval or confidential applications unnecessary.

## Interpretation and reproduction

- Run npm run oauth-sweep with Node 22. It uses the repository's existing vite-node runner. Optional --only github,linear restricts the probe; --report chooses the Markdown destination; --delay sets the sequential delay (minimum 100 ms); --cache chooses the local registration cache.
- This run used the app's direct public-client path, the production redirect URI and published CIMD document. No operator relay or pre-registered credentials were supplied. A confidential registration response is an unsupported mode for this credential-free run, not proof that the deployed hosted relay cannot support that provider.
- The local cache at ~/.cache/mcptest/oauth-sweep-clients.json contains only public issuer-bound client IDs and public authentication-method information. Tokens, registration access tokens, client secrets, PKCE verifiers, authorization state and cookies are never persisted. Rejected registrations are not cached as successful clients.
- Transient includes timeouts, WAF blocks and responses that cannot establish a login page without JavaScript or an anonymous browser session. The script does not retain cookies or execute page JavaScript. These are unverified observations, not conformance failures. A pre-login success still does not establish CORS, consent or token-exchange success.
- Servers accepting anonymous initialize are still subjected to OAuth discovery: authorization can be enforced on later MCP operations. This alone does not disprove catalog authentication notes, so catalogValidation.json was left unchanged.
- Server-author fixes and browser guidance are linked from the inspector to [the OAuth reference](../src/content/articles/mcp-oauth-2-1-reference.md#pre-login-troubleshooting). They cover resource/issuer mismatches, missing S256, callback allowlists, rejected CIMD, closed registration and transient blocks. The existing public client ID form remains available for providers that support it.
- This manual script is outside the browser import graph and has no live CI job. Unit tests use recorded fixtures only.

Validation: npm run typecheck; npm test (4,146 passed, 21 skipped); npm run build; npm run test:e2e -- --workers=1 (60 passed). The default two-worker browser run hit the 30-second catalog accessibility timeout twice; the complete single-worker run passed both scans without test or timeout changes.

## Per-server results

| Server / endpoint | Last step | Classification | Evidence / exact failure |
| --- | --- | --- | --- |
| semgrep (https://mcp.semgrep.ai/mcp) | Authorization URL | server non-compliance | Authorization error callback: ?error=invalid_target&state=[REDACTED] Last HTTP failure: POST https://mcp.semgrep.ai/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication required"} |
| github (https://api.githubcopilot.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: GitHub Remote MCP does not support Dynamic Client Registration. The host must configure a GitHub App or OAuth App; its confidential configuration and token exchange must remain in the mcptest operator service. Alternatively, use a valid GitHub personal access token as the target Authorization credential. Last HTTP failure: POST https://api.githubcopilot.com/mcp → HTTP 401: bad request: missing required Authorization header |
| linear (https://mcp.linear.app/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: read write |
| notion (https://mcp.notion.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: default |
| sentry (https://mcp.sentry.dev/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: org:read project:write team:write event:write alerts:write |
| atlassian (https://mcp.atlassian.com/v1/mcp/authv2) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 202: JavaScript is disabled In order to continue, we need to verify that you're not a robot. This requires JavaScript. Enable JavaScript and then reload the page. Last HTTP failure: POST https://mcp.atlassian.com/v1/mcp/authv2 → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"} |
| paypal (https://mcp.paypal.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| stripe (https://mcp.stripe.com/) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: mcp |
| slack (https://mcp.slack.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: Slack MCP requires a fixed registered Slack app with a client ID and client secret. The app must be directory-published or internal, and its secret and token exchange must be configured by the mcptest operator rather than in the browser. Last HTTP failure: POST https://mcp.slack.com/mcp → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"missing_token"}} |
| cloudflare (https://mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: user:read account:read offline_access |
| figma (https://mcp.figma.com/mcp) | dynamic_client_registration | unsupported client mode | provider_approval_required: mcptest.io is not yet an approved Figma MCP client. Figma only permits clients accepted into its MCP Catalog; client developers must use Figma's published approval and waitlist process. Last HTTP failure: POST https://api.figma.com/v1/oauth/mcp/register → HTTP 403: Forbidden |
| supabase (https://mcp.supabase.com/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://mcp.supabase.com/mcp → HTTP 401: {"message":"No access token provided"} |
| neon (https://mcp.neon.tech/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://mcp.neon.tech/mcp → HTTP 401: {"error":"invalid_token","error_description":"No authorization provided"} |
| vercel (https://mcp.vercel.com/) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid offline_access |
| asana (https://mcp.asana.com/v2/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: app.asana.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://mcp.asana.com/v2/mcp → HTTP 401: {"error":"invalid_request","error_description":"Authorization header is required for MCP V2 access"} |
| canva (https://mcp.canva.com/mcp) | Authorization URL | server non-compliance | Authorization endpoint returned an error instead of a login page. HTTP 400: Invalid redirect URI. Last HTTP failure: GET https://mcp.canva.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.canva.com%2Fmcp → HTTP 400: Invalid redirect URI. |
| gitlab (https://gitlab.com/api/v4/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration selected a token authentication method that the authorization server does not advertise. Last HTTP failure: POST https://gitlab.com/api/v4/mcp → HTTP 401: {"message":"401 Unauthorized"} |
| miro (https://mcp.miro.com/) | dynamic_client_registration | unsupported client mode | Dynamic registration selected a token authentication method that the authorization server does not advertise. Last HTTP failure: POST https://mcp.miro.com/ → HTTP 401: {"error":"Authentication required"} |
| circleci (https://mcp.circleci.com/v1/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: app.circleci.com rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://app.circleci.com/oauth/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"no supported redirect_uri: expected an RFC 8252 loopback URI ([REDACTED] [REDACTED] or [REDACTED] or a supported hosted redirect"} |
| pagerduty (https://mcp.pagerduty.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: PagerDuty advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://mcp.pagerduty.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication required: the token is invalid or has expired."} |
| airtable (https://mcp.airtable.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 403: Verify it’s you — Airtable Verify it’s you Our systems have detected unusual traffic from your computer network. Please help us with a quick security check to validate it’s you sending this request. This may be happening because: Javascript is disabled or blocked by an e Last HTTP failure: GET https://airtable.com/login?continue=%5BREDACTED%5D → HTTP 403: Verify it’s you — Airtable Verify it’s you Our systems have detected unusual traffic from your computer network. Please help us with a quick security check to validate it’s you sending this request. This may be happening because: Javascript is disabled or blocked by an extension (ad blockers for example) Your browser does not support cookies Please |
| clickup (https://mcp.clickup.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: ClickUp Message supplied by app.component.ts Retry ClickUp is best experienced using our mobile app. Our web app has features so BIG, they won't fit on a small screen. Open in free mobile app Continue on web anyway ClickUp is best experienced using our mobile app. Our we Last HTTP failure: POST https://mcp.clickup.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Bearer [REDACTED] required","resource_metadata":"https://mcp.clickup.com/.well-known/oauth-protected-resource/mcp"} |
| intercom (https://mcp.intercom.com/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: Intercom rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://mcp.intercom.com/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Redirect URI https://mcptest.io/oauth/callback is not in the allowlist, reach out to Intercom Customer Support if you believe we should support it"} |
| docusign-developer (https://mcp-d.docusign.com/mcp) | authorization_server_metadata | server non-compliance | discovery_blocked_invalid: OAuth discovery could not be completed at the authorization server metadata stage. Check the exact discovery request in the OAuth flight recorder. Server authors: serve JSON protected-resource metadata at the challenged resource_metadata URL or the path-suffixed/root well-known location, and publish RFC 8414 or OIDC metadata whose issuer exactly ma Last HTTP failure: GET https://mcp-d.docusign.com/.well-known/oauth-protected-resource/mcp → HTTP 403: RBAC: access denied |
| calendly (https://mcp.calendly.com/) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Calendly Last HTTP failure: POST https://mcp.calendly.com/ → HTTP 401: {"error":"invalid_token","error_description":"Authentication failed. The provided Bearer [REDACTED] is invalid, expired, or no longer recognized by the server. To resolve: clear authentication tokens in your MCP client and reconnect. Your client should automatically re-register and obtain new tokens."} |
| hugging-face (https://huggingface.co/mcp?login) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: Hugging Face – The AI community building the future. Hugging Face Models Datasets Spaces Buckets new Docs Enterprise Pricing Website Tasks HuggingChat Collections Languages Organizations Community Blog Posts Daily Papers Hardware Learn Discord Forum GitHub Solutions Team Last HTTP failure: POST https://huggingface.co/mcp?login=%5BREDACTED%5D → HTTP 401: Unauthorized |
| upwork (https://mcp.upwork.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 403: Attention Required! \| Cloudflare Please enable cookies. Sorry, you have been blocked You are unable to access upwork.com Why have I been blocked? This website is using a security service to protect itself from online attacks. The action you just performed triggered the s Last HTTP failure: GET https://www.upwork.com/ab/account-security/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.upwork.com%2Fmcp → HTTP 403: Attention Required! \| Cloudflare Please enable cookies. Sorry, you have been blocked You are unable to access upwork.com Why have I been blocked? This website is using a security service to protect itself from online attacks. The action you just performed triggered the security solution. There are several actions that could trigger this block inclu |
| ref (https://api.ref.tools/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Ref - Review the Plan before the Code. Last HTTP failure: POST https://api.ref.tools/mcp → HTTP 401: {"error":"Unauthorized - Authentication required"} |
| tavily (https://mcp.tavily.com/mcp) | Authorization URL | server non-compliance | Authorization endpoint returned an error instead of a login page. HTTP 400: Tavily Tavily Oops!, something went wrong There could be a misconfiguration in the system or a service outage. We track these errors automatically, but if the problem persists feel free to contact us. Please try again. TECHNICAL DETAILS See details for this error SUPPORT su Last HTTP failure: GET https://auth.tavily.com/u/login/identifier?state=%5BREDACTED%5D → HTTP 400: Tavily Tavily Oops!, something went wrong There could be a misconfiguration in the system or a service outage. We track these errors automatically, but if the problem persists feel free to contact us. Please try again. TECHNICAL DETAILS See details for this error SUPPORT support@tavily.com invalid_request : You may have pressed the back button, ref |
| firecrawl (https://mcp.firecrawl.dev/v2/mcp-oauth) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: firecrawl:global offline_access |
| cloudflare-workers-bindings (https://bindings.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-workers-builds (https://builds.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-observability (https://observability.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-radar (https://radar.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-browser-run (https://browser.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-containers (https://containers.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-ai-gateway (https://ai-gateway.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-autorag (https://autorag.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-audit-logs (https://auditlogs.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| cloudflare-graphql (https://graphql.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| netlify (https://netlify-mcp.netlify.app/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Netlify Opens in a new tab The Netlify dashboard needs JavaScript :( You can enable JavaScript in your browser settings . Last HTTP failure: POST https://netlify-mcp.netlify.app/mcp → HTTP 401: {"error":"unauthenticated","error_description":"You must authenticate to use this tool"} |
| render (https://mcp.render.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: api.render.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://mcp.render.com/mcp → HTTP 401 |
| railway (https://mcp.railway.com/) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: workspace:member offline_access |
| prisma (https://mcp.prisma.io/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: workspace:admin offline_access |
| planetscale (https://mcp.pscale.dev/mcp/planetscale) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://mcp.pscale.dev/mcp/planetscale → HTTP 401: {"jsonrpc":"2.0","id":1,"error":{"code":"[REDACTED]","message":"unauthorized access"}} |
| google-bigquery (https://bigquery.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| instantdb (https://mcp.instantdb.com/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration selected a token authentication method that the authorization server does not advertise. Last HTTP failure: POST https://mcp.instantdb.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"} |
| sanity (https://mcp.sanity.io/) | Authorization URL | transient | Empty or script-only page; login page unverified. HTTP 200: Last HTTP failure: POST https://mcp.sanity.io/ → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"} |
| square (https://mcp.squareup.com/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: mcp.squareup.com rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://mcp.squareup.com/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Invalid redirect URI: https://mcptest.io/oauth/callback - domain not in allowlist"} |
| sumup (https://mcp.sumup.com/mcp) | authorization_server_metadata | server non-compliance | discovery_blocked_invalid: OAuth discovery could not be completed at the authorization server metadata stage. Check the exact discovery request in the OAuth flight recorder. Server authors: serve JSON protected-resource metadata at the challenged resource_metadata URL or the path-suffixed/root well-known location, and publish RFC 8414 or OIDC metadata whose issuer exactly ma Last HTTP failure: POST https://mcp.sumup.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"} |
| axiom (https://mcp.axiom.co/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| globalping (https://mcp.globalping.dev/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: measurements |
| buildkite (https://mcp.buildkite.com/mcp) | Authorization URL | server non-compliance | Authorization endpoint returned an error instead of a login page. HTTP 403: Login to Buildkite Skip to main content Buildkite logo Welcome back! Login with GitHub Login with SSO or You must log in to see this page Email address Password Forgot password? Don't have an account? Start with our all-access 30 day trial By logging in, you agree to the Bu Last HTTP failure: GET https://buildkite.com/oauth/authorize?access_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&client_name=%5BREDACTED%5D&client_redirect_uri=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.buildkite.com%2Foauth%2Fcallback%2Fbuildkite&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 403: Login to Buildkite Skip to main content Buildkite logo Welcome back! Login with GitHub Login with SSO or You must log in to see this page Email address Password Forgot password? Don't have an account? Start with our all-access 30 day trial By logging in, you agree to the Buildkite Terms of Service |
| jam (https://mcp.jam.dev/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://mcp.jam.dev/mcp → HTTP 401: {"error":"invalid_token","error_description":"Access token is missing or invalid"} |
| workos (https://mcp.workos.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| mapbox (https://mcp.mapbox.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Mapbox Last HTTP failure: POST https://mcp.mapbox.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Unauthorized","data":{"error":"Bearer [REDACTED] required","authorization_server":"https://mcp.mapbox.com/oauth-authorization-server"}}} |
| amplitude (https://mcp.amplitude.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Amplitude Last HTTP failure: POST https://mcp.amplitude.com/mcp → HTTP 401: {"error":"invalid_request","error_description":"Missing authorization header"} |
| mixpanel (https://mcp.mixpanel.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: projects analysis events insights segmentation retention data:read funnels flows data_definitions alerts annotations bookmarks business_context cohorts context custom_alerts custom_events custom_properties dashboard_reports experiments feature_flags metrics user_details |
| posthog (https://mcp.posthog.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid profile email introspection action:read action:write access_control:read access_control:write account:read account:write activity_log:read alert:read alert:write annotation:read annotation:write approvals:read approvals:write autoresearch:read autoresearch:write batch_export:read batch_export:write billing:read business_knowledge:read business_knowledge:write canvas:read canvas:write cohort:read cohort:write comment:read comment:write conversation:read cross_project_dashboard:read customer_analytics:read customer_analytics:write customer_task:read customer_task:write data_catalog:read data_catalog:write data_catalog_approval:write dashboard:read dashboard:write dashboard_template:read dataset:read dataset:write early_access_feature:read early_access_feature:write endpoint:read endpoint:write engineering_analytics:read error_tracking:read error_tracking:write evaluation:read evaluation:write element:read event_definition:read event_definition:write experiment:read experiment:write experiment_holdout:read experiment_holdout:write experiment_saved_metric:read experiment_saved_metric:write external_data_source:read external_data_source:write feature_flag:read feature_flag:write group:read health_issue:read heatmap:read heatmap:write hog_flow:read hog_flow:write hog_function:read hog_function:write insight:read insight:write insight_variable:write integration:read integration:write llm_analytics:read llm_analytics:write ai_observability_clusters:read ai_observability_clusters:write llm_prompt:read llm_prompt:write llm_provider_key:read llm_skill:read llm_skill:write logs:read logs:write marketing_analytics:read marketing_analytics:write mcp_analytics:read mcp_analytics:write mcp_registry:read metrics:read notebook:read notebook:write offline_evaluation_ingestion:write organization:read organization:write organization_member:read person:read person:write product_enablement:write project:read project:write property_definition:read property_definition:write query:read replay_scanner:read replay_scanner:write review_hog:read review_hog:write session_recording:read session_recording:write session_recording_playlist:read session_recording_playlist:write signal_scout:read signal_scout:write stamphog:read stamphog:write streamlit_app:read streamlit_app:write subscription:read subscription:write survey:read survey:write tagger:read ticket:read ticket:write task:read task:write tracing:read field_note:read field_note:write uploaded_media:read uploaded_media:write usage_metric:read usage_metric:write user:read user:write vision_alert:read vision_alert:write visual_review:read visual_review:write warehouse_objects:write warehouse_table:read warehouse_table:write warehouse_view:read warehouse_view:write web_analytics:read web_analytics:write |
| pendo (https://app.pendo.io/mcp/v0/shttp) | Authorization URL | transient | Empty or script-only page; login page unverified. HTTP 200: Last HTTP failure: POST https://app.pendo.io/mcp/v0/shttp → HTTP 401: the token could not be validated |
| attio (https://mcp.attio.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Attio Last HTTP failure: POST https://mcp.attio.com/mcp → HTTP 401: {"statusCode":401,"error":"Unauthorized","message":"The requesting user did not present an authentication token","status_code":401} |
| close (https://mcp.close.com/mcp) | dynamic_client_registration | unsupported client mode | Dynamic OAuth registration returned unsupported response_types. Last HTTP failure: POST https://mcp.close.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication required"} |
| make (https://mcp.make.com/) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://mcp.make.com/ → HTTP 401: {"code":"[REDACTED]","name":"Access denied","message":"Unauthorized.","details":[]} |
| apify (https://mcp.apify.com/) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Apify Console Thinking . . . Last HTTP failure: POST https://mcp.apify.com/ → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token. Pass an Apify API token in the Authorization: Bearer <token> header. Manage tokens at https://console.apify.com/account/integrations"} |
| box (https://mcp.box.com/) | pre_registered_client | unsupported client mode | pre_registered_client_required: api.box.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://mcp.box.com/ → HTTP 401 |
| dropbox (https://mcp.dropbox.com/mcp) | dynamic_client_registration | unsupported client mode | provider_approval_required: www.dropbox.com advertises automatic client registration, but rejected this client. Provider approval or allow-list access is required before mcptest.io can continue. Last HTTP failure: POST https://www.dropbox.com/oauth2/register → HTTP 403: {"error":"registration_not_supported","error_description":"Dynamic client registration is not supported. Only pre-registered MCP trusted partners are allowed."} |
| todoist (https://ai.todoist.net/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: data:read_write |
| granola (https://mcp.granola.ai/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: mcp offline_access |
| fireflies (https://api.fireflies.ai/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: email profile |
| resend (https://mcp.resend.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| wix (https://mcp.wix.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: offline_access |
| cloudinary-asset-management (https://asset-management.mcp.cloudinary.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: Cloudinary - Management Console Login Products Programmable Media Powerful image and video APIs for editing, hosting, and global content distribution for Websites and Cloud Apps. Dynamic Asset Management A single source of truth for managing the entire digital asset life Last HTTP failure: POST https://asset-management.mcp.cloudinary.com/mcp → HTTP 401: {"error":"unauthorized","error_description":"Authentication required. Provide either OAuth Bearer [REDACTED] or API key headers.","request_id":"24a10b598a9138c6a9e281d75e15af96"} |
| mem0 (https://mcp.mem0.ai/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration selected a token authentication method that the authorization server does not advertise. Last HTTP failure: POST https://mcp.mem0.ai/mcp/ → HTTP 401: {"error":"invalid_token","error_description":"Authentication required"} |
| datadog (https://mcp.datadoghq.com/v1/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| grafana-cloud (https://mcp.grafana.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: grafana:read grafana:query grafana:write |
| honeycomb (https://mcp.honeycomb.io/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: mcp:read mcp:write |
| hubspot (https://mcp.hubspot.com/) | pre_registered_client | unsupported client mode | pre_registered_client_required: mcp.hubspot.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://mcp.hubspot.com/ → HTTP 401 |
| pipedrive (https://mcp.pipedrive.ai/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: oauth.pipedrive.com rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://oauth.pipedrive.com/oauth/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Invalid redirect URI"} |
| klaviyo (https://mcp.klaviyo.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| monday (https://mcp.monday.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: monday.com: Your team&#39;s growth made easy \| Sign Up Last HTTP failure: POST https://mcp.monday.com/mcp → HTTP 401: {"errors":["Not Authenticated"]} |
| wrike (https://mcp.wrike.com/v2) | pre_registered_client | unsupported client mode | pre_registered_client_required: login.wrike.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://mcp.wrike.com/v2 → HTTP 401: Unauthorized |
| smartsheet (https://mcp.smartsheet.com/) | authorization_server_metadata | server non-compliance | Incompatible authorization server: validated metadata does not advertise PKCE S256 support. Server authors: implement S256 and publish code_challenge_methods_supported: ["S256"] in authorization-server metadata. See https://mcptest.io/learn/mcp-oauth-2-1-reference Last HTTP failure: POST https://mcp.smartsheet.com/ → HTTP 401 |
| egnyte (https://mcp-server.egnyte.com/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://mcp-server.egnyte.com/mcp → HTTP 401 |
| mongodb-atlas (https://mcp.mongodb.com/) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Cloud: MongoDB Cloud Last HTTP failure: POST https://mcp.mongodb.com/ → HTTP 401: {"error":401,"reason":"Unauthorized","detail":"You are not authorized for this resource."} |
| paddle (https://mcp.paddle.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| ramp (https://mcp.ramp.com/mcp) | dynamic_client_registration | server non-compliance | Dynamic OAuth registration returned an invalid client_secret. Last HTTP failure: POST https://mcp.ramp.com/mcp → HTTP 401: {"detail":"No access token provided"} |
| mercury (https://mcp.mercury.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Mercury \| Banking for Startups You need to enable JavaScript to use Mercury. Last HTTP failure: GET https://mcp.mercury.com/.well-known/oauth-protected-resource/mcp → HTTP 404: Error Cannot GET /.well-known/oauth-protected-resource/mcp |
| postman (https://mcp.postman.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| webflow (https://mcp.webflow.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| stytch (https://mcp.stytch.dev/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Stytch Last HTTP failure: POST https://mcp.stytch.dev/mcp → HTTP 401: Unauthorized |
| aws (https://aws-mcp.us-east-1.api.aws/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: us-east-1.oauth.signin.aws rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://us-east-1.oauth.signin.aws/v1/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"The redirection URI https://mcptest.io/oauth/callback is not allowed by this server."} |
| google-compute-engine (https://compute.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| google-kubernetes-engine (https://container.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| google-cloud-run (https://run.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| google-cloud-resource-manager (https://cloudresourcemanager.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| digitalocean-apps (https://apps.mcp.digitalocean.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: DigitalOcean You need to enable JavaScript to run this app. Last HTTP failure: POST https://apps.mcp.digitalocean.com/mcp → HTTP 401: missing or invalid Bearer [REDACTED] |
| digitalocean-databases (https://databases.mcp.digitalocean.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: DigitalOcean You need to enable JavaScript to run this app. Last HTTP failure: POST https://databases.mcp.digitalocean.com/mcp → HTTP 401: missing or invalid Bearer [REDACTED] |
| digitalocean-droplets (https://droplets.mcp.digitalocean.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: DigitalOcean You need to enable JavaScript to run this app. Last HTTP failure: POST https://droplets.mcp.digitalocean.com/mcp → HTTP 401: missing or invalid Bearer [REDACTED] |
| heroku (https://mcp.heroku.com/mcp) | Authorization URL | server non-compliance | Authorization error callback: ?error=invalid_request&error_description=unsupported+prompt+value+requested&state=[REDACTED]&iss=https%3A%2F%2Fmcp.heroku.com Last HTTP failure: GET https://mcp.heroku.com/.well-known/oauth-protected-resource/mcp → HTTP 404: Not Found |
| pulumi (https://mcp.ai.pulumi.com/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: GET https://mcp.ai.pulumi.com/.well-known/oauth-protected-resource/mcp → HTTP 404: Error Cannot GET /.well-known/oauth-protected-resource/mcp |
| fly-sprites (https://sprites.dev/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: sprites:read sprites:write |
| google-alloydb (https://alloydb.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| google-firestore (https://firestore.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| google-spanner (https://spanner.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| clickhouse-cloud (https://mcp.clickhouse.cloud/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: ClickHouse Last HTTP failure: POST https://mcp.clickhouse.cloud/mcp → HTTP 401: {"error":"Authentication required"} |
| motherduck (https://api.motherduck.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: mcp:connect |
| google-cloud-logging (https://logging.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| google-cloud-monitoring (https://monitoring.googleapis.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: accounts.google.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. |
| new-relic (https://mcp.newrelic.com/mcp) | client_establishment | server non-compliance | Protected resource https://mcp.newrelic.com/mcp/ does not match expected https://mcp.newrelic.com/mcp (or origin) Last HTTP failure: POST https://mcp.newrelic.com/mcp → HTTP 401: {"error":"unauthorized","error_description":"Authentication required: provide either 'api-key' header with New Relic API key or 'Authorization: Bearer <token>' header","authentication_options":{"api_key":"[REDACTED]","oauth2":{"description":"OAuth 2.0 Bearer [REDACTED]","header":"Authorization","format":"Bearer <token>","resource_url":"https://mcp. |
| better-stack (https://mcp.betterstack.com/) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: read write |
| pydantic-logfire (https://logfire-us.pydantic.dev/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: `. --> Pydantic Logfire Last HTTP failure: POST https://logfire-us.pydantic.dev/mcp → HTTP 401 |
| raygun (https://api.raygun.com/v3/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: applications:read applications:write apm:read customers:read deployments:read deployments:write cr.errors:read cr.errors:write invitations:read invitations:write metrics:errors metrics:pages rum.pages:read rum.sessions:read tracing.traces:read offline_access |
| rootly (https://mcp.rootly.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 403: Just a moment... Enable JavaScript and cookies to continue Last HTTP failure: GET https://rootly.com/users/sign_in → HTTP 403: Just a moment... Enable JavaScript and cookies to continue |
| incident-io (https://mcp.incident.io/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: incident.io You need to enable JavaScript to run this app. Last HTTP failure: POST https://mcp.incident.io/mcp → HTTP 401: no Bearer [REDACTED] |
| cloudflare-dex (https://dex.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| braintrust (https://api.braintrust.dev/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Braintrust - The active observability platform for agents Build agents your users can trust Trace everything Measure quality with evals Catch issues early Created Input Factuality Helpfulness Sentiment 1 Jan 25 2:34 PM Hi! What&#x27;s the status of order #12345? 94% 91% 82% 2 Jan 25 Last HTTP failure: POST https://api.braintrust.dev/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Authentication required. Include 'Authorization: Bearer <token>' header.","data":"All MCP methods require OAuth authentication. Complete OAuth flow first."},"id":1} |
| replicate (https://mcp.replicate.com/sse) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| fal (https://mcp.fal.ai/mcp-relay) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid profile email offline_access |
| parallel-task (https://task-mcp.parallel.ai/mcp) | dynamic_client_registration | unsupported client mode | Dynamic OAuth registration returned unsupported grant_types. Last HTTP failure: POST https://task-mcp.parallel.ai/mcp → HTTP 401: {"error":"Authentication required","detail":"Missing x-api-key or Authorization header. Please provide a valid API key."} |
| you-com (https://api.you.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: You need to enable JavaScript to run this app. Last HTTP failure: POST https://api.you.com/mcp → HTTP 401: Unauthorized: OAuth authentication required |
| valyu (https://mcp.valyu.ai/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid email profile offline_access |
| bright-data (https://mcp.brightdata.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: Bright Data - Control Panel Last HTTP failure: POST https://mcp.brightdata.com/mcp → HTTP 401 |
| algolia (https://mcp.algolia.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 403: Just a moment... Enable JavaScript and cookies to continue Last HTTP failure: GET https://dashboard.algolia.com/users/sign_in?redirect_to=%5BREDACTED%5D → HTTP 403: Just a moment... Enable JavaScript and cookies to continue |
| expo (https://mcp.expo.dev/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: mcp:access |
| bitrise (https://mcp.bitrise.io/) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: Log in - Bitrise Last HTTP failure: POST https://mcp.bitrise.io/ → HTTP 401: {"error":"unauthorized","error_description":"authentication required"} |
| harness (https://mcp.harness.io/mcp) | dynamic_client_registration | unsupported client mode | provider_approval_required: id.harness.io advertises automatic client registration, but rejected this client. Provider approval or allow-list access is required before mcptest.io can continue. Last HTTP failure: POST https://id.harness.io/idp/realms/HarnessIDP/clients-registrations/openid-connect → HTTP 403: {"error":"insufficient_scope","error_description":"Policy 'DCR Trusted hosts ' rejected request to client-registration service. Details: URL doesn't match any trusted host or trusted domain"} |
| launchdarkly (https://mcp.launchdarkly.com/mcp/launchdarkly) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| statsig (https://api.statsig.com/v3/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| port (https://mcp.port.io/v1) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Port Last HTTP failure: POST https://mcp.port.io/v1 → HTTP 401: {"error":"no token provided","ok":false} |
| kong-konnect (https://global.mcp.konghq.com/) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: GET https://konnect-global.us.identity.konghq.com/.well-known/openid-configuration/auth → HTTP 404: {"type":"https://kongapi.info/konnect/not-found","status":404,"title":"Not Found","detail":"The resource requested was not found."} |
| greptile (https://api.greptile.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: read write offline_access |
| kernel (https://mcp.onkernel.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid |
| mux (https://mcp.mux.com/) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: mux Last HTTP failure: POST https://mcp.mux.com/ → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Unauthorized: Missing Authorization header"}} |
| alchemy (https://mcp.alchemy.com/mcp) | Authorization URL | server non-compliance | Authorization endpoint returned an error instead of a login page. HTTP 400: {"error":"invalid_request","error_description":"redirect_uri not allowed"} Last HTTP failure: GET https://auth.alchemy.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.alchemy.com%2Fmcp → HTTP 400: {"error":"invalid_request","error_description":"redirect_uri not allowed"} |
| contentful (https://mcp.contentful.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| storyblok (https://mcp.storyblok.com/mcp) | Authorization URL | server non-compliance | Authorization endpoint returned an error instead of a login page. HTTP 400: {"error":"invalid_redirect_uri","error_description":"redirect_uri must be a loopback URL (http://localhost/ or 127.0.0.1) per RFC 8252, or a recognized hosted-connector callback URL"} Last HTTP failure: GET https://mcp.storyblok.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.storyblok.com%2Fmcp → HTTP 400: {"error":"invalid_redirect_uri","error_description":"redirect_uri must be a loopback URL (http://localhost/ or 127.0.0.1) per RFC 8252, or a recognized hosted-connector callback URL"} |
| prismic (https://mcp.prismic.io/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: mcp.prismic.io rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://mcp.prismic.io/register → HTTP 400: {"error":"invalid_client_metadata","error_description":"Redirect URI not allowed: https://mcptest.io/oauth/callback"} |
| hygraph (https://mcp.hygraph.com/mcp) | Authorization URL | server non-compliance | Authorization endpoint returned an error instead of a login page. HTTP 400: Hygraph Hygraph Oops!, something went wrong There could be a misconfiguration in the system or a service outage. We track these errors automatically, but if the problem persists feel free to contact us. Please try again. TECHNICAL DETAILS See details for this error SUPPORT  Last HTTP failure: GET https://auth.hygraph.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.hygraph.com%2Fmcp → HTTP 400: Hygraph Hygraph Oops!, something went wrong There could be a misconfiguration in the system or a service outage. We track these errors automatically, but if the problem persists feel free to contact us. Please try again. TECHNICAL DETAILS See details for this error SUPPORT Get Help support@hygraph.com invalid_request : Unknown client: https://mcpte |
| builder-cms (https://mcp.builder.io/mcp/publish) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Builder.io: Collaborative Development Platform Last HTTP failure: POST https://mcp.builder.io/mcp/publish → HTTP 401: {"status":401,"error":"unauthorized","message":"Authorization required","resource_metadata":"https://mcp.builder.io/.well-known/oauth-protected-resource/mcp/publish"} |
| lovable (https://mcp.lovable.dev/) | Authorization URL | server non-compliance | Authorization endpoint returned an error instead of a login page. HTTP 400: Authorization failed - Lovable Authorization failed: Client not supported This app identifies itself with a client ID URL on mcptest.io, which Lovable does not support yet. Error code: [REDACTED] Last HTTP failure: GET https://lovable.dev/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.lovable.dev%2F → HTTP 400: Authorization failed - Lovable Authorization failed: Client not supported This app identifies itself with a client ID URL on mcptest.io, which Lovable does not support yet. Error code: [REDACTED] |
| vanta (https://mcp.vanta.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Vanta Last HTTP failure: POST https://mcp.vanta.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"} |
| gitguardian (https://mcp.gitguardian.com/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: mcp.gitguardian.com rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://mcp.gitguardian.com/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Public clients may only use http://localhost,/ http://127.0.0.1,/ or an approved redirect URI; none of the provided redirect_uris qualify: ['https://mcptest.io/oauth/callback']"} |
| clerk (https://mcp.clerk.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: user:org:read applications:read applications:manage users:read users:manage organizations:read application_domains:read application_domains:manage offline_access |
| descope (https://mcp.descope.com/) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: You need to enable JavaScript to run this app. Last HTTP failure: POST https://mcp.descope.com/ → HTTP 401: Missing Authorization header |
| cloudflare-casb (https://casb.mcp.cloudflare.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| razorpay (https://mcp.razorpay.com/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://mcp.razorpay.com/mcp → HTTP 401: {"error":{"description":"Please provide your api key for authentication purposes","code":"[REDACTED]"}} |
| mollie (https://mcp.mollie.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| polar (https://mcp.polar.sh/mcp/polar-mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: benefits:read checkout_links:read checkouts:read custom_fields:read customer_meters:read customer_seats:read customers:read discounts:read events:read files:read license_keys:read members:read meters:read metrics:read orders:read organizations:read payments:read products:read refunds:read subscriptions:read webhooks:read benefits:write checkout_links:write custom_fields:write customer_seats:write customers:write discounts:write events:write files:write license_keys:write members:write meters:write orders:write products:write refunds:write subscriptions:write webhooks:write |
| xero (https://api.xero.com/mcp/v1) | pre_registered_client | unsupported client mode | pre_registered_client_required: identity.xero.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://api.xero.com/mcp/v1 → HTTP 401 |
| alpha-vantage (https://mcp.alphavantage.co/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: mcp.alphavantage.co rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://mcp.alphavantage.co/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Invalid redirect URI: https://mcptest.io/oauth/callback"} |
| financial-datasets (https://mcp.financialdatasets.ai/) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: stock-market-data |
| hex (https://app.hex.tech/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Hex Last HTTP failure: POST https://app.hex.tech/mcp → HTTP 401: Unauthorized |
| fullstory (https://api.fullstory.com/mcp/fullstory) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: playback:read search:read search.metadata:read sessions:read users.metadata:read users:list metrics:read metrics.funnel:read metrics.page:read library.objects:read library.spaces:read playback.spec:read playback.page.definitions:read specs.mappings:read settings.own:read settings.own:write |
| logrocket (https://mcp.logrocket.com/mcp) | Authorization URL | transient | Anonymous browser session or cookies required; login page unverified. HTTP 400: This sign-in link has expired This sign-in link has expired Return to your MCP client and start connecting to LogRocket again. Last HTTP failure: GET https://mcp.logrocket.com/interaction/[REDACTED] → HTTP 400: This sign-in link has expired This sign-in link has expired Return to your MCP client and start connecting to LogRocket again. |
| semrush (https://mcp.semrush.com/v2/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: oauth.semrush.com rejected dynamic client registration with HTTP 400, but the response did not indicate a provider approval or allow-list policy. Retry registration or configure an existing OAuth client. Last HTTP failure: POST https://api.semrush.com/apis/v4-raw/auth/v1/oauth2/register → HTTP 400: {"code":"[REDACTED]","message":"redirect URI https://mcptest.io/oauth/callback is not allowed","retryable":false} |
| ahrefs (https://api.ahrefs.com/mcp/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 403: Just a moment... Enable JavaScript and cookies to continue Last HTTP failure: GET https://app.ahrefs.com/web/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.ahrefs.com%2F → HTTP 403: Just a moment... Enable JavaScript and cookies to continue |
| similarweb (https://mcp.similarweb.com/) | authorization_server_metadata | transient | discovery_blocked_invalid: OAuth discovery could not be completed at the authorization server metadata stage. Check the exact discovery request in the OAuth flight recorder. HTTP 403 denies access; it does not prove that metadata is missing. Check authorization and WAF rules on the well-known endpoint. Server authors: serve JSON protected-resource metadata at the challenged  Last HTTP failure: GET https://mcp-auth.similarweb.com/.well-known/openid-configuration → HTTP 403: ERROR: The request could not be satisfied 403 ERROR The request could not be satisfied. Request blocked. We can't connect to the server for this app or website at this time. There might be too much traffic or a configuration error. Try again later, or contact the app or website owner. If you provide content to customers through CloudFront, you can  |
| salesforce (https://api.salesforce.com/platform/mcp/v1/platform/sobject-all) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: login.salesforce.com rejected dynamic client registration with HTTP 401, but the response did not indicate a provider approval or allow-list policy. Retry registration or configure an existing OAuth client. Last HTTP failure: POST https://login.salesforce.com/services/oauth2/register → HTTP 401: {"error":"invalid_client","error_description":"invalid client credentials"} |
| apollo (https://mcp.apollo.io/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: Apollo Last HTTP failure: POST https://mcp.apollo.io/mcp → HTTP 401: {"error":"Unauthorized: Missing or invalid Authorization header for one of [initialize]","error_details":{"code":"[REDACTED]","message":"This MCP request carried no Bearer [REDACTED] in the Authorization header.","suggestions":[{"label":"Start the OAuth flow using the resource_metadata URL in the WWW-Authenticate header","header":"WWW-Authenticate" |
| zoominfo (https://mcp.zoominfo.com/mcp) | dynamic_client_registration | unsupported client mode | provider_approval_required: mcp.zoominfo.com advertises automatic client registration, but rejected this client. Provider approval or allow-list access is required before mcptest.io can continue. Last HTTP failure: POST https://mcp.zoominfo.com/oauth/register → HTTP 400: {"error":"invalid_client_metadata","error_description":"Vendor with name mcptest-io was not found in approved vendors"} |
| gong (https://mcp.gong.io/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: mcp.gong.io rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://app.gong.io/oauth2/register → HTTP 400: {"error":"invalid_client_metadata","error_description":"token_endpoint_auth_method is unsupported"} |
| braze (https://mcp.braze.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: mcp:tools mcp:resources mcp:operator |
| customer-io (https://mcp.customer.io/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Customer.io Last HTTP failure: POST https://mcp.customer.io/mcp → HTTP 401: {"message":"Authorization required"} |
| common-room (https://mcp.commonroom.io/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Common Room Last HTTP failure: POST https://mcp.commonroom.io/mcp → HTTP 401: {"error":"unauthorized","message":"Authentication required. Reconnect the MCP server to sign in again."} |
| agentmail (https://mcp.agentmail.to/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid email profile user:org:read offline_access |
| infobip-sms (https://mcp.infobip.com/sms) | dynamic_client_registration | unsupported client mode | Dynamic OAuth registration returned unsupported response_types. Last HTTP failure: GET https://auth.infobip.com/.well-known/openid-configuration/realms/infobip → HTTP 403: 403 Forbidden Request forbidden by administrative rules. |
| front (https://mcp.frontapp.com/mcp) | pre_registered_client | unsupported client mode | pre_registered_client_required: app.frontapp.com advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider, with redirect URI https://mcptest.io/oauth/callback and Authorization Code with PKCE S256. Enter its public client ID below; confidential client secrets require operator setup. Last HTTP failure: POST https://mcp.frontapp.com/mcp → HTTP 401: {"error":"Missing authentication token."} |
| gorgias (https://mcp.gorgias.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid email profile offline account:read account:write users:read users:write customers:read customers:write segments:read tickets:read tickets:write custom_fields:read custom_fields:write events:read integrations:read integrations:write service_connection:read jobs:read jobs:write macros:read macros:write rules:read rules:write routines:read routines:write satisfaction_survey:read satisfaction_survey:write statistics:read tags:read tags:write apps:read apps:write help_center:read help_center:write ecommerce:read ecommerce:write billing:read |
| plain (https://mcp.plain.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: openid offline_access |
| coda (https://coda.io/apis/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required. Last HTTP failure: POST https://coda.io/apis/mcp → HTTP 401: {"statusCode":401,"statusMessage":"Unauthorized","message":"Unauthorized"} |
| cal-com (https://mcp.cal.com/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| otter (https://mcp.otter.ai/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: profile:read conversations:read |
| shortcut (https://mcp.shortcut.com/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Shortcut Last HTTP failure: POST https://mcp.shortcut.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Unauthorized"},"id":1} |
| plane (https://mcp.plane.so/http/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration selected a token authentication method that the authorization server does not advertise. Last HTTP failure: POST https://mcp.plane.so/http/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication failed. The provided Bearer [REDACTED] is invalid, expired, or no longer recognized by the server. To resolve: clear authentication tokens in your MCP client and reconnect. Your client should automatically re-register and obtain new tokens."} |
| productboard (https://mcp.productboard.com/) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Productboard – Welcome Last HTTP failure: POST https://mcp.productboard.com/ → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Unauthorized","data":{"resource_metadata":"https://mcp.productboard.com/.well-known/oauth-protected-resource"}}} |
| basecamp (https://mcp.basecamp.com/mcp) | Authorization URL | transient | Anonymous browser session or cookies required; login page unverified. HTTP 200: Basecamp Log In Cookies are not enabled. You'll need to enable cookies in your browser for Basecamp to work properly. Log in to Basecamp 5 Sign in with Google Or, use my email address Email or username We couldn&rsquo;t find that one. Want to try another? Please sign in Last HTTP failure: POST https://mcp.basecamp.com/mcp → HTTP 401: {"error":"Authorization required","message":"Sign in with your Basecamp account through your AI app's connect flow.","documentation":"https://basecamp.com/ai"} |
| whimsical (https://mcp.whimsical.com/mcp) | Authorization URL | transient | Anti-bot challenge; interactive browser compatibility is unverified. HTTP 200: The Visual Workspace \| Whimsical Last HTTP failure: POST https://mcp.whimsical.com/mcp → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Missing Bearer [REDACTED]"}} |
| gamma (https://mcp.gamma.app/mcp) | dynamic_client_registration | server non-compliance | discovery_blocked_invalid: auth.gamma.app rejected the submitted dynamic client metadata with HTTP 400. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured. Last HTTP failure: POST https://auth.gamma.app/oauth/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"redirect_uri not allowed: https://mcptest.io/oauth/callback"} |
| spline (https://mcp.spline.design/mcp) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Spline You need to enable JavaScript to run this app. Last HTTP failure: POST https://mcp.spline.design/mcp → HTTP 401: {"error":"unauthorized"} |
| zapier (https://mcp.zapier.com/api/v1/connect) | Authorization URL | transient | HTML received but no identifiable login or consent page. HTTP 200: Zapier MCP Zapier MCP Loading Last HTTP failure: POST https://mcp.zapier.com/api/v1/connect → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Missing authorization header or token query parameter"}} |
| airbyte (https://mcp.airbyte.ai/mcp) | Login page (no login attempted) | pre-login success | HTTP 200 HTML; PKCE S256, resource and scopes constructed by app. Scope: (none advertised) |
| contextqa (https://mcp.contextqa.com/mcp) | dynamic_client_registration | unsupported client mode | Dynamic registration selected a token authentication method that the authorization server does not advertise. Last HTTP failure: POST https://mcp.contextqa.com/mcp → HTTP 401 |

## Request evidence

Non-success response excerpts are bounded and credentials redacted. Selected follow-ups include public registration metadata fields so incompatible responses can be assessed without exposing client IDs or secrets. Metadata and registration discovery fallbacks are retained even when a later request succeeded.

### semgrep

- POST https://mcp.semgrep.ai/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication required"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.semgrep.ai/.well-known/oauth-protected-resource"
- GET https://mcp.semgrep.ai/.well-known/oauth-protected-resource → HTTP 200
- GET https://login.semgrep.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://login.semgrep.dev/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.semgrep.ai%2F → HTTP 302

### github

- POST https://api.githubcopilot.com/mcp → HTTP 401: bad request: missing required Authorization header
- WWW-Authenticate: Bearer error="invalid_request", error_description="[REDACTED]", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp"
- GET https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://github.com/.well-known/oauth-authorization-server/login/oauth → HTTP 200

### linear

- POST https://mcp.linear.app/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.linear.app/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.linear.app/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.linear.app/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.linear.app%2Fmcp → HTTP 200

### notion

- POST https://mcp.notion.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.notion.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.notion.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.notion.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.notion.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.notion.com%2Fmcp → HTTP 302
- GET https://api.notion.com/v1/oauth/authorize?client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.notion.com%2Fcallback&response_type=%5BREDACTED%5D&owner=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://app.notion.com/install-integration?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.notion.com%2Fcallback&state=%5BREDACTED%5D&owner=%5BREDACTED%5D → HTTP 200

### sentry

- POST https://mcp.sentry.dev/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.sentry.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.sentry.dev/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.sentry.dev%2Fmcp → HTTP 200

### atlassian

- POST https://mcp.atlassian.com/v1/mcp/authv2 → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.atlassian.com/.well-known/oauth-protected-resource/v1/mcp/authv2", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.atlassian.com/.well-known/oauth-protected-resource/v1/mcp/authv2 → HTTP 200
- GET https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3 → HTTP 200
- GET https://auth.atlassian.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.atlassian.com%2Fv1%2Fmcp%2Fauthv2 → HTTP 302
- GET https://id.atlassian.com/login?continue=%5BREDACTED%5D → HTTP 202

### paypal

- POST https://mcp.paypal.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.paypal.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.paypal.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.paypal.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.paypal.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.paypal.com%2Fmcp → HTTP 302
- GET https://www.paypal.com/connect?flowEntry=%5BREDACTED%5D&client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.paypal.com%2Fcallback&state=%5BREDACTED%5D → HTTP 301: Redirecting Redirecting to /connect/?flowEntry=static&amp;client_id=[REDACTED]&amp;response_type=code&amp;scope=openid+email+https%3A%2F%2Furi.paypal.com%2Fservices%2Finvoicing+https%3A%2F%2Furi.paypal.com%2Fservices%2Freporting%2Fsearch%2Fread+https%3A%2F%2Furi.paypal.com%2Fservices%2Fpaypalattributes+https%3A%2F%2Furi.paypal.com%2Fservices%2Fchec
- GET https://www.paypal.com/connect/?flowEntry=%5BREDACTED%5D&client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.paypal.com%2Fcallback&state=%5BREDACTED%5D → HTTP 302
- GET https://www.paypal.com/signin?intent=%5BREDACTED%5D&ctxId=%5BREDACTED%5D&returnUri=%5BREDACTED%5D&flowId=%5BREDACTED%5D → HTTP 200

### stripe

- POST https://mcp.stripe.com/ → HTTP 401: {"error":"Unauthorized. See https://docs.stripe.com/mcp for usage instructions.","error_code":"missing_api_key","error_description":"No valid API key provided."}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.stripe.com/.well-known/oauth-protected-resource"
- GET https://mcp.stripe.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://access.stripe.com/.well-known/oauth-authorization-server/mcp → HTTP 200
- GET https://access.stripe.com/mcp/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.stripe.com%2F → HTTP 302
- GET https://dashboard.stripe.com/login?redirect=%5BREDACTED%5D → HTTP 200

### slack

- POST https://mcp.slack.com/mcp → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"missing_token"}}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.slack.com/.well-known/oauth-protected-resource"
- GET https://mcp.slack.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.slack.com/.well-known/oauth-authorization-server → HTTP 200

### cloudflare

- POST https://mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.cloudflare.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.cloudflare.com%2Fmcp → HTTP 200

### figma

- POST https://mcp.figma.com/mcp → HTTP 401: Unauthorized
- WWW-Authenticate: Bearer resource_metadata="https://mcp.figma.com/.well-known/oauth-protected-resource", scope="[REDACTED]", authorization_uri="https://api.figma.com/.well-known/oauth-authorization-server"
- GET https://mcp.figma.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://api.figma.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://api.figma.com/v1/oauth/mcp/register → HTTP 403: Forbidden

### supabase

- POST https://mcp.supabase.com/mcp → HTTP 401: {"message":"No access token provided"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://api.supabase.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://api.supabase.com/platform/oauth/apps/register → HTTP 201

### neon

- POST https://mcp.neon.tech/mcp → HTTP 401: {"error":"invalid_token","error_description":"No authorization provided"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.neon.tech/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.neon.tech/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.neon.tech/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.neon.tech/api/register → HTTP 200

### vercel

- POST https://mcp.vercel.com/ → HTTP 401: {"error":"invalid_token","error_description":"No authorization provided"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.vercel.com/.well-known/oauth-protected-resource"
- GET https://mcp.vercel.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://vercel.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://vercel.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.vercel.com%2F → HTTP 200

### asana

- POST https://mcp.asana.com/v2/mcp → HTTP 401: {"error":"invalid_request","error_description":"Authorization header is required for MCP V2 access"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.asana.com/.well-known/oauth-protected-resource/v2", error="invalid_request", error_description="[REDACTED]"
- GET https://mcp.asana.com/.well-known/oauth-protected-resource/v2 → HTTP 200
- GET https://app.asana.com/.well-known/oauth-authorization-server → HTTP 200

### canva

- POST https://mcp.canva.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.canva.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.canva.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.canva.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.canva.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.canva.com%2Fmcp → HTTP 400: Invalid redirect URI.

### gitlab

- POST https://gitlab.com/api/v4/mcp → HTTP 401: {"message":"401 Unauthorized"}
- WWW-Authenticate: Bearer realm="[REDACTED]", scope="[REDACTED]", resource_metadata="https://gitlab.com/.well-known/oauth-protected-resource/api/v4/mcp"
- GET https://gitlab.com/.well-known/oauth-protected-resource/api/v4/mcp → HTTP 200
- GET https://gitlab.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://gitlab.com/oauth/register → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### miro

- POST https://mcp.miro.com/ → HTTP 401: {"error":"Authentication required"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.miro.com/.well-known/oauth-protected-resource"
- GET https://mcp.miro.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.miro.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.miro.com/register → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### circleci

- POST https://mcp.circleci.com/v1/mcp → HTTP 401: {"message":"You must log in first"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.circleci.com/.well-known/oauth-protected-resource/v1/mcp"
- GET https://mcp.circleci.com/.well-known/oauth-protected-resource/v1/mcp → HTTP 200
- GET https://app.circleci.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://app.circleci.com/oauth/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"no supported redirect_uri: expected an RFC 8252 loopback URI ([REDACTED] [REDACTED] or [REDACTED] or a supported hosted redirect"}

### pagerduty

- POST https://mcp.pagerduty.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication required: the token is invalid or has expired."}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.pagerduty.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.pagerduty.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://app.pagerduty.com/.well-known/oauth-authorization-server/global/oauth/anonymous → HTTP 200

### airtable

- POST https://mcp.airtable.com/mcp → HTTP 401: {"error":"UNAUTHORIZED","message":"Unauthorized"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.airtable.com/.well-known/oauth-protected-resource"
- GET https://mcp.airtable.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://airtable.com/.well-known/oauth-authorization-server/oauth2/v1 → HTTP 200
- GET https://airtable.com/oauth2/v1/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.airtable.com%2F → HTTP 302
- GET https://airtable.com/login?continue=%5BREDACTED%5D → HTTP 403: Verify it’s you — Airtable Verify it’s you Our systems have detected unusual traffic from your computer network. Please help us with a quick security check to validate it’s you sending this request. This may be happening because: Javascript is disabled or blocked by an extension (ad blockers for example) Your browser does not support cookies Please

### clickup

- POST https://mcp.clickup.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Bearer [REDACTED] required","resource_metadata":"https://mcp.clickup.com/.well-known/oauth-protected-resource/mcp"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.clickup.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.clickup.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.clickup.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.clickup.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.clickup.com%2Fmcp → HTTP 302
- GET https://app.clickup.com/api?client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.clickup.com%2Foauth%2Fcallback&response_type=%5BREDACTED%5D&state=%5BREDACTED%5D&scope=%5BREDACTED%5D → HTTP 200

### intercom

- POST https://mcp.intercom.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.intercom.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.intercom.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.intercom.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.intercom.com/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Redirect URI https://mcptest.io/oauth/callback is not in the allowlist, reach out to Intercom Customer Support if you believe we should support it"}

### docusign-developer

- POST https://mcp-d.docusign.com/mcp → HTTP 403: RBAC: access denied
- WWW-Authenticate: (absent)
- GET https://mcp-d.docusign.com/.well-known/oauth-protected-resource/mcp → HTTP 403: RBAC: access denied
- GET https://mcp-d.docusign.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp-d.docusign.com/.well-known/oauth-authorization-server → HTTP 200

### calendly

- POST https://mcp.calendly.com/ → HTTP 401: {"error":"invalid_token","error_description":"Authentication failed. The provided Bearer [REDACTED] is invalid, expired, or no longer recognized by the server. To resolve: clear authentication tokens in your MCP client and reconnect. Your client should automatically re-register and obtain new tokens."}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.calendly.com/.well-known/oauth-protected-resource"
- GET https://mcp.calendly.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://calendly.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://calendly.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.calendly.com%2F → HTTP 302
- GET https://calendly.com/app/login → HTTP 200

### hugging-face

- POST https://huggingface.co/mcp?login=%5BREDACTED%5D → HTTP 401: Unauthorized
- WWW-Authenticate: Bearer resource_metadata="https://huggingface.co/.well-known/oauth-protected-resource/mcp?login=%5BREDACTED%5D"
- GET https://huggingface.co/.well-known/oauth-protected-resource/mcp?login=%5BREDACTED%5D → HTTP 200
- GET https://huggingface.co/.well-known/oauth-authorization-server → HTTP 200
- GET https://huggingface.co/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fhuggingface.co%2Fmcp%3Flogin%3D%255BREDACTED%255D → HTTP 302
- GET https://huggingface.co/login?next=%5BREDACTED%5D → HTTP 200

### upwork

- POST https://mcp.upwork.com/mcp → HTTP 401
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.upwork.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.upwork.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.upwork.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://www.upwork.com/ab/account-security/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.upwork.com%2Fmcp → HTTP 403: Attention Required! | Cloudflare Please enable cookies. Sorry, you have been blocked You are unable to access upwork.com Why have I been blocked? This website is using a security service to protect itself from online attacks. The action you just performed triggered the security solution. There are several actions that could trigger this block inclu

### ref

- POST https://api.ref.tools/mcp → HTTP 401: {"error":"Unauthorized - Authentication required"}
- WWW-Authenticate: (absent)
- GET https://api.ref.tools/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://ref.scalekit.com/.well-known/oauth-authorization-server/resources/res_100246322321295106 → HTTP 200
- GET https://ref.scalekit.com/resources/res_100246322321295106/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.ref.tools%2Fmcp → HTTP 307: Temporary Redirect .
- GET https://auth.ref.tools/resources/res_100246322321295106/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.ref.tools%2Fmcp → HTTP 307: Temporary Redirect .
- GET https://auth.ref.tools/oauth/authorize?client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&resource=https%3A%2F%2Fapi.ref.tools%2Fmcp&resource_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://auth.ref.tools/auth/login?auth_request_id=%5BREDACTED%5D → HTTP 302
- GET https://ref.tools/mcp-oauth?login_request_id=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 200

### tavily

- POST https://mcp.tavily.com/mcp → HTTP 401
- WWW-Authenticate: Bearer scope="[REDACTED]", resource_metadata="https://mcp.tavily.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.tavily.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.tavily.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.tavily.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.tavily.com%2Fmcp → HTTP 302
- GET https://auth.tavily.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.tavily.com%2Fauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&audience=%5BREDACTED%5D → HTTP 302
- GET https://auth.tavily.com/u/login/identifier?state=%5BREDACTED%5D → HTTP 400: Tavily Tavily Oops!, something went wrong There could be a misconfiguration in the system or a service outage. We track these errors automatically, but if the problem persists feel free to contact us. Please try again. TECHNICAL DETAILS See details for this error SUPPORT support@tavily.com invalid_request : You may have pressed the back button, ref

### firecrawl

- POST https://mcp.firecrawl.dev/v2/mcp-oauth → HTTP 401: {"error":"invalid_token","error_description":"Firecrawl credentials required: OAuth access token (Authorization: Bearer [REDACTED]) or API key (x-firecrawl-api-key)"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.firecrawl.dev/.well-known/oauth-protected-resource/v2/mcp-oauth", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.firecrawl.dev/.well-known/oauth-protected-resource/v2/mcp-oauth → HTTP 200
- GET https://www.firecrawl.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://www.firecrawl.dev/api/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.firecrawl.dev%2Fv2%2Fmcp-oauth → HTTP 307
- GET https://www.firecrawl.dev/oauth/consent?client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&response_type=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.firecrawl.dev%2Fv2%2Fmcp-oauth&state=%5BREDACTED%5D&scope=%5BREDACTED%5D → HTTP 200

### cloudflare-workers-bindings

- POST https://bindings.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://bindings.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://bindings.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://bindings.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://bindings.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fbindings.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-workers-builds

- POST https://builds.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://builds.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://builds.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://builds.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://builds.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fbuilds.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-observability

- POST https://observability.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://observability.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://observability.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://observability.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://observability.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fobservability.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-radar

- POST https://radar.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://radar.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://radar.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://radar.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://radar.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fradar.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-browser-run

- POST https://browser.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://browser.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://browser.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://browser.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://browser.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fbrowser.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-containers

- POST https://containers.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://containers.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://containers.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://containers.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://containers.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fcontainers.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-ai-gateway

- POST https://ai-gateway.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://ai-gateway.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://ai-gateway.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://ai-gateway.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://ai-gateway.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fai-gateway.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-autorag

- POST https://autorag.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://autorag.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://autorag.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://autorag.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://autorag.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fautorag.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-audit-logs

- POST https://auditlogs.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://auditlogs.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://auditlogs.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auditlogs.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://auditlogs.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fauditlogs.mcp.cloudflare.com%2Fmcp → HTTP 200

### cloudflare-graphql

- POST https://graphql.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://graphql.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://graphql.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://graphql.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://graphql.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fgraphql.mcp.cloudflare.com%2Fmcp → HTTP 200

### netlify

- POST https://netlify-mcp.netlify.app/mcp → HTTP 401: {"error":"unauthenticated","error_description":"You must authenticate to use this tool"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://netlify-mcp.netlify.app/.well-known/oauth-protected-resource/mcp"
- GET https://netlify-mcp.netlify.app/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://netlify-mcp.netlify.app/.well-known/oauth-authorization-server → HTTP 200
- GET https://netlify-mcp.netlify.app/oauth-server/auth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fnetlify-mcp.netlify.app%2Fmcp → HTTP 302
- GET https://app.netlify.com/authorize?client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&state=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fnetlify-mcp.netlify.app%2Foauth-server%2Fclient-redirect&utm_source=%5BREDACTED%5D&utm_campaign=%5BREDACTED%5D&utm_content=%5BREDACTED%5D&utm_term=%5BREDACTED%5D → HTTP 200

### render

- POST https://mcp.render.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.render.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.render.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://api.render.com/.well-known/oauth-authorization-server → HTTP 200

### railway

- POST https://mcp.railway.com/ → HTTP 401: {"error":"Authentication required"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.railway.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.railway.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://backboard.railway.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://backboard.railway.com/oauth/auth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.railway.com%2F → HTTP 303
- GET https://backboard.railway.com/oauth/interaction/[REDACTED] → HTTP 302
- GET https://railway.com/oauth/error?code=%5BREDACTED%5D → HTTP 200

### prisma

- POST https://mcp.prisma.io/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.prisma.io/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.prisma.io/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auth.prisma.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://auth.prisma.io/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.prisma.io%2Fmcp → HTTP 302
- GET https://auth.prisma.io/login?returnTo=%5BREDACTED%5D → HTTP 200

### planetscale

- POST https://mcp.pscale.dev/mcp/planetscale → HTTP 401: {"jsonrpc":"2.0","id":1,"error":{"code":"[REDACTED]","message":"unauthorized access"}}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.pscale.dev/.well-known/oauth-protected-resource/mcp/planetscale"
- GET https://mcp.pscale.dev/.well-known/oauth-protected-resource/mcp/planetscale → HTTP 200
- GET https://api.planetscale.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://auth.planetscale.com/oauth/registration → HTTP 201

### google-bigquery

- POST https://bigquery.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://bigquery.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### instantdb

- POST https://mcp.instantdb.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.instantdb.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.instantdb.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.instantdb.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.instantdb.com/register → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### sanity

- POST https://mcp.sanity.io/ → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.sanity.io/.well-known/oauth-protected-resource"
- GET https://mcp.sanity.io/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.sanity.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.sanity.io/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.sanity.io%2F → HTTP 302
- GET https://api.sanity.io/v1/auth/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.sanity.io%2Foauth%2Fcallback&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&proxy_client_assertion=%5BREDACTED%5D → HTTP 302
- GET https://www.sanity.io/login?origin=%5BREDACTED%5D → HTTP 200

### square

- POST https://mcp.squareup.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.squareup.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.squareup.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.squareup.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.squareup.com/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Invalid redirect URI: https://mcptest.io/oauth/callback - domain not in allowlist"}

### sumup

- POST https://mcp.sumup.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", scope="[REDACTED]", resource_metadata="https://mcp.sumup.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.sumup.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auth.sumup.com/.well-known/oauth-authorization-server → HTTP 200

### axiom

- POST https://mcp.axiom.co/mcp → HTTP 401: No access token was sent. Sign in to this server from your client. If it was already connected, reset this server's saved authentication, then connect again.
- WWW-Authenticate: Bearer resource_metadata="https://mcp.axiom.co/.well-known/oauth-protected-resource"
- GET https://mcp.axiom.co/.well-known/oauth-protected-resource → HTTP 200
- GET https://authorization.axiom.co/.well-known/oauth-authorization-server → HTTP 200
- GET https://authorization.axiom.co/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.axiom.co%2F → HTTP 302
- GET https://auth.axiom.co/connect/login?external_auth_id=%5BREDACTED%5D → HTTP 302
- GET https://auth.axiom.co/?return_to=%5BREDACTED%5D → HTTP 307
- GET https://auth.axiom.co/?return_to=%5BREDACTED%5D&step=%5BREDACTED%5D → HTTP 200

### globalping

- POST https://mcp.globalping.dev/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.globalping.dev/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.globalping.dev/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.globalping.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.globalping.dev/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.globalping.dev%2Fmcp → HTTP 302
- GET https://auth.globalping.io/oauth/authorize?client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.globalping.dev%2Fauth%2Fcallback&state=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&scope=%5BREDACTED%5D → HTTP 302
- GET https://dash-directus.globalping.io/auth/login/github?redirect=%5BREDACTED%5D → HTTP 302
- GET https://github.com/login/oauth/authorize?client_id=%5BREDACTED%5D&scope=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fdash-directus.globalping.io%2Fauth%2Flogin%2Fgithub%2Fcallback&access_type=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://github.com/login?client_id=%5BREDACTED%5D&return_to=%5BREDACTED%5D → HTTP 200

### buildkite

- POST https://mcp.buildkite.com/mcp → HTTP 401: {"error":"access_denied","error_description":"Authentication required"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="[REDACTED]", error_description="[REDACTED]", resource_metadata="https://mcp.buildkite.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.buildkite.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.buildkite.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.buildkite.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.buildkite.com%2Fmcp → HTTP 302
- GET https://buildkite.com/oauth/authorize?access_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&client_name=%5BREDACTED%5D&client_redirect_uri=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.buildkite.com%2Foauth%2Fcallback%2Fbuildkite&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 403: Login to Buildkite Skip to main content Buildkite logo Welcome back! Login with GitHub Login with SSO or You must log in to see this page Email address Password Forgot password? Don't have an account? Start with our all-access 30 day trial By logging in, you agree to the Buildkite Terms of Service

### jam

- POST https://mcp.jam.dev/mcp → HTTP 401: {"error":"invalid_token","error_description":"Access token is missing or invalid"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.jam.dev/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.jam.dev/.well-known/oauth-protected-resource → HTTP 200
- GET https://api.jam.dev/.well-known/oauth-authorization-server → HTTP 200
- POST https://api.jam.dev/oauth/register → HTTP 201

### workos

- POST https://mcp.workos.com/mcp → HTTP 401: {"error":"unauthorized","error_description":"Authorization needed"}
- WWW-Authenticate: Bearer error="[REDACTED]", error_description="[REDACTED]", resource_metadata="https://mcp.workos.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.workos.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://signin.workos.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://signin.workos.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.workos.com%2Fmcp → HTTP 302
- GET https://signin.workos.com/?authorization_session_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D → HTTP 200

### mapbox

- POST https://mcp.mapbox.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Unauthorized","data":{"error":"Bearer [REDACTED] required","authorization_server":"https://mcp.mapbox.com/oauth-authorization-server"}}}
- WWW-Authenticate: Bearer realm="[REDACTED]", scope="[REDACTED]", error="[REDACTED]", resource_metadata="https://mcp.mapbox.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.mapbox.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.mapbox.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.mapbox.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mapbox.com%2Fmcp → HTTP 302
- GET https://api.mapbox.com/oauth/2.1/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mapbox.com%2Fmcp → HTTP 302
- GET https://account.mapbox.com/auth/authorize/?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mapbox.com%2Fmcp&version=%5BREDACTED%5D → HTTP 200

### amplitude

- POST https://mcp.amplitude.com/mcp → HTTP 401: {"error":"invalid_request","error_description":"Missing authorization header"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.amplitude.com/.well-known/oauth-protected-resource", error="invalid_request", error_description="[REDACTED]"
- GET https://mcp.amplitude.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.amplitude.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.amplitude.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.amplitude.com%2F → HTTP 302
- GET https://auth.amplitude.com/oauth2/auth?client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.amplitude.com%2F → HTTP 302
- GET https://app.amplitude.com/login?login_challenge=%5BREDACTED%5D → HTTP 200

### mixpanel

- POST https://mcp.mixpanel.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication failed. The provided Bearer [REDACTED] is invalid, expired, or no longer recognized by the server. To resolve: clear authentication tokens in your MCP client and reconnect. Your client should automatically re-register and obtain new tokens."}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.mixpanel.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.mixpanel.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auth.mixpanel.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mixpanel.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mixpanel.com%2Fmcp → HTTP 301
- GET https://mixpanel.com/oauth/authorize/?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mixpanel.com%2Fmcp → HTTP 302
- GET https://mixpanel.com/login/?next=%5BREDACTED%5D → HTTP 200

### posthog

- POST https://mcp.posthog.com/mcp → HTTP 401: No token provided, please provide a valid API token. View the documentation for more information: https://posthog.com/docs/model-context-protocol
- WWW-Authenticate: Bearer resource_metadata="https://mcp.posthog.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.posthog.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://oauth.posthog.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://oauth.posthog.com/oauth/authorize/?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.posthog.com%2Fmcp → HTTP 200

### pendo

- POST https://app.pendo.io/mcp/v0/shttp → HTTP 401: the token could not be validated
- WWW-Authenticate: Bearer resource_metadata="https://app.pendo.io/.well-known/oauth-protected-resource/mcp/v0/shttp", error="invalid_token", error_description="[REDACTED]"
- GET https://app.pendo.io/.well-known/oauth-protected-resource/mcp/v0/shttp → HTTP 200
- GET https://app.pendo.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://app.pendo.io/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapp.pendo.io%2Fmcp%2Fv0%2Fshttp → HTTP 302
- GET https://app.pendo.io/login?after=%5BREDACTED%5D → HTTP 200

### attio

- POST https://mcp.attio.com/mcp → HTTP 401: {"statusCode":401,"error":"Unauthorized","message":"The requesting user did not present an authentication token","status_code":401}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.attio.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.attio.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://app.attio.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://app.attio.com/oidc/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.attio.com%2Fmcp → HTTP 302
- GET https://app.attio.com/auth/sign-in?origin=%5BREDACTED%5D → HTTP 200

### close

- POST https://mcp.close.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication required"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.close.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.close.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://api.close.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://api.close.com/oauth2/register/ → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code","token"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### make

- POST https://mcp.make.com/ → HTTP 401: {"code":"[REDACTED]","name":"Access denied","message":"Unauthorized.","details":[]}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.make.com/.well-known/oauth-protected-resource"
- GET https://mcp.make.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://www.make.com/.well-known/oauth-authorization-server/mcp → HTTP 200
- POST https://www.make.com/oauth/v2/register/mcp → HTTP 201

### apify

- POST https://mcp.apify.com/ → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token. Pass an Apify API token in the Authorization: Bearer <token> header. Manage tokens at https://console.apify.com/account/integrations"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.apify.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://console-backend.apify.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://console.apify.com/authorize/oauth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.apify.com%2F → HTTP 200

### box

- POST https://mcp.box.com/ → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_request", error_description="[REDACTED]", resource_metadata="https://mcp.box.com/.well-known/oauth-protected-resource"
- GET https://mcp.box.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://api.box.com/.well-known/oauth-authorization-server → HTTP 200

### dropbox

- POST https://mcp.dropbox.com/mcp → HTTP 401: missing Bearer [REDACTED]
- WWW-Authenticate: Bearer resource_metadata="https://mcp.dropbox.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.dropbox.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://www.dropbox.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://www.dropbox.com/oauth2/register → HTTP 403: {"error":"registration_not_supported","error_description":"Dynamic client registration is not supported. Only pre-registered MCP trusted partners are allowed."}

### todoist

- POST https://ai.todoist.net/mcp → HTTP 401: {"message":"Missing or invalid authorization header","error":"Unauthorized","statusCode":401}
- WWW-Authenticate: Bearer resource_metadata="https://ai.todoist.net/.well-known/oauth-protected-resource/mcp"
- GET https://ai.todoist.net/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://todoist.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://todoist.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fai.todoist.net%2Fmcp → HTTP 302
- GET https://todoist.com/users/showlogin?success_page=%5BREDACTED%5D → HTTP 307: Temporary Redirect .
- GET https://app.todoist.com/users/showlogin?success_page=%5BREDACTED%5D → HTTP 302
- GET https://app.todoist.com/auth/login?success_page=%5BREDACTED%5D → HTTP 200

### granola

- POST https://mcp.granola.ai/mcp → HTTP 401: {"message":"Unauthorized"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.granola.ai/.well-known/oauth-protected-resource"
- GET https://mcp.granola.ai/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp-auth.granola.ai/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp-auth.granola.ai/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.granola.ai%2Fmcp → HTTP 302
- GET https://mcp-auth.granola.ai/?authorization_session_id=%5BREDACTED%5D&prompt=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D → HTTP 200

### fireflies

- POST https://api.fireflies.ai/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", scope="[REDACTED]", resource_metadata="https://api.fireflies.ai/.well-known/oauth-protected-resource/mcp"
- GET https://api.fireflies.ai/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://api.fireflies.ai/.well-known/oauth-authorization-server → HTTP 200
- GET https://api.fireflies.ai/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.fireflies.ai%2Fmcp → HTTP 302
- GET https://user-service-rest.fireflies.ai/auth/oidc/authorize?client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fapi.fireflies.ai%2Fcallback&scope=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&nonce=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 200

### resend

- POST https://mcp.resend.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Unauthorized: provide credentials via Authorization: Bearer <token>"},"id":null}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.resend.com/.well-known/oauth-protected-resource"
- GET https://mcp.resend.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://api.resend.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://api.resend.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.resend.com%2F → HTTP 302
- GET https://resend.com/oauth/authorize/e7f0e005-4d9c-428b-a2ba-d3eaab43fb4c → HTTP 307: Redirecting (307) The document has moved here
- GET https://resend.com/login → HTTP 200

### wix

- POST https://mcp.wix.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.wix.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.wix.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.wix.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.wix.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.wix.com%2Fmcp → HTTP 302
- GET https://users.wix.com/signin?postSignUp=%5BREDACTED%5D&redirectTo=%5BREDACTED%5D&autoRedirect=%5BREDACTED%5D → HTTP 200

### cloudinary-asset-management

- POST https://asset-management.mcp.cloudinary.com/mcp → HTTP 401: {"error":"unauthorized","error_description":"Authentication required. Provide either OAuth Bearer [REDACTED] or API key headers.","request_id":"24a10b598a9138c6a9e281d75e15af96"}
- WWW-Authenticate: Bearer resource_metadata="https://asset-management.mcp.cloudinary.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://asset-management.mcp.cloudinary.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://asset-management.mcp.cloudinary.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://asset-management.mcp.cloudinary.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fasset-management.mcp.cloudinary.com%2F → HTTP 302
- GET https://oauth.cloudinary.com/oauth2/auth?client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fasset-management.mcp.cloudinary.com%2Fcallback&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://console.cloudinary.com/users/o/login?login_challenge=%5BREDACTED%5D → HTTP 200

### mem0

- POST https://mcp.mem0.ai/mcp → HTTP 307
- POST https://mcp.mem0.ai/mcp/ → HTTP 401: {"error":"invalid_token","error_description":"Authentication required"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.mem0.ai/.well-known/oauth-protected-resource"
- GET https://mcp.mem0.ai/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.mem0.ai/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.mem0.ai/register → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### datadog

- POST https://mcp.datadoghq.com/v1/mcp → HTTP 401: {"errors":["Unauthorized"]}
- WWW-Authenticate: (absent)
- GET https://mcp.datadoghq.com/.well-known/oauth-protected-resource/v1/mcp → HTTP 200
- GET https://mcp.datadoghq.com/.well-known/oauth-authorization-server/v1/mcp → HTTP 200
- GET https://app.datadoghq.com/oauth2/v1/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.datadoghq.com%2Fv1%2Fmcp → HTTP 307
- GET https://app.datadoghq.com/account/login?next=%5BREDACTED%5D → HTTP 200

### grafana-cloud

- POST https://mcp.grafana.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"missing or invalid Bearer [REDACTED]"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.grafana.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.grafana.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.grafana.com/.well-known/oauth-authorization-server/mcp → HTTP 200
- GET https://mcp.grafana.com/mcp/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.grafana.com%2Fmcp → HTTP 200

### honeycomb

- POST https://mcp.honeycomb.io/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.honeycomb.io/.well-known/oauth-protected-resource"
- GET https://mcp.honeycomb.io/.well-known/oauth-protected-resource → HTTP 200
- GET https://ui.honeycomb.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://ui.honeycomb.io/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.honeycomb.io%2Fmcp → HTTP 303
- GET https://ui.honeycomb.io/login → HTTP 200

### hubspot

- POST https://mcp.hubspot.com/ → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.hubspot.com/.well-known/oauth-protected-resource"
- GET https://mcp.hubspot.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.hubspot.com/.well-known/oauth-authorization-server → HTTP 200

### pipedrive

- POST https://mcp.pipedrive.ai/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Unauthorized: No API token or authorization header provided."},"id":1}
- WWW-Authenticate: Bearer error="invalid_request", error_description="[REDACTED]", resource_metadata="https://mcp.pipedrive.ai/mcp/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.pipedrive.ai/mcp/.well-known/oauth-protected-resource → HTTP 200
- GET https://oauth.pipedrive.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://oauth.pipedrive.com/oauth/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Invalid redirect URI"}

### klaviyo

- POST https://mcp.klaviyo.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.klaviyo.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.klaviyo.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.klaviyo.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.klaviyo.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.klaviyo.com%2Fmcp → HTTP 200

### monday

- POST https://mcp.monday.com/mcp → HTTP 401: {"errors":["Not Authenticated"]}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.monday.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.monday.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auth.monday.com/.well-known/oauth-authorization-server/mcp → HTTP 200
- GET https://auth.monday.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.monday.com%2Fmcp → HTTP 302
- GET https://auth.monday.com/users/sign_up_new?oauth_payload_token=%5BREDACTED%5D → HTTP 200

### wrike

- POST https://mcp.wrike.com/v2 → HTTP 401: Unauthorized
- WWW-Authenticate: (absent)
- GET https://mcp.wrike.com/.well-known/oauth-protected-resource/v2 → HTTP 200
- GET https://login.wrike.com/.well-known/oauth-authorization-server/oauth2 → HTTP 200

### smartsheet

- POST https://mcp.smartsheet.com/ → HTTP 401
- WWW-Authenticate: (absent)
- GET https://mcp.smartsheet.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.smartsheet.com/.well-known/oauth-authorization-server → HTTP 200

### egnyte

- POST https://mcp-server.egnyte.com/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp-server.egnyte.com/.well-known/oauth-protected-resource"
- GET https://mcp-server.egnyte.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp-oauth.egnyte.com/.well-known/oauth-authorization-server/egnyte-connect → HTTP 200
- POST https://mcp-oauth.egnyte.com/clients → HTTP 200

### mongodb-atlas

- POST https://mcp.mongodb.com/ → HTTP 401: {"error":401,"reason":"Unauthorized","detail":"You are not authorized for this resource."}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.mongodb.com/.well-known/oauth-protected-resource"
- GET https://mcp.mongodb.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://authorize.mongodb.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://cloud.mongodb.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mongodb.com%2F → HTTP 303
- GET https://account.mongodb.com/account/login?signedOut=%5BREDACTED%5D&n=%5BREDACTED%5D → HTTP 200

### paddle

- POST https://mcp.paddle.com/mcp → HTTP 401: {"error":"No token provided."}
- WWW-Authenticate: Bearer error="[REDACTED]", error_description="[REDACTED]", resource_metadata="https://mcp.paddle.com/.well-known/oauth-protected-resource"
- GET https://mcp.paddle.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://id.paddle.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://id.paddle.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.paddle.com%2F → HTTP 302
- GET https://vendors.paddle.com/oidc?external_auth_id=%5BREDACTED%5D → HTTP 302
- GET https://api.paddle.com/oauth2/auth?subject_type=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fvendors.paddle.com%2Foidc%3Fprovider%3D%255BREDACTED%255D&client_id=%5BREDACTED%5D&nonce=%5BREDACTED%5D&state=%5BREDACTED%5D&scope=%5BREDACTED%5D → HTTP 302
- GET https://api.paddle.com/oauth2/login?login_challenge=%5BREDACTED%5D&subject_type=%5BREDACTED%5D → HTTP 307: Temporary Redirect .
- GET https://login.paddle.com/login?r=%5BREDACTED%5D&s=%5BREDACTED%5D&subject_type=%5BREDACTED%5D → HTTP 200

### ramp

- POST https://mcp.ramp.com/mcp → HTTP 401: {"detail":"No access token provided"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.ramp.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.ramp.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.ramp.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.ramp.com/register → HTTP 200
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":true,"client_secret_empty":true}

### mercury

- POST https://mcp.mercury.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.mercury.com/.well-known/oauth-protected-resource/mcp → HTTP 404: Error Cannot GET /.well-known/oauth-protected-resource/mcp
- GET https://mcp.mercury.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.mercury.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.mercury.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mercury.com%2Fmcp → HTTP 302
- GET https://oauth2.mercury.com/oauth2/auth?client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mercury.com%2Fmcp → HTTP 302
- GET https://app.mercury.com/oauth2/login?login_challenge=%5BREDACTED%5D → HTTP 200

### postman

- POST https://mcp.postman.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Invalid Request: API key required"},"id":null}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.postman.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.postman.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.postman.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.postman.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.postman.com%2Fmcp → HTTP 200

### webflow

- POST https://mcp.webflow.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.webflow.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.webflow.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.webflow.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.webflow.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.webflow.com%2Fmcp → HTTP 200

### stytch

- POST https://mcp.stytch.dev/mcp → HTTP 401: Unauthorized
- WWW-Authenticate: Bearer error="[REDACTED]", error_description="[REDACTED]", resource_metadata="https://mcp.stytch.dev/.well-known/oauth-protected-resource"
- GET https://mcp.stytch.dev/.well-known/oauth-protected-resource → HTTP 200
- GET https://rustic-kilogram-6347.customers.stytch.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://stytch.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.stytch.dev%2F → HTTP 200

### aws

- POST https://aws-mcp.us-east-1.api.aws/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://aws-mcp.us-east-1.api.aws/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://us-east-1.oauth.signin.aws/.well-known/oauth-authorization-server → HTTP 200
- POST https://us-east-1.oauth.signin.aws/v1/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"The redirection URI https://mcptest.io/oauth/callback is not allowed by this server."}

### google-compute-engine

- POST https://compute.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://compute.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### google-kubernetes-engine

- POST https://container.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://container.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### google-cloud-run

- POST https://run.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://run.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### google-cloud-resource-manager

- POST https://cloudresourcemanager.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://cloudresourcemanager.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### digitalocean-apps

- POST https://apps.mcp.digitalocean.com/mcp → HTTP 401: missing or invalid Bearer [REDACTED]
- WWW-Authenticate: Bearer resource_metadata="https://apps.mcp.digitalocean.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://apps.mcp.digitalocean.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://cloud.digitalocean.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://cloud.digitalocean.com/v1/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapps.mcp.digitalocean.com%2F → HTTP 302
- GET https://cloud.digitalocean.com/login?redirect_url=%5BREDACTED%5D → HTTP 200

### digitalocean-databases

- POST https://databases.mcp.digitalocean.com/mcp → HTTP 401: missing or invalid Bearer [REDACTED]
- WWW-Authenticate: Bearer resource_metadata="https://databases.mcp.digitalocean.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://databases.mcp.digitalocean.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://cloud.digitalocean.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://cloud.digitalocean.com/v1/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fdatabases.mcp.digitalocean.com%2F → HTTP 302
- GET https://cloud.digitalocean.com/login?redirect_url=%5BREDACTED%5D → HTTP 200

### digitalocean-droplets

- POST https://droplets.mcp.digitalocean.com/mcp → HTTP 401: missing or invalid Bearer [REDACTED]
- WWW-Authenticate: Bearer resource_metadata="https://droplets.mcp.digitalocean.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://droplets.mcp.digitalocean.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://cloud.digitalocean.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://cloud.digitalocean.com/v1/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fdroplets.mcp.digitalocean.com%2F → HTTP 302
- GET https://cloud.digitalocean.com/login?redirect_url=%5BREDACTED%5D → HTTP 200

### heroku

- POST https://mcp.heroku.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.heroku.com/.well-known/oauth-protected-resource/mcp → HTTP 404: Not Found
- GET https://mcp.heroku.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.heroku.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.heroku.com/auth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.heroku.com%2Fmcp → HTTP 303

### pulumi

- POST https://mcp.ai.pulumi.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Missing Access Token","data":{"error":"unauthorized","error_description":"Bearer [REDACTED] required.","mcp_protocol_version":"2025-03-26"}},"id":1}
- WWW-Authenticate: Bearer realm="[REDACTED]", auth_server_metadata="[REDACTED]"
- GET https://mcp.ai.pulumi.com/.well-known/oauth-protected-resource/mcp → HTTP 404: Error Cannot GET /.well-known/oauth-protected-resource/mcp
- GET https://mcp.ai.pulumi.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.ai.pulumi.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.ai.pulumi.com/oauth/register → HTTP 200

### fly-sprites

- POST https://sprites.dev/mcp → HTTP 401: {"error":"authentication failed"}
- WWW-Authenticate: Bearer resource_metadata="https://sprites.dev/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://sprites.dev/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://sprites.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://sprites.dev/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fsprites.dev%2Fmcp → HTTP 302
- GET https://api.fly.io/oauth/authorize?scope=%5BREDACTED%5D&state=%5BREDACTED%5D&client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fsprites.dev%2Fauth%2Ffly%2Fcallback&utm_source=%5BREDACTED%5D&utm_medium=%5BREDACTED%5D&utm_campaign=%5BREDACTED%5D&response_type=%5BREDACTED%5D → HTTP 302
- GET https://api.fly.io/app/sign-in?return_to=%5BREDACTED%5D → HTTP 301: You are being redirected .
- GET https://fly.io/app/sign-in?return_to=%5BREDACTED%5D → HTTP 200

### google-alloydb

- POST https://alloydb.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://alloydb.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### google-firestore

- POST https://firestore.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://firestore.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### google-spanner

- POST https://spanner.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://spanner.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### clickhouse-cloud

- POST https://mcp.clickhouse.cloud/mcp → HTTP 401: {"error":"Authentication required"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.clickhouse.cloud/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.clickhouse.cloud/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.clickhouse.cloud/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.clickhouse.cloud/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.clickhouse.cloud%2Fmcp → HTTP 302
- GET https://auth.clickhouse.cloud/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.clickhouse.cloud%2Fcallback&scope=%5BREDACTED%5D&audience=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://auth.clickhouse.cloud/u/login/identifier?state=%5BREDACTED%5D → HTTP 302
- GET https://clickhouse.cloud/signin?iss=%5BREDACTED%5D → HTTP 308: Redirecting (308) The document has moved here
- GET https://console.clickhouse.cloud/signin?iss=%5BREDACTED%5D → HTTP 200

### motherduck

- POST https://api.motherduck.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Authentication required. Please authenticate using OAuth or provide a Bearer [REDACTED]"},"id":1}
- WWW-Authenticate: Bearer resource_metadata="https://api.motherduck.com/.well-known/oauth-protected-resource/mcp", resource="[REDACTED]"
- GET https://api.motherduck.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp-auth.motherduck.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp-auth.motherduck.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.motherduck.com%2Fmcp → HTTP 200

### google-cloud-logging

- POST https://logging.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://logging.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### google-cloud-monitoring

- POST https://monitoring.googleapis.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://monitoring.googleapis.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://accounts.google.com/.well-known/oauth-authorization-server → HTTP 200

### new-relic

- POST https://mcp.newrelic.com/mcp → HTTP 401: {"error":"unauthorized","error_description":"Authentication required: provide either 'api-key' header with New Relic API key or 'Authorization: Bearer <token>' header","authentication_options":{"api_key":"[REDACTED]","oauth2":{"description":"OAuth 2.0 Bearer [REDACTED]","header":"Authorization","format":"Bearer <token>","resource_url":"https://mcp.
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.newrelic.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.newrelic.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://oauth2.service.newrelic.com/.well-known/oauth-authorization-server → HTTP 200

### better-stack

- POST https://mcp.betterstack.com/ → HTTP 401: {"error":"unauthorized"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.betterstack.com/.well-known/oauth-protected-resource"
- GET https://mcp.betterstack.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://betterstack.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://betterstack.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.betterstack.com%2F → HTTP 302
- GET https://betterstack.com/users/sign-in?return_to=%5BREDACTED%5D → HTTP 200

### pydantic-logfire

- POST https://logfire-us.pydantic.dev/mcp → HTTP 401
- WWW-Authenticate: Bearer scope="[REDACTED]", resource_metadata="https://logfire-us.pydantic.dev/.well-known/oauth-protected-resource/mcp"
- GET https://logfire-us.pydantic.dev/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://logfire-us.pydantic.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://logfire-us.pydantic.dev/api/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Flogfire-us.pydantic.dev%2Fmcp → HTTP 307
- GET https://logfire-us.pydantic.dev/login?from=%5BREDACTED%5D → HTTP 200

### raygun

- POST https://api.raygun.com/v3/mcp → HTTP 401: {"type":"https://tools.ietf.org/html/rfc9110","title":"Unauthorized","status":401,"traceId":"00-4bc25d7e62a5943899a21696a5d5db1d-0bef162676731af3-00"}
- WWW-Authenticate: Bearer resource_metadata="https://api.raygun.com/.well-known/oauth-protected-resource/v3/mcp"
- GET https://api.raygun.com/.well-known/oauth-protected-resource/v3/mcp → HTTP 200
- GET https://api.raygun.com/.well-known/oauth-authorization-server/v3 → HTTP 200
- GET https://api.raygun.com/v3/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.raygun.com%2Fv3%2Fmcp → HTTP 302
- GET https://app.raygun.com/signin?ReturnUrl=%5BREDACTED%5D → HTTP 200

### rootly

- POST https://mcp.rootly.com/mcp → HTTP 401: {"error":"unauthorized","message":"Authorization header with a valid Bearer [REDACTED] is required."}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.rootly.com/.well-known/oauth-protected-resource"
- GET https://mcp.rootly.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://rootly.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://rootly.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.rootly.com%2F → HTTP 302
- GET https://rootly.com/users/sign_in → HTTP 403: Just a moment... Enable JavaScript and cookies to continue

### incident-io

- POST https://mcp.incident.io/mcp → HTTP 401: no Bearer [REDACTED]
- WWW-Authenticate: Bearer resource_metadata="https://mcp.incident.io/mcp/.well-known/oauth-protected-resource"
- GET https://mcp.incident.io/mcp/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.incident.io/.well-known/oauth-authorization-server/mcp → HTTP 200
- GET https://app.incident.io/auth/plugin/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.incident.io%2F → HTTP 307
- GET https://app.incident.io/~/plugin-authorize?client_id=%5BREDACTED%5D&client_name=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&resource=https%3A%2F%2Fmcp.incident.io%2F&response_type=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 200

### cloudflare-dex

- POST https://dex.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://dex.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://dex.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://dex.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://dex.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fdex.mcp.cloudflare.com%2Fmcp → HTTP 200

### braintrust

- POST https://api.braintrust.dev/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Authentication required. Include 'Authorization: Bearer <token>' header.","data":"All MCP methods require OAuth authentication. Complete OAuth flow first."},"id":1}
- WWW-Authenticate: Bearer error="invalid_token", resource_metadata="https://api.braintrust.dev/.well-known/oauth-protected-resource/mcp"
- GET https://api.braintrust.dev/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://api.braintrust.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://api.braintrust.dev/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.braintrust.dev%2Fmcp → HTTP 302
- GET https://www.braintrust.dev/redirects/mcp-oauth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.braintrust.dev%2Fmcp → HTTP 307: Braintrust - The active observability platform for agents
- GET https://www.braintrust.dev/signin?redirect_url=%5BREDACTED%5D → HTTP 200

### replicate

- POST https://mcp.replicate.com/sse → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]"
- GET https://mcp.replicate.com/.well-known/oauth-protected-resource/sse → HTTP 404: 404 Not Found
- GET https://mcp.replicate.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.replicate.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.replicate.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.replicate.com%2F → HTTP 200

### fal

- POST https://mcp.fal.ai/mcp-relay → HTTP 401: {"error":"Authentication required"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.fal.ai/.well-known/oauth-protected-resource/mcp-relay"
- GET https://mcp.fal.ai/.well-known/oauth-protected-resource/mcp-relay → HTTP 200
- GET https://authkit.fal.ai/.well-known/oauth-authorization-server → HTTP 200
- GET https://authkit.fal.ai/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.fal.ai%2Fmcp-relay → HTTP 302
- GET https://authkit.fal.ai/?authorization_session_id=%5BREDACTED%5D&prompt=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D → HTTP 200

### parallel-task

- POST https://task-mcp.parallel.ai/mcp → HTTP 401: {"error":"Authentication required","detail":"Missing x-api-key or Authorization header. Please provide a valid API key."}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://task-mcp.parallel.ai/.well-known/oauth-protected-resource/mcp"
- GET https://task-mcp.parallel.ai/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://platform.parallel.ai/.well-known/oauth-authorization-server → HTTP 200
- POST https://platform.parallel.ai/getKeys/register → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","urn:ietf:params:oauth:grant-type:device_code"],"response_types":["code"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### you-com

- POST https://api.you.com/mcp → HTTP 401: Unauthorized: OAuth authentication required
- WWW-Authenticate: Bearer resource_metadata="https://api.you.com/mcp/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://api.you.com/mcp/.well-known/oauth-protected-resource → HTTP 200
- GET https://auth.you.com/.well-known/oauth-authorization-server/v1/apps/agentic/P2jInttRMuXpyYZMbVcsc4C9Z0RT/MS3BitzWFxlSigWFUNJHHNsIYt5qp → HTTP 200
- GET https://auth.you.com/oauth2/v1/apps/agentic/P2jInttRMuXpyYZMbVcsc4C9Z0RT/MS3BitzWFxlSigWFUNJHHNsIYt5qp/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.you.com%2Fmcp → HTTP 303
- GET https://auth.you.com/login/P2jInttRMuXpyYZMbVcsc4C9Z0RT?application_scopes=%5BREDACTED%5D&flow=%5BREDACTED%5D&oidc_error_redirect_uri=%5BREDACTED%5D&oidc_prompt=%5BREDACTED%5D&oidc_resource=%5BREDACTED%5D&third_party_app_id=%5BREDACTED%5D&third_party_app_state_id=%5BREDACTED%5D → HTTP 200

### valyu

- POST https://mcp.valyu.ai/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Sign in with Valyu (OAuth 2.1 - see resource_metadata) or send a Valyu API key as `Authorization: Bearer <VALYU_API_KEY>` (preferred) or `X-API-Key: <VALYU_API_KEY>`. Get a key at https://platform.valyu.ai./"},"id":null}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.valyu.ai/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.valyu.ai/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://znjddttyhmtuiyavinsb.supabase.co/.well-known/oauth-authorization-server/auth/v1 → HTTP 200
- GET https://znjddttyhmtuiyavinsb.supabase.co/auth/v1/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.valyu.ai%2Fmcp → HTTP 302
- GET https://platform.valyu.ai/oauth/consent?authorization_id=%5BREDACTED%5D → HTTP 200

### bright-data

- POST https://mcp.brightdata.com/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.brightdata.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.brightdata.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://brightdata.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://brightdata.com/users/auth/mcp/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.brightdata.com%2Fmcp → HTTP 302
- GET https://brightdata.com/cp/start?mcp=%5BREDACTED%5D&need_login=%5BREDACTED%5D&next=%5BREDACTED%5D → HTTP 200

### algolia

- POST https://mcp.algolia.com/mcp → HTTP 401: {"status":401,"detail":"Unauthorized: Missing or invalid Authorization header","code":"[REDACTED]","instance":"/mcp"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.algolia.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.algolia.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://dashboard.algolia.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://dashboard.algolia.com/2/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.algolia.com%2Fmcp → HTTP 302
- GET https://www.algolia.com/users/sign_in?redirect_to=%5BREDACTED%5D → HTTP 302
- GET https://dashboard.algolia.com/users/sign_in?redirect_to=%5BREDACTED%5D → HTTP 403: Just a moment... Enable JavaScript and cookies to continue

### expo

- POST https://mcp.expo.dev/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.expo.dev/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.expo.dev/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.expo.dev/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.expo.dev/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.expo.dev%2Fmcp → HTTP 302
- GET https://expo.dev/login?client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.expo.dev%2Fauth%2Fexpo-callback&response_type=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&state=%5BREDACTED%5D&confirm_account=%5BREDACTED%5D → HTTP 200

### bitrise

- POST https://mcp.bitrise.io/ → HTTP 401: {"error":"unauthorized","error_description":"authentication required"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.bitrise.io/.well-known/oauth-protected-resource"
- GET https://mcp.bitrise.io/.well-known/oauth-protected-resource → HTTP 200
- GET https://oauth.bitrise.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://oauth.bitrise.io/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.bitrise.io%2F → HTTP 302
- GET https://app.bitrise.io/workos/connect?external_auth_id=%5BREDACTED%5D → HTTP 302
- GET https://app.bitrise.io/users/sign_in → HTTP 200

### harness

- POST https://mcp.harness.io/mcp → HTTP 401: {"body":{"responseMessages":[{"code":"[REDACTED]","level":"ERROR","message":"Invalid authorization header format"}]},"statusCode":"UNAUTHORIZED","statusCodeValue":401}
- WWW-Authenticate: (absent)
- GET https://mcp.harness.io/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://id.harness.io/.well-known/oauth-authorization-server/idp/realms/HarnessIDP → HTTP 403
- GET https://id.harness.io/.well-known/openid-configuration/idp/realms/HarnessIDP → HTTP 403
- GET https://id.harness.io/idp/realms/HarnessIDP/.well-known/openid-configuration → HTTP 200
- POST https://id.harness.io/idp/realms/HarnessIDP/clients-registrations/openid-connect → HTTP 403: {"error":"insufficient_scope","error_description":"Policy 'DCR Trusted hosts ' rejected request to client-registration service. Details: URL doesn't match any trusted host or trusted domain"}

### launchdarkly

- POST https://mcp.launchdarkly.com/mcp/launchdarkly → HTTP 401: {"jsonrpc":"2.0","id":1,"error":{"code":"[REDACTED]","message":"unauthorized access"}}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.launchdarkly.com/.well-known/oauth-protected-resource/mcp/launchdarkly"
- GET https://mcp.launchdarkly.com/.well-known/oauth-protected-resource/mcp/launchdarkly → HTTP 200
- GET https://mcp.launchdarkly.com/.well-known/oauth-authorization-server/mcp/launchdarkly → HTTP 200
- GET https://app.launchdarkly.com/trust/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.launchdarkly.com%2Fmcp%2Flaunchdarkly → HTTP 200

### statsig

- POST https://api.statsig.com/v3/mcp → HTTP 401: {"statusCode":401,"message":"This endpoint only accepts an active CONSOLE key, but an invalid key was sent. Key: ","error":"Unauthorized"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource="[REDACTED]", resource_metadata="https://api.statsig.com/.well-known/oauth-protected-resource/v3/mcp"
- GET https://api.statsig.com/.well-known/oauth-protected-resource/v3/mcp → HTTP 200
- GET https://api.statsig.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://api.statsig.com/v1/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.statsig.com%2Fv3%2Fmcp → HTTP 302
- GET https://console.statsig.com/login/authorize?client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&state=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.statsig.com%2Fv3%2Fmcp → HTTP 307: /login?redirect=%2Flogin%2Fauthorize%3Fclient_id%3Dhttps%253A%252F%252Fmcptest.io%252Foauth%252Fclient-metadata.json%26response_type%3Dcode%26redirect_uri%3Dhttps%253A%252F%252Fmcptest.io%252Foauth%252Fcallback%26code_challenge%3Dc7RWy3rknGp8h8PS9KNxvL4EctC9szAbgBGp9AOh6hA%26code_challenge_method%3DS256%26state%3DG-cV8BtHScfRwjRmAxHsxrPGqWb3ZxZcVfJ
- GET https://console.statsig.com/login?redirect=%5BREDACTED%5D → HTTP 200

### port

- POST https://mcp.port.io/v1 → HTTP 401: {"error":"no token provided","ok":false}
- WWW-Authenticate: (absent)
- GET https://mcp.port.io/.well-known/oauth-protected-resource/v1 → HTTP 200
- GET https://mcp.port.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.port.io/v1/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.port.io%2Fv1 → HTTP 302
- GET https://auth.getport.io/authorize?client_id=%5BREDACTED%5D&response_type=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&audience=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://auth.getport.io/u/login/identifier?state=%5BREDACTED%5D → HTTP 302
- GET https://app.getport.io/?iss=%5BREDACTED%5D → HTTP 200

### kong-konnect

- POST https://global.mcp.konghq.com/ → HTTP 401: {"message":"missing authorization header"}
- WWW-Authenticate: Bearer resource_metadata="https://global.mcp.konghq.com/.well-known/oauth-protected-resource"
- GET https://global.mcp.konghq.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://konnect-global.us.identity.konghq.com/.well-known/oauth-authorization-server/auth → HTTP 404: {"type":"https://kongapi.info/konnect/not-found","status":404,"title":"Not Found","detail":"The resource requested was not found."}
- GET https://konnect-global.us.identity.konghq.com/.well-known/openid-configuration/auth → HTTP 404: {"type":"https://kongapi.info/konnect/not-found","status":404,"title":"Not Found","detail":"The resource requested was not found."}
- GET https://konnect-global.us.identity.konghq.com/auth/.well-known/openid-configuration → HTTP 200
- POST https://konnect-global.us.identity.konghq.com/oauth2/v1/clients → HTTP 201

### greptile

- POST https://api.greptile.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://api.greptile.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auth.greptile.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://auth.greptile.com/oauth2/register → HTTP 201
- GET https://auth.greptile.com/oauth2/auth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.greptile.com%2Fmcp → HTTP 302
- GET https://auth.greptile.com/login?login_challenge=%5BREDACTED%5D → HTTP 200

### kernel

- POST https://mcp.onkernel.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.onkernel.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.onkernel.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auth.onkernel.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://auth.onkernel.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.onkernel.com%2Fmcp → HTTP 307
- GET https://dashboard.onkernel.com/oauth/select-org?picker_ref=%5BREDACTED%5D → HTTP 307: Redirecting (307) The document has moved here
- GET https://dashboard.onkernel.com/sign-in?redirect_url=%5BREDACTED%5D → HTTP 200

### mux

- POST https://mcp.mux.com/ → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Unauthorized: Missing Authorization header"}}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.mux.com/.well-known/oauth-protected-resource"
- GET https://mcp.mux.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://auth.mux.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://auth.mux.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mux.com%2F → HTTP 302
- GET https://api.mux.com/ui/v1/authorization?external_auth_id=%5BREDACTED%5D → HTTP 302
- GET https://dashboard.mux.com/login?external_auth_id=%5BREDACTED%5D → HTTP 200

### alchemy

- POST https://mcp.alchemy.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Missing or invalid Authorization header"},"id":null}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.alchemy.com/.well-known/oauth-protected-resource"
- GET https://mcp.alchemy.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://auth.alchemy.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://auth.alchemy.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.alchemy.com%2Fmcp → HTTP 400: {"error":"invalid_request","error_description":"redirect_uri not allowed"}

### contentful

- POST https://mcp.contentful.com/mcp → HTTP 401
- WWW-Authenticate: (absent)
- GET https://mcp.contentful.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.contentful.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.contentful.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.contentful.com%2Fmcp → HTTP 302
- GET https://be.contentful.com/oauth/authorize?client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.contentful.com%2Fcallback&scope=%5BREDACTED%5D&state=%5BREDACTED%5D&response_type=%5BREDACTED%5D → HTTP 200

### storyblok

- POST https://mcp.storyblok.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://mcp.storyblok.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.storyblok.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.storyblok.com/oauth/register → HTTP 201
- GET https://mcp.storyblok.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.storyblok.com%2Fmcp → HTTP 400: {"error":"invalid_redirect_uri","error_description":"redirect_uri must be a loopback URL (http://localhost/ or 127.0.0.1) per RFC 8252, or a recognized hosted-connector callback URL"}

### prismic

- POST https://mcp.prismic.io/mcp → HTTP 401: {"error":"Unauthorized"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.prismic.io/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.prismic.io/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.prismic.io/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.prismic.io/register → HTTP 400: {"error":"invalid_client_metadata","error_description":"Redirect URI not allowed: https://mcptest.io/oauth/callback"}

### hygraph

- POST https://mcp.hygraph.com/mcp → HTTP 401: unauthorized
- WWW-Authenticate: Bearer resource_metadata="https://mcp.hygraph.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.hygraph.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://auth.hygraph.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://auth.hygraph.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.hygraph.com%2Fmcp → HTTP 400: Hygraph Hygraph Oops!, something went wrong There could be a misconfiguration in the system or a service outage. We track these errors automatically, but if the problem persists feel free to contact us. Please try again. TECHNICAL DETAILS See details for this error SUPPORT Get Help support@hygraph.com invalid_request : Unknown client: https://mcpte

### builder-cms

- POST https://mcp.builder.io/mcp/publish → HTTP 401: {"status":401,"error":"unauthorized","message":"Authorization required","resource_metadata":"https://mcp.builder.io/.well-known/oauth-protected-resource/mcp/publish"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.builder.io/.well-known/oauth-protected-resource/mcp/publish"
- GET https://mcp.builder.io/.well-known/oauth-protected-resource/mcp/publish → HTTP 200
- GET https://mcp.builder.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.builder.io/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.builder.io%2Fmcp%2Fpublish → HTTP 302
- GET https://builder.io/app/oauth/authorize?client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&prompt=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&resource=https%3A%2F%2Fmcp.builder.io%2Fmcp%2Fpublish&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 200

### lovable

- POST https://mcp.lovable.dev/ → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Not authenticated"},"id":null}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.lovable.dev/.well-known/oauth-protected-resource"
- GET https://mcp.lovable.dev/.well-known/oauth-protected-resource → HTTP 200
- GET https://lovable.dev/.well-known/oauth-authorization-server/oauth → HTTP 200
- GET https://lovable.dev/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.lovable.dev%2F → HTTP 400: Authorization failed - Lovable Authorization failed: Client not supported This app identifies itself with a client ID URL on mcptest.io, which Lovable does not support yet. Error code: [REDACTED]

### vanta

- POST https://mcp.vanta.com/mcp → HTTP 401: {"error":"invalid_token","error_description":"Missing Authorization header"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", scope="[REDACTED]", resource_metadata="https://mcp.vanta.com/.well-known/oauth-protected-resource"
- GET https://mcp.vanta.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://api.vanta.com/.well-known/oauth-authorization-server/mcp → HTTP 200
- GET https://api.vanta.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.vanta.com%2F → HTTP 302
- GET https://app.vanta.com/oauth/authorize?client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&resource=https%3A%2F%2Fmcp.vanta.com%2F&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 200

### gitguardian

- POST https://mcp.gitguardian.com/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.gitguardian.com/.well-known/oauth-protected-resource/mcp", as_metadata="[REDACTED]"
- GET https://mcp.gitguardian.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.gitguardian.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.gitguardian.com/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Public clients may only use http://localhost,/ http://127.0.0.1,/ or an approved redirect URI; none of the provided redirect_uris qualify: ['https://mcptest.io/oauth/callback']"}

### clerk

- POST https://mcp.clerk.com/mcp → HTTP 401: {"error":"Unauthorized"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.clerk.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.clerk.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://clerk.clerk.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://clerk.clerk.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.clerk.com%2Fmcp → HTTP 302
- GET https://clerk.clerk.com/oauth/authorize/continue?client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&prompt=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&resource=https%3A%2F%2Fmcp.clerk.com%2Fmcp&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://dashboard.clerk.com/sign-in?redirect_url=%5BREDACTED%5D → HTTP 200

### descope

- POST https://mcp.descope.com/ → HTTP 401: Missing Authorization header
- WWW-Authenticate: Bearer resource_metadata="https://mcp.descope.com/.well-known/oauth-protected-resource"
- GET https://mcp.descope.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://api.descope.com/.well-known/oauth-authorization-server/v1/apps/agentic/P2DA3QqyF3N3BlmIqn1nr0LMFhrw/MS3AebdnI1nLELsiorZz77KmIleWt → HTTP 200
- GET https://api.descope.com/oauth2/v1/apps/agentic/P2DA3QqyF3N3BlmIqn1nr0LMFhrw/MS3AebdnI1nLELsiorZz77KmIleWt/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.descope.com%2F → HTTP 303
- GET https://api.descope.com/login/error?error=%5BREDACTED%5D&error_description=%5BREDACTED%5D → HTTP 200

### cloudflare-casb

- POST https://casb.mcp.cloudflare.com/mcp → HTTP 401
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://casb.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"
- GET https://casb.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://casb.mcp.cloudflare.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://casb.mcp.cloudflare.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fcasb.mcp.cloudflare.com%2Fmcp → HTTP 200

### razorpay

- POST https://mcp.razorpay.com/mcp → HTTP 401: {"error":{"description":"Please provide your api key for authentication purposes","code":"[REDACTED]"}}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.razorpay.com/.well-known/oauth-protected-resource"
- GET https://mcp.razorpay.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.razorpay.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.razorpay.com/register → HTTP 201

### mollie

- POST https://mcp.mollie.com/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.mollie.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.mollie.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://my.mollie.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://my.mollie.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.mollie.com%2Fmcp → HTTP 302
- GET https://my.mollie.com/dashboard/login?lang=%5BREDACTED%5D → HTTP 200

### polar

- POST https://mcp.polar.sh/mcp/polar-mcp → HTTP 401: {"error":"unauthorized"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.polar.sh/.well-known/oauth-protected-resource/mcp/polar-mcp", scope="[REDACTED]"
- GET https://mcp.polar.sh/.well-known/oauth-protected-resource/mcp/polar-mcp → HTTP 200
- GET https://api.polar.sh/.well-known/oauth-authorization-server → HTTP 200
- GET https://polar.sh/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.polar.sh%2Fmcp%2Fpolar-mcp → HTTP 307: Redirecting (307) The document has moved here
- GET https://polar.sh/auth?return_to=%5BREDACTED%5D → HTTP 200

### xero

- POST https://api.xero.com/mcp/v1 → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://api.xero.com/.well-known/oauth-protected-resource/mcp/v1"
- GET https://api.xero.com/.well-known/oauth-protected-resource/mcp/v1 → HTTP 200
- GET https://identity.xero.com/.well-known/oauth-authorization-server → HTTP 200

### alpha-vantage

- POST https://mcp.alphavantage.co/mcp → HTTP 401: {"error":"invalid_request","error_description":"Missing access token","error_uri":"https://tools.ietf.org/html/rfc6750"}
- WWW-Authenticate: Bearer error="invalid_request", error_description="[REDACTED]", resource_metadata="https://mcp.alphavantage.co/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.alphavantage.co/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.alphavantage.co/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.alphavantage.co/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"Invalid redirect URI: https://mcptest.io/oauth/callback"}

### financial-datasets

- POST https://mcp.financialdatasets.ai/ → HTTP 401: {"error":"invalid_token","error_description":"Missing or invalid access token"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.financialdatasets.ai/.well-known/oauth-protected-resource"
- GET https://mcp.financialdatasets.ai/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.financialdatasets.ai/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.financialdatasets.ai/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.financialdatasets.ai%2F → HTTP 200

### hex

- POST https://app.hex.tech/mcp → HTTP 401: Unauthorized
- WWW-Authenticate: Bearer error="[REDACTED]", error_description="[REDACTED]", resource_metadata="https://app.hex.tech/.well-known/oauth-protected-resource"
- GET https://app.hex.tech/.well-known/oauth-protected-resource → HTTP 200
- GET https://auth.app.hex.tech/.well-known/oauth-authorization-server → HTTP 200
- GET https://auth.app.hex.tech/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fapp.hex.tech%2Fmcp → HTTP 302
- GET https://app.hex.tech/mcp/oauth?external_auth_id=%5BREDACTED%5D → HTTP 302
- GET https://app.hex.tech/login?redirectTo=%5BREDACTED%5D → HTTP 200

### fullstory

- POST https://api.fullstory.com/mcp/fullstory → HTTP 401: {"message":"Unauthorized","code":"[REDACTED]"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://api.fullstory.com/.well-known/oauth-protected-resource/mcp/fullstory", scope="[REDACTED]"
- GET https://api.fullstory.com/.well-known/oauth-protected-resource/mcp/fullstory → HTTP 200
- GET https://auth.fullstory.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://auth.fullstory.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.fullstory.com%2Fmcp%2Ffullstory → HTTP 302
- GET https://app.fullstory.com/oauth/login?csrf_id=%5BREDACTED%5D&flow=%5BREDACTED%5D&target_realm=%5BREDACTED%5D → HTTP 307: Temporary Redirect .
- GET https://app.fullstory.com/login?dest=%5BREDACTED%5D → HTTP 200

### logrocket

- POST https://mcp.logrocket.com/mcp → HTTP 401: {"error":"invalid_request","error_description":"Authorization required"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.logrocket.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.logrocket.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.logrocket.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.logrocket.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.logrocket.com%2Fmcp → HTTP 303
- GET https://mcp.logrocket.com/interaction/[REDACTED] → HTTP 400: This sign-in link has expired This sign-in link has expired Return to your MCP client and start connecting to LogRocket again.

### semrush

- POST https://mcp.semrush.com/v2/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.semrush.com/.well-known/oauth-protected-resource/v2/mcp"
- GET https://mcp.semrush.com/.well-known/oauth-protected-resource/v2/mcp → HTTP 200
- GET https://oauth.semrush.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://api.semrush.com/apis/v4-raw/auth/v1/oauth2/register → HTTP 400: {"code":"[REDACTED]","message":"redirect URI https://mcptest.io/oauth/callback is not allowed","retryable":false}

### ahrefs

- POST https://api.ahrefs.com/mcp/mcp → HTTP 401: api token is required
- WWW-Authenticate: Bearer resource_metadata="https://api.ahrefs.com/.well-known/oauth-protected-resource"
- GET https://api.ahrefs.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://api.ahrefs.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://app.ahrefs.com/web/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fapi.ahrefs.com%2F → HTTP 403: Just a moment... Enable JavaScript and cookies to continue

### similarweb

- POST https://mcp.similarweb.com/ → HTTP 401: {"error":"invalid_request","error_description":"Authentication required. Provide either 'api-key' header or 'Authorization: Bearer <token>' header."}
- WWW-Authenticate: Bearer error="invalid_request", error_description="[REDACTED]"
- GET https://mcp.similarweb.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp-auth.similarweb.com/.well-known/oauth-authorization-server → HTTP 403: ERROR: The request could not be satisfied 403 ERROR The request could not be satisfied. Request blocked. We can't connect to the server for this app or website at this time. There might be too much traffic or a configuration error. Try again later, or contact the app or website owner. If you provide content to customers through CloudFront, you can 
- GET https://mcp-auth.similarweb.com/.well-known/openid-configuration → HTTP 403: ERROR: The request could not be satisfied 403 ERROR The request could not be satisfied. Request blocked. We can't connect to the server for this app or website at this time. There might be too much traffic or a configuration error. Try again later, or contact the app or website owner. If you provide content to customers through CloudFront, you can

### salesforce

- POST https://api.salesforce.com/platform/mcp/v1/platform/sobject-all → HTTP 401: {"errors":[{"message":"JWT Token is required"}]}
- WWW-Authenticate: (absent)
- GET https://api.salesforce.com/.well-known/oauth-protected-resource/platform/mcp/v1/platform/sobject-all → HTTP 200
- GET https://login.salesforce.com/.well-known/oauth-authorization-server → HTTP 404: URL No Longer Exists You have attempted to reach a URL that no longer exists on salesforce.com. You may have reached this page after clicking on a direct link into the application. This direct link might be: &#8226; A bookmark to a particular page, such as a report or view &#8226; A link to a particular page in the Custom Links section of your Home
- GET https://login.salesforce.com/.well-known/openid-configuration → HTTP 200
- POST https://login.salesforce.com/services/oauth2/register → HTTP 401: {"error":"invalid_client","error_description":"invalid client credentials"}

### apollo

- POST https://mcp.apollo.io/mcp → HTTP 401: {"error":"Unauthorized: Missing or invalid Authorization header for one of [initialize]","error_details":{"code":"[REDACTED]","message":"This MCP request carried no Bearer [REDACTED] in the Authorization header.","suggestions":[{"label":"Start the OAuth flow using the resource_metadata URL in the WWW-Authenticate header","header":"WWW-Authenticate"
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.apollo.io/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.apollo.io/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.apollo.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.apollo.io/mcp/oauth_metadata/redirect_to_authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.apollo.io%2Fmcp → HTTP 302
- GET https://app.apollo.io/ → HTTP 200

### zoominfo

- POST https://mcp.zoominfo.com/mcp → HTTP 401: {"detail":"The Authorization token is required and cannot be left blank. Please provide a valid token and try again.","title":"Unauthorized access","errors":[{"id":"f8fe0ef3-2299-41fa-9db0-4d382b823ccd","code":"[REDACTED]","detail":"The Authorization token is required and cannot be left blank. Please provide a valid token and try again.","source":n
- WWW-Authenticate: Bearer resource_metadata="https://mcp.zoominfo.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.zoominfo.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.zoominfo.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.zoominfo.com/oauth/register → HTTP 400: {"error":"invalid_client_metadata","error_description":"Vendor with name mcptest-io was not found in approved vendors"}

### gong

- POST https://mcp.gong.io/mcp → HTTP 401: {"error":"unauthorized","error_description":"Authorization header missing or invalid"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://mcp.gong.io/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.gong.io/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.gong.io/.well-known/oauth-authorization-server → HTTP 200
- POST https://app.gong.io/oauth2/register → HTTP 400: {"error":"invalid_client_metadata","error_description":"token_endpoint_auth_method is unsupported"}

### braze

- POST https://mcp.braze.com/mcp → HTTP 401: {"error_description":"Missing Bearer [REDACTED]"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.braze.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]"
- GET https://mcp.braze.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://dashboard.braze.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://dashboard.braze.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.braze.com%2Fmcp → HTTP 302
- GET https://dashboard.braze.com/sign_in → HTTP 200

### customer-io

- POST https://mcp.customer.io/mcp → HTTP 401: {"message":"Authorization required"}
- WWW-Authenticate: Bearer realm="[REDACTED]", error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.customer.io/.well-known/oauth-protected-resource"
- GET https://mcp.customer.io/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.customer.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.customer.io/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.customer.io%2Fmcp → HTTP 302
- GET https://fly.customer.io/oauth2/mcp?auth_request=%5BREDACTED%5D → HTTP 200

### common-room

- POST https://mcp.commonroom.io/mcp → HTTP 401: {"error":"unauthorized","message":"Authentication required. Reconnect the MCP server to sign in again."}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.commonroom.io/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.commonroom.io/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://login.commonroom.io/.well-known/oauth-authorization-server → HTTP 200
- GET https://login.commonroom.io/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.commonroom.io%2Fmcp → HTTP 302
- GET https://login.commonroom.io/u/login/identifier?state=%5BREDACTED%5D → HTTP 302
- GET https://app.commonroom.io/login?iss=%5BREDACTED%5D → HTTP 200

### agentmail

- POST https://mcp.agentmail.to/mcp → HTTP 401: {"error":"Unauthorized"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.agentmail.to/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.agentmail.to/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://clerk.console.agentmail.to/.well-known/oauth-authorization-server → HTTP 200
- GET https://clerk.console.agentmail.to/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.agentmail.to%2Fmcp → HTTP 302
- GET https://clerk.console.agentmail.to/oauth/authorize/continue?client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&prompt=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&resource=https%3A%2F%2Fmcp.agentmail.to%2Fmcp&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 302
- GET https://console.agentmail.to/sign-in?redirect_url=%5BREDACTED%5D → HTTP 200

### infobip-sms

- POST https://mcp.infobip.com/sms → HTTP 401: {"errorCode":"MCP401","description":"The request lacks valid authentication credentials for the requested resource.","action":"Check the resources and adjust authentication credentials.","violations":[],"resources":[{"name":"Infobip MCP","url":"https://www.infobip.com/mcp"}]}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.infobip.com/sms/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.infobip.com/sms/.well-known/oauth-protected-resource → HTTP 200
- GET https://auth.infobip.com/.well-known/oauth-authorization-server/realms/infobip → HTTP 403: 403 Forbidden Request forbidden by administrative rules.
- GET https://auth.infobip.com/.well-known/openid-configuration/realms/infobip → HTTP 403: 403 Forbidden Request forbidden by administrative rules.
- GET https://auth.infobip.com/realms/infobip/.well-known/openid-configuration → HTTP 200
- POST https://auth.infobip.com/realms/infobip/clients-registrations/openid-connect → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code","none"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### front

- POST https://mcp.frontapp.com/mcp → HTTP 401: {"error":"Missing authentication token."}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.frontapp.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.frontapp.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://app.frontapp.com/.well-known/oauth-authorization-server → HTTP 200

### gorgias

- POST https://mcp.gorgias.com/mcp → HTTP 200
- WWW-Authenticate: (absent)
- Initialize returned success without an HTTP challenge. Continue OAuth discovery because authorization may be enforced on later MCP operations; this does not disprove the catalog auth requirement.
- GET https://mcp.gorgias.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.gorgias.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.gorgias.com/register → HTTP 201
- GET https://mcp.gorgias.com/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.gorgias.com%2Fmcp → HTTP 200

### plain

- POST https://mcp.plain.com/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.plain.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]", scope_mode="[REDACTED]"
- GET https://mcp.plain.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://signin.auth.plain.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://signin.auth.plain.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.plain.com%2Fmcp → HTTP 302
- GET https://signin.auth.plain.com/?authorization_session_id=%5BREDACTED%5D&prompt=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D → HTTP 200

### coda

- POST https://coda.io/apis/mcp → HTTP 401: {"statusCode":401,"statusMessage":"Unauthorized","message":"Unauthorized"}
- WWW-Authenticate: Bearer realm="[REDACTED]", resource_metadata="https://coda.io/.well-known/oauth-protected-resource/apis/mcp", scope="[REDACTED]"
- GET https://coda.io/.well-known/oauth-protected-resource/apis/mcp → HTTP 200
- GET https://coda.io/.well-known/oauth-authorization-server → HTTP 200
- POST https://coda.io/v4/api/oauth2/register → HTTP 200

### cal-com

- POST https://mcp.cal.com/mcp → HTTP 401: {"error":"unauthorized","error_description":"Bearer [REDACTED] required"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.cal.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.cal.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.cal.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.cal.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.cal.com%2Fmcp → HTTP 200

### otter

- POST https://mcp.otter.ai/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication required"}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.otter.ai/.well-known/oauth-protected-resource"
- GET https://mcp.otter.ai/.well-known/oauth-protected-resource → HTTP 200
- GET https://otter.ai/.well-known/oauth-authorization-server → HTTP 200
- GET https://otter.ai/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.otter.ai%2F → HTTP 200

### shortcut

- POST https://mcp.shortcut.com/mcp → HTTP 401: {"jsonrpc":"2.0","error":{"code":"[REDACTED]","message":"Unauthorized"},"id":1}
- WWW-Authenticate: Bearer [REDACTED]
- GET https://mcp.shortcut.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://api.app.shortcut.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://api.app.shortcut.com/oauth-authorization-code-flow/code?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.shortcut.com%2Fmcp → HTTP 302
- GET https://app.shortcut.com/auth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.shortcut.com%2Fmcp&pkce_ref=%5BREDACTED%5D → HTTP 200

### plane

- POST https://mcp.plane.so/http/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication failed. The provided Bearer [REDACTED] is invalid, expired, or no longer recognized by the server. To resolve: clear authentication tokens in your MCP client and reconnect. Your client should automatically re-register and obtain new tokens."}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.plane.so/.well-known/oauth-protected-resource/http/mcp"
- GET https://mcp.plane.so/.well-known/oauth-protected-resource/http/mcp → HTTP 200
- GET https://mcp.plane.so/.well-known/oauth-authorization-server/http → HTTP 200
- POST https://mcp.plane.so/http/register → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

### productboard

- POST https://mcp.productboard.com/ → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Unauthorized","data":{"resource_metadata":"https://mcp.productboard.com/.well-known/oauth-protected-resource"}}}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.productboard.com/.well-known/oauth-protected-resource"
- GET https://mcp.productboard.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.productboard.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.productboard.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.productboard.com%2F → HTTP 302
- GET https://app.productboard.com/oauth2/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.productboard.com%2F → HTTP 302
- GET https://app.productboard.com/oauth/login/new?redirect_to=%5BREDACTED%5D → HTTP 200

### basecamp

- POST https://mcp.basecamp.com/mcp → HTTP 401: {"error":"Authorization required","message":"Sign in with your Basecamp account through your AI app's connect flow.","documentation":"https://basecamp.com/ai"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.basecamp.com/.well-known/oauth-protected-resource/mcp", scope="[REDACTED]", algs="[REDACTED]"
- GET https://mcp.basecamp.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://app.basecamp.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://app.basecamp.com/oauth/authorizations/new?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&prompt=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.basecamp.com%2Fmcp → HTTP 302
- GET https://launchpad.37signals.com/bc3/signin?proceed_to=%5BREDACTED%5D → HTTP 200

### whimsical

- POST https://mcp.whimsical.com/mcp → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Missing Bearer [REDACTED]"}}
- WWW-Authenticate: Bearer error="invalid_request", error_description="[REDACTED]", resource_metadata="https://mcp.whimsical.com/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.whimsical.com/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.whimsical.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://api.whimsical.com/v1/oauth.authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.whimsical.com%2F → HTTP 302
- GET https://whimsical.com/oauth?client_id=%5BREDACTED%5D&client_name=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&resource=https%3A%2F%2Fmcp.whimsical.com%2F&response_type=%5BREDACTED%5D&scope=%5BREDACTED%5D&state=%5BREDACTED%5D → HTTP 200

### gamma

- POST https://mcp.gamma.app/mcp → HTTP 401: {"error":"Authentication required","message":"Provide X-API-KEY or Authorization: Bearer [REDACTED]"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.gamma.app/.well-known/oauth-protected-resource"
- GET https://mcp.gamma.app/.well-known/oauth-protected-resource → HTTP 200
- GET https://auth.gamma.app/.well-known/oauth-authorization-server → HTTP 200
- POST https://auth.gamma.app/oauth/register → HTTP 400: {"error":"invalid_redirect_uri","error_description":"redirect_uri not allowed: https://mcptest.io/oauth/callback"}

### spline

- POST https://mcp.spline.design/mcp → HTTP 401: {"error":"unauthorized"}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.spline.design/.well-known/oauth-protected-resource", scope="[REDACTED]"
- GET https://mcp.spline.design/.well-known/oauth-protected-resource → HTTP 200
- GET https://mcp.spline.design/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.spline.design/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.spline.design%2Fmcp → HTTP 302
- GET https://app.spline.design/oauth/consent?req=%5BREDACTED%5D&relay=%5BREDACTED%5D → HTTP 200

### zapier

- POST https://mcp.zapier.com/api/v1/connect → HTTP 401: {"jsonrpc":"2.0","id":null,"error":{"code":"[REDACTED]","message":"Missing authorization header or token query parameter"}}
- WWW-Authenticate: Bearer resource_metadata="https://mcp.zapier.com/.well-known/oauth-protected-resource/api/v1/connect"
- GET https://mcp.zapier.com/.well-known/oauth-protected-resource/api/v1/connect → HTTP 200
- GET https://mcp.zapier.com/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.zapier.com/oauth/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&scope=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.zapier.com%2Fapi%2Fv1%2Fconnect → HTTP 200

### airbyte

- POST https://mcp.airbyte.ai/mcp → HTTP 401: {"error":"invalid_token","error_description":"Authentication failed. The provided Bearer [REDACTED] is invalid, expired, or no longer recognized by the server. To resolve: clear authentication tokens in your MCP client and reconnect. Your client should automatically re-register and obtain new tokens."}
- WWW-Authenticate: Bearer error="invalid_token", error_description="[REDACTED]", resource_metadata="https://mcp.airbyte.ai/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.airbyte.ai/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.airbyte.ai/.well-known/oauth-authorization-server → HTTP 200
- GET https://mcp.airbyte.ai/authorize?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback&state=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.airbyte.ai%2Fmcp → HTTP 302
- GET https://cloud.airbyte.com/auth/realms/_airbyte-cloud-users/protocol/openid-connect/auth?response_type=%5BREDACTED%5D&client_id=%5BREDACTED%5D&redirect_uri=https%3A%2F%2Fmcp.airbyte.ai%2Fauth%2Fcallback&state=%5BREDACTED%5D&code_challenge=%5BREDACTED%5D&code_challenge_method=%5BREDACTED%5D&resource=https%3A%2F%2Fmcp.airbyte.ai%2Fmcp&prompt=%5BREDACTED%5D → HTTP 200

### contextqa

- POST https://mcp.contextqa.com/mcp → HTTP 401
- WWW-Authenticate: Bearer resource_metadata="https://mcp.contextqa.com/.well-known/oauth-protected-resource/mcp"
- GET https://mcp.contextqa.com/.well-known/oauth-protected-resource/mcp → HTTP 200
- GET https://mcp.contextqa.com/.well-known/oauth-authorization-server → HTTP 200
- POST https://mcp.contextqa.com/register → HTTP 201
- Registration response metadata: {"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"application_type":"web","redirect_uris":["https://mcptest.io/oauth/callback"],"client_secret_present":false,"client_secret_empty":false}

