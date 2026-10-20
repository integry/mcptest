# Analytics events

Every product analytics event is declared in the typed catalog in
[`src/utils/analytics.ts`](../src/utils/analytics.ts) (`AnalyticsEventCatalog`) and sent with
`trackEvent(name, params)`. The compiler rejects unknown event names, misspelled params and
values outside each param's union. This file is the reference for building the funnel
dashboard. When you add or change an event, update the catalog, this file, and the sample
payloads in `src/utils/analytics.test.ts` together.

Events go to Firebase Analytics (GA4). When Firebase is not configured, they are logged to
the console as `[Analytics Disabled]`.

## Privacy rules

- **No endpoint URLs.** A param may carry a server's **host** (`mcp.example.com:8443`),
  computed with `getAnalyticsHost`. It never carries the full URL, path, query string,
  credentials, headers, tokens or anything the user typed.
- **Redaction at send time.** `trackEvent` passes every param through
  `redactAnalyticsParams` before sending:
  - URL-shaped strings are reduced to their host.
  - Query strings, `Bearer`/`Basic` values, emails, JWTs and token-shaped runs (32+
    characters) become `[redacted]`.
  - String values under keys that look sensitive (`url`, `token`, `header`,
    `authorization`, `secret`, `password`, `cookie`, `credential`, `api_key`) are dropped.
  - Non-scalar values are dropped, and strings are capped at 100 characters, GA4's limit.

  The test suite checks that a sample payload for every event passes redaction unchanged.
- **Page views.** `logPageView` replaces endpoint URLs in `/report/…`, `/server/…` and
  `/call/…` paths with `[server]`, and dashboard names with `[space]`. Firebase's automatic
  `page_view` is turned off (`send_page_view: false`), so `logPageView` sends the only page
  views.
- **Page location on every event.** Without an override, GA4 attaches the full document URL
  to each event, which on report, server and OAuth callback routes would carry the endpoint,
  query credentials or the authorization code. `trackEvent` therefore always sets
  `page_location` to the origin plus the sanitized path, with no query string or fragment.
- **Do Not Track / Global Privacy Control.** mcptest has no consent banner. If the browser
  sends `navigator.doNotTrack` (`1`/`yes`, including the legacy `msDoNotTrack` and
  `window.doNotTrack`) or `navigator.globalPrivacyControl === true`, Firebase Analytics is
  never initialized and every event and page view is dropped
  ([`src/utils/privacySignals.ts`](../src/utils/privacySignals.ts)). The privacy policy page
  describes this.

## Funnel order

```
landing_view ─┬─ landing_connect ──────────────┐
guide_view ───┼─ guide_cta_click ──────────────┤
catalog list ─┴─ catalog_open_server ──────────┤
                 (advanced_options_open)       │
                                               ▼
                                         connect_attempt
                                               │  (oauth_flow: start → callback → success | error)
                                               ▼
                                         connect_result
                                               │
                                               ▼
                                        report_generated
                                               │
                                ┌──────────────┴──────────────┐
                                ▼                             ▼
                          report_shared                  badge_copied
```

Suggested funnel steps for the dashboard:

1. Entry: `landing_view`, `guide_view`, or a catalog page view.
2. Intent: `landing_connect`, `guide_cta_click`, `catalog_open_server`.
3. `connect_attempt`
4. `connect_result` with `outcome = connected`. Break down `auth_required` and `failed`
   by `diagnostic_ids`, and follow `oauth_flow` for the authorization drop-off.
5. `report_generated`
6. `report_shared` or `badge_copied`.

`sidebar_collapse` and `advanced_options_open` are interface signals, not funnel steps.

## Funnel events

| Event | Fires when | Params |
| --- | --- | --- |
| `landing_view` | The empty-playground landing (`LandingHero`) mounts. Fires once per landing shown. | `variant`: `new` \| `returning` (`returning` = the user has recent endpoints and sees recent chips) |
| `landing_connect` | Connect is pressed on the landing: the Connect button or Enter, a "Try with" quick pick, or a recent chip. | `source`: `manual` \| `quick_pick` \| `recent_chip`; `host` |
| `catalog_open_server` | A catalog server is opened in the playground for testing, from a catalog card's Test button or from a server profile. | `server_id` (catalog id); `surface`: `list` \| `profile` |
| `advanced_options_open` | The landing's "Advanced options" disclosure is opened. | none |
| `connect_attempt` | The playground starts a connection (`TabContent`). Fires before every connect, including automatic ones. | `source`: `manual` \| `quick_pick` \| `recent_chip` \| `catalog` (catalog tab auto-connect) \| `shared_link` (result-share link) \| `reconnect` (after OAuth, a bearer prerequisite or OAuth client setup); `transport_hint`: `streamable-http` \| `legacy-sse` \| `auto`; `proxy`: boolean (proxy fallback allowed) |
| `connect_result` | A connection attempt ends (`useConnection`). User aborts send `connect_abort` instead. | `outcome`: `connected` \| `auth_required` (OAuth redirect, client registration or another prerequisite, proxy login or proxy limit) \| `failed`; `protocol_era`: `stateless` \| `stateful` \| `legacy` \| `unknown`; `transport`: `streamable-http` \| `legacy-sse` \| `unknown`; `diagnostic_ids`: comma-separated detected or suspected transport diagnostic ids, e.g. `transport.accept-header-406`, or empty; `duration_ms` |
| `oauth_flow` | OAuth progress, in the playground (`useConnection`), on the report page (`ReportView`) and on the callback page (`OAuthCallback`). | `stage`: `start` (discovery and authorization begin) \| `callback` (the provider redirected back) \| `success` (a token was obtained) \| `error`; `provider_policy_id` (only for endpoints with a known provider policy, e.g. `canva`, `github`) |
| `report_generated` | A report finishes on the report page (`ReportView`). | `result_status`: `ready` \| `review` \| `blocked` \| `authorization-required` \| `unknown` (the release decision the report shows); `score_band`: `A`–`D`, `F`, or `unscored` (the grade shown next to the score); `surface`: `report_page` \| `playground` (reserved; the playground does not produce reports yet) |
| `report_shared` | A report is exported with Download JSON or Download Markdown. | `method`: `markdown` \| `json` \| `link` (reserved for a report share-link control, not emitted yet) |
| `badge_copied` | A badge embed snippet is copied successfully (`BadgeEmbed`). | `format`: `markdown` \| `html` \| `restructuredText`; `surface`: `report` \| `server_profile` |
| `guide_view` | A learn article page (`LearnArticlePage`) is shown, once per article. | `slug`; `track` (content track id) |
| `guide_cta_click` | A link inside a learn article is followed. In-page `#` anchors are ignored. | `slug` (current article); `destination`: `playground` \| `catalog` \| `catalog_server` \| `report` \| `guide` \| `docs` \| `external` \| `other` |
| `sidebar_collapse` | The desktop sidebar's collapse toggle is pressed. | `collapsed`: boolean (the new state) |

## Other product events

These are typed in the same catalog and follow the same privacy rules.

| Event | Fires when | Params |
| --- | --- | --- |
| `theme_changed` | The theme changes. | `theme_name` |
| `server_url_connection` | A `/server/<endpoint>` share link opens a tab. | `host`; `transport_method` (`mcp` \| `sse`, optional) |
| `result_share_connection` | A `/call/…` result-share link opens a tab. | `host`; `type`: `tool` \| `resource` |
| `create_tab`, `select_tab` | A playground tab is created or selected. | none |
| `close_tab` | A playground tab is closed. | `tab_count` |
| `disconnect` | The user disconnects. | none |
| `connect_abort` | The user aborts a connection attempt. | none |
| `access_resource`, `refresh_capabilities` | A resource is read, or the capability lists are refreshed. | none |
| `execute_tool`, `execute_prompt` | A tool or prompt is run. | none |
| `select_capability` | A tool, resource template or prompt is selected. | `capability_type`: `tool` \| `resource_template` \| `prompt` |
| `create_dashboard`, `create_space`, `select_dashboard`, `delete_dashboard`, `reorder_dashboards`, `refresh_current_dashboard` | Dashboard management. | none |
| `update_dashboard` | A dashboard is edited. | `updated_keys` (comma-separated field names) |
| `health_check_all_dashboards` | All dashboards are health-checked. | `dashboard_count` |
| `add_card_to_dashboard`, `add_card_to_space`, `execute_card` | A dashboard card is added or run. | `card_type` |
| `update_card`, `delete_card`, `move_card` | A dashboard card is changed. | none |
| `catalog_search` | The catalog search query changes. | `query_length` (the query itself is never sent) |
| `catalog_filter_auth`, `catalog_filter_category`, `catalog_sort` | A catalog filter or sort changes. | `filter`, `category`, `sort` |

Earlier, unstructured events were replaced by catalog events. `connect_success` and
`connect_failure` became `connect_result`, and `catalog_test_server` became
`catalog_open_server`. `server_url_connection` and `result_share_connection` now send a host
instead of the full endpoint URL and tool name.
