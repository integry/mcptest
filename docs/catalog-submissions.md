# Submitting a server to the catalog

The public catalog at `/catalog` and the pages under `/servers/<id>` are built from `src/data/serverCatalog.json`. There are two ways to add your remote MCP server:

1. **Submit it from the app** at [mcptest.io/submit](https://mcptest.io/submit). You need no GitHub account and no local checkout. This is the recommended path.
2. **Open a pull request yourself.** This path is described under [Manual pull request](#manual-pull-request) and suits listings that need fields the form does not offer, such as `requiredHeaders`, `alternativeEndpoints` or an `oauthRegistration` block.

Both paths end in a pull request that a maintainer reviews and merges, so the catalog stays reviewable as code. The [eligibility rules](#eligibility) apply to both.

## Submit from the app

### What you do

1. Open [mcptest.io/submit](https://mcptest.io/submit), or choose **Submit a server** at the bottom of the sidebar. If the playground is connected to a server, its endpoint is already filled in.
2. Choose **Check endpoint**. Your browser probes the endpoint with the same transport negotiation the playground uses. If the browser cannot read the response because of CORS, the check is repeated through the mcptest CORS proxy. The result shows:
   - whether the endpoint is reachable;
   - the transport (Streamable HTTP or legacy SSE) and the negotiated protocol version;
   - the authentication challenge, if any: OAuth (protected resource metadata), bearer token, or an unspecified 401;
   - whether the browser can read the server directly or needs the proxy (browser CORS);
   - the number of tools listed without credentials.

   **Submit for review** stays disabled until the check has run on the current URL and the endpoint either completed an MCP handshake or answered with an authentication challenge. If you edit the URL, run the check again.
3. Fill in the display name, a one or two sentence description, the category, and the homepage URL. Choose a logo statement:
   - **No logo**: a monogram is generated.
   - **From the publisher's official brand asset page** or **From Simple Icons**: also give the logo URL. For Simple Icons, link the icon in a pinned release, for example `https://github.com/simple-icons/simple-icons/blob/16.35.0/icons/<slug>.svg`.
4. Optionally leave a contact email so a maintainer can reach you. It is never written to the catalog, stored by mcptest.io, or returned by the API. It is passed to the workflow and appears in the pull request description, which is public on GitHub.
5. Confirm that you are authorized to list the server, and choose **Submit for review**. If the deployment has a human check (Cloudflare Turnstile), complete it first.

The page then shows a submission id and the proposed catalog id. The check result is attached to the submission as evidence.

### What happens next

1. The Worker route `POST /api/catalog/submissions` validates the submission against the [JSON Schema](../public/schemas/catalog-submission/v1.schema.json) (published at `https://mcptest.io/schemas/catalog-submission/v1.schema.json`). It also rejects:
   - URLs that are not HTTPS, or that contain credentials, a query string or a fragment;
   - IP literals, single-label hosts and private or reserved names such as `localhost`, `*.local`, `*.internal` or `*.home.arpa`;
   - endpoints that the catalog already lists. The URL is normalized before the comparison (lowercase host, no `www.`, no trailing slash, and no final `/mcp` or `/sse`);
   - more than 10 submissions per client address, or more than 5 per endpoint host name (on any port), in 24 hours.
2. The Worker triggers the `catalog-submission` [`repository_dispatch`](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event) event with the submission as the payload.
3. The [`Catalog submission`](../.github/workflows/catalog-submission.yml) workflow runs `npm ci` on Node 22, then:
   1. `scripts/apply-catalog-submission.ts` (through `npm run apply-catalog-submission -- apply`) re-validates the payload with the same schema and appends the entry to `serverCatalog.json`. The id is derived from the endpoint host (`https://mcp.acme.dev/mcp` becomes `acme`, with `-2` appended if `acme` is taken). The entry gets `listingSource: { "kind": "community-submission" }` and transport and auth taken from the browser evidence. A licensed logo is downloaded to `public/server-logos/<id>.svg` or `.png` with its license note. Redirects are followed by hand, at most 3, and every hop must pass the same HTTPS and public-host rules as the submitted URL before it is requested. A logo that cannot be downloaded or fails the asset rules, or a submission without one, gets a generated monogram (`generated-fallback`). Catalog tests derive membership from the seed; ordinary submissions do not require an expected-count update.
   2. `npm run validate-catalog -- --only <id>` probes the new server from the runner and merges its result into `catalogValidation.json` and `catalogCapabilities.json`. The command fails unless the server is `online`.
   3. `npm run validate-catalog-assets` checks the logo and provenance fields.
   4. The `report` step aligns the entry's transport and auth type with what the runner observed and writes the pull request body. The body contains the submitter's description, the browser-side evidence, the runner-side validation result with its log, the contact email, and a checklist for the maintainer.
   5. A pull request is opened from the branch `submissions/<submission id>` with the label `catalog-submission`. The submission id is the UUID the Worker returns, so every accepted submission gets its own branch and pull request. If either runner check failed, the pull request is opened as a **draft** that shows the failure.

Usually the pull request appears a few minutes after you submit. Two submissions that derive the same catalog id (for example `https://mcp.acme.dev/tenant-a` and `https://mcp.acme.dev/tenant-b`, both `acme` while neither is merged) open two separate pull requests. They conflict with each other, so rename the id in one of them before merging both.

### Reviewing a submission pull request

Work through the checklist in the pull request body. In particular:

- The browser evidence was produced on the submitter's machine and is only a hint. The runner result is authoritative. Do not merge a draft whose runner validation failed; ask the submitter to fix the endpoint, or close the pull request.
- Check that the endpoint belongs to the named publisher and that the homepage documents it. If the publisher runs the listing, change `listingSource` to `{ "kind": "publisher", "url": "<official docs URL>" }`.
- Edit the description, tags, id or category on the branch if needed. If you rename the id, rename the logo file and update `catalogValidation.json` and `catalogCapabilities.json` as well.
- For OAuth servers, add an `oauthRegistration` block when the registration requirements are known.
- Pull requests created with the workflow's `GITHUB_TOKEN` do not trigger the `CI` workflow. Close and reopen the pull request, or push a commit to the branch, to run CI before you merge.

### Configuration for maintainers

The submission route runs in the state Worker (`cloudflare-worker/src/submissions.js`), which is also mounted at `mcptest.io/api/catalog/submissions`, so the form posts to the same origin.

| Setting | Where | Required | Purpose |
| --- | --- | --- | --- |
| `GITHUB_DISPATCH_TOKEN` | Worker secret | Yes | A fine-grained personal access token limited to `integry/mcptest` with **Contents: Read and write**, which `POST /repos/{owner}/{repo}/dispatches` requires. A classic token needs the `public_repo` scope. Without it the route answers `503 submissions_not_configured`. |
| `TURNSTILE_SECRET` | Worker secret | No | Enables the human check. When it is set, every submission must carry a valid Turnstile token, verified with `siteverify`. When it is not set, the check is skipped. |
| `VITE_TURNSTILE_SITE_KEY` | App build environment | With `TURNSTILE_SECRET` | The site key of the same Turnstile widget. The form renders the widget only when this is set. Set both or neither. |
| `GITHUB_DISPATCH_REPOSITORY` | Worker var (`wrangler.toml`) | No | Repository that receives the dispatch. Defaults to `integry/mcptest`. |
| `SUBMISSION_RATE_LIMITER` | Durable Object binding (`wrangler.toml`) | Yes | Per-address and per-host counters. Created by the `v2` migration on the next deploy. Only timestamps are stored, under a SHA-256 hash of the client address or the endpoint host. |
| `VITE_CATALOG_SUBMISSION_URL` | App build environment | No | Overrides the same-origin `/api/catalog/submissions`, for example during local development against a deployed Worker. |

```bash
cd cloudflare-worker
npx wrangler secret put GITHUB_DISPATCH_TOKEN
npx wrangler secret put TURNSTILE_SECRET   # optional
npx wrangler deploy
```

The workflow itself uses only the repository's `GITHUB_TOKEN`, with `contents: write` and `pull-requests: write`. The repository setting **Allow GitHub Actions to create and approve pull requests** must be enabled, as it is for the revalidation workflow.

To run the workflow without the app, send the dispatch yourself:

```bash
jq '{event_type: "catalog-submission", client_payload: .}' scripts/fixtures/catalog-submission/payload.json \
  | gh api repos/integry/mcptest/dispatches --input -
```

To run its steps locally on a scratch copy of the repository:

```bash
npm run apply-catalog-submission -- apply --payload scripts/fixtures/catalog-submission/payload.json --state /tmp/state.json
npm run validate-catalog -- --only acme-weather
npm run validate-catalog-assets
npm run apply-catalog-submission -- report --payload scripts/fixtures/catalog-submission/payload.json \
  --state /tmp/state.json --validation-outcome failure --assets-outcome success --output /tmp/pr-body.md
```

## Manual pull request

To list a server by hand, open a pull request against `master` that changes the files listed below.

## Eligibility

- The server must be reachable over HTTPS using Streamable HTTP or legacy SSE. Servers that only run locally over stdio are not listed.
- The endpoint must appear in the publisher's official documentation, official GitHub repository, or the official MCP Registry. The pull request must link to that page.
- Endpoints with per-user or per-tenant placeholders (for example `https://<your-subdomain>.example.com/mcp`) are not listed unless the publisher also documents a fixed shared endpoint.
- One entry per endpoint. Regional or credential-specific variants of the same server go in `alternativeEndpoints`, not in separate entries.

## What to change

1. **`src/data/serverCatalog.json`**: append one object. Follow the existing entries and the `CatalogServerSeed` type in `src/types/catalog.ts`. The required fields are:
   - `id`: a lowercase kebab-case slug. It is used in `/servers/<id>` and as the logo filename.
   - `name`, `url`, `category`, `tags`, `transport` (`streamable-http` or `legacy-sse`).
   - `description`: one or two factual sentences for a developer deciding whether to connect. Say what data or actions the server exposes and what authentication it needs. Do not use marketing copy.
   - `listingSource`: `{ "kind": "publisher", "url": "<official docs URL>" }`. Use `mcp-registry` together with `registryUrl`, `registryName`, and `registryVersion` when the official MCP Registry is the source. Use `community` only for listings that the publisher does not run. `community-submission` is set by the in-app submission workflow; do not use it by hand.
   - `directoryListings` (optional): one object per client connector directory that lists the server, `{ "directory": "claude" | "chatgpt", "id": "<the directory's own id>", "url": "<HTTPS page of the entry>" }`. Use the directory's public page as `url` when entries have no page of their own. Record it on any entry, whatever its `listingSource.kind`; directory imports match on `directory` plus `id`, not on the endpoint URL.
   - `relevance` (optional): an integer from 0 to 100 for how widely used the server is. The default catalog order lists higher scores first; entries without a score count as 0 and stay in file order. Base it on public popularity evidence such as a directory's ranking, not on preference, and keep scores comparable across entries.
   - Use `listingSource.kind` `client-directory` only when a directory lists the server and no publisher documentation covers the endpoint. Its `url` must be the `url` of one of the `directoryListings`. When publisher documentation exists, use `publisher` and still record `directoryListings`. If the only working endpoint is client-specific (for example a `/claude/` or `/anthropic` path), keep it and say so in `caveats`.
   - `requiresOAuth` and `authType` (`none`, `oauth`, `bearer-token`, `api-token`, `api-key`). Record what validation observes, not only what the docs say.
   - For OAuth servers, an `oauthRegistration` block. Use `"mode": "unknown"` with `evidenceUrl` and `reviewedAt` unless you have tested the registration flow against hosted mcptest.
   - Optional fields: `requiredHeaders` (header templates with exactly one `<PLACEHOLDER>` and never a real credential), `alternativeAuthTypes`, `alternativeEndpoints`, `exactEndpointOnly` (set this when the documented URL is an origin root or a non-standard path that must not be rewritten to `/mcp` or `/sse`), `caveats`, `homepageUrl`, and `sourceUrl`.
   - Use an existing category where one fits. Propose a new category only when several servers need it.
2. **`public/server-logos/<id>.svg` or `.png`**: the logo file. See the logo rules below.
3. **`src/data/catalogValidation.json`** and **`src/data/catalogCapabilities.json`**: regenerate these with `npm run validate-catalog`. Do not edit them by hand.

Catalog tests in **`src/utils/catalogUtils.test.ts`** derive expected membership from the seed. No exact catalog-size update is needed for a submission. A separate size guard only checks a lower bound: it fails if the catalog shrinks more than 10% below a reviewed baseline of 297 entries, to catch accidental truncation. Growth is never capped, so ordinary submissions do not need to touch it; if a deliberate bulk removal goes below that bound, review the removals and update the baseline in the same PR.

## Validation

Run these commands locally before you open the pull request:

```bash
npm run validate-catalog         # probes every endpoint and rewrites the validation and capability snapshots
                                 # (add -- --only <id> to probe one server and keep every other stored result)
npm run validate-catalog-assets  # checks logo files and provenance fields
npm test
npm run typecheck
npm run build                    # also generates the static /servers/<id> pages and the sitemap
```

`npm run validate-catalog` performs a real MCP handshake against the exact `url` first. Unless `exactEndpointOnly` is set, it then tries the conventional `/mcp` and `/sse` variants. For each server it records reachability, transport, protocol era and version, and the observed authentication requirement, including OAuth protected-resource metadata. For servers that complete an unauthenticated handshake, it also stores a capability snapshot (tools, resources, and prompts).

An entry is accepted only if validation reports it `online`. A server that answers with an authentication challenge counts as online. Any other failure, such as a network error, a protocol error, an unexpected response, or an intermittent session error, blocks the entry until the publisher fixes it.

`npm run import-catalog-capabilities -- --server <id> --report <public-report.json>` imports a capability inventory from a public mcptest report. Use it when the server requires authentication and you want to publish an authenticated tool list.

## Scheduled revalidation

The evidence in `src/data/catalogValidation.json` and `src/data/catalogCapabilities.json` is refreshed by the [`Catalog revalidation`](../.github/workflows/catalog-revalidation.yml) GitHub Actions workflow. Server pages and the `/badge/server/<id>.svg` badges show the timestamps from these files.

**How often.** The workflow runs every Monday at 06:17 UTC. It runs only on that schedule and on manual dispatch. Pull requests and pushes never trigger it.

**What it does.** On Node 22 it runs `npm ci`, then:

1. `npm run validate-catalog` probes every live endpoint. Each request times out after 12 seconds, and each server gets at most 120 seconds for all its probes. A server that runs out of time is recorded as `offline` with `errorCode: "timeout"`. Responses that are not the MCP server failing are named with `responseClass` (the same classifier as the playground, `src/utils/responseClassification.ts`): a CDN or WAF challenge is `unknown` with `responseClass: "bot-protection"` and `errorCode: "bot_protection"`, a `429` is `unknown` with `"rate-limited"` and `errorCode: "rate_limited"`, and a `402` (including x402) stays `online` with `responseClass: "payment-required"` and gets the "payment required" badge instead of a broken one. A `403` from bot protection does not count as an authentication challenge; a `403` with `WWW-Authenticate` does.
2. `npm run import-catalog-capabilities -- --all` checks every stored capability snapshot against the canonical schema, including authenticated inventories that were imported from public reports, and drops snapshots for servers that are no longer in the catalog.
3. `npm run validate-catalog-assets` checks the logos and provenance fields.
4. `npm run summarize-catalog-diff` compares the files before and after the run and writes the pull request body.
5. If either evidence file changed (including refreshed timestamps), the workflow opens a pull request from the `bot/catalog-revalidation` branch, or force-updates the one that is already open. If the evidence now matches `master` again, it closes the open bot pull request and deletes the branch.

The job times out after 30 minutes. A concurrency group ensures that two runs never overlap. A failure in any step, including a validator crash, fails the run, and GitHub reports it in the Actions tab. The job's token can only write repository contents and pull requests.

The output is deterministic. Fields are written in a fixed order, and servers keep their catalog order. Every server probed in the run gets a fresh `checkedAt`, and every capability snapshot the validator observed gets a fresh `observedAt`, so both always record when the evidence was last confirmed. Imported authenticated inventories that the validator cannot observe keep their own `observedAt`. Because of the refreshed timestamps, a run normally produces a pull request even when nothing else changed; the summary then reports no observable change, and merging it only refreshes the timestamps shown on server pages and badges.

**Run it manually.** Go to **Actions → Catalog revalidation → Run workflow** and choose `master`, or use the CLI:

```bash
gh workflow run catalog-revalidation.yml --ref master
gh run watch "$(gh run list --workflow catalog-revalidation.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

To run the same steps locally without opening a pull request:

```bash
cp src/data/catalogValidation.json /tmp/before-validation.json
cp src/data/catalogCapabilities.json /tmp/before-capabilities.json
npm run validate-catalog
npm run import-catalog-capabilities -- --all
npm run validate-catalog-assets
npm run summarize-catalog-diff -- \
  --before-validation /tmp/before-validation.json --after-validation src/data/catalogValidation.json \
  --before-capabilities /tmp/before-capabilities.json --after-capabilities src/data/catalogCapabilities.json \
  --catalog src/data/serverCatalog.json
```

With [`act`](https://github.com/nektos/act), `act workflow_dispatch -W .github/workflows/catalog-revalidation.yml -s GITHUB_TOKEN="$(gh auth token)"` runs the whole job, and the last step opens a real pull request. Add `--container-architecture linux/amd64` on Apple silicon.

**Review the bot pull request.**

1. Read the summary table and its sections. They list servers that went online or offline (with the error code), protocol version or era changes, transport changes, authentication changes (auth type and authorization servers), tool count changes with the names of added and removed tools, and other capability changes (for example a tool, resource or prompt section that became unavailable) with the fields that changed. Timestamp-only changes count as no observable change. Protocol, transport and auth changes are listed only for servers that were online in both runs, because a status change already explains the rest.
2. For each server that went offline, check whether it is a transient failure, such as a `timeout`, or a real outage. Re-run the workflow or run `npm run validate-catalog` locally to confirm. A server that stays offline for several runs needs a catalog change in a separate pull request: an updated `url`, a caveat, or removal.
3. If a server's observed authentication no longer matches the `authType` declared in `serverCatalog.json`, update the seed in a separate pull request.
4. The diff should touch only the two evidence files. Then merge. If the evidence looks wrong, close the pull request; the next run opens a new one.

Pull requests created with the workflow's `GITHUB_TOKEN` do not trigger the `CI` workflow. To run CI on the bot pull request, close and reopen it, or push an empty commit to `bot/catalog-revalidation`.

## Logo requirements

Each entry needs a local logo file, a provenance record, and a license note. `npm run validate-catalog-assets` enforces the following:

- The file lives in `public/server-logos/`, is named `<id>.svg` or `<id>.png`, and is under 256 KB. SVGs must have a `viewBox` and must not contain scripts, event handlers, external references, or embedded data URLs. PNGs must be square, 128–512 px, and transparent.
- `logoSourceKind` is one of:
  - `official-brand`: from the publisher's brand or press-kit page.
  - `official-site`: an icon served from the publisher's own site.
  - `publisher-repository`: from the publisher's official source repository.
  - `simple-icons`: from [Simple Icons](https://github.com/simple-icons/simple-icons). Pin the release tag in the URL (for example `.../blob/16.35.0/icons/<slug>.svg`, with no leading `v`).
  - `generated-fallback`: a locally generated monogram. Leave out `logoSourceUrl`, and say in the note that the monogram is generated and is not an official mark.
- Every logo except a generated fallback needs `logoSourceUrl` (HTTPS). Every logo needs `logoRetrievedAt` (`YYYY-MM-DD`).
- `logoLicenseNote` states where the mark came from and that trademark rights stay with the owner. Example: `"Acme mark from Simple Icons version 16.35.0; trademark rights remain with Acme."`
- Prefer the publisher's official brand assets. If no clearly licensed mark exists, use a generated monogram. Do not copy images from arbitrary third-party sites.

## Review checklist

- [ ] The endpoint is linked from official publisher documentation.
- [ ] `npm run validate-catalog` reports the server `online`, and the declared `authType` matches what it observed.
- [ ] The description is factual and names the authentication method.
- [ ] The logo provenance and license note are complete.
- [ ] `npm test`, `npm run typecheck`, `npm run validate-catalog-assets`, and `npm run build` pass.

## Batch 19 import

GitHub issue [#755](https://github.com/integry/mcptest/issues/755) tracks this import under TODO `ff14e799-4a20-42ec-9345-51b2c726d117`. The catalog grew from 856 to 888 entries after matching the new records against the existing catalog.

The validator reached all 32 primary URLs. It stored anonymous, partial tool inventories for Community Funding NZ (eight tools), Mintlify Search (three), Spotify Confidence Docs (six) and Synthflow Docs (one). The other 28 primary URLs returned OAuth challenges. Retell's direct anonymous initialization and the validator's OAuth challenge are both recorded in the app entry's caveat.

The 38 supplied relevance updates were applied, and the 23 previously unscored records still have no score. Spotify Confidence Flags and the Synthflow account server are queued outside this batch. Make's `/v2` endpoint is recorded as an alternative. Its `/claude` plugin attribution is pending endpoint identity evidence.

### Directory attribution follow-up

The five plugin mappings in issue #755 and the publisher-verified Exa and Firecrawl Search plugin mappings are already present. The follow-up verified the two later Claude plugin additions against Anthropic's marketplace records and the publisher manifests. It also verified Quo's ChatGPT listing against the public release, which names the legacy SSE endpoint. The existing Claude connector and publisher source remain on each record.

| Catalog entry | Verified listing | Endpoint evidence |
|---|---|---|
| `railway` | [`directoryPlugin.db04e594-b3b0-4640-8650-2836212fc16e`](https://claude.com/marketplace/plugins/railway) | [Railway plugin manifest](https://github.com/railwayapp/railway-skills/blob/950acebcef3445f3915ea0709876c3ba9c237a7f/plugins/railway/.mcp.json) declares `https://mcp.railway.com`. |
| `neon` | [`directoryPlugin.f204c8c5-e0ff-4c8d-a81d-d14ea6a4e154`](https://claude.com/marketplace/plugins/neon) | [Neon plugin manifest](https://github.com/neondatabase/agent-skills/blob/bfd013c352ed31b57a573e4f60263afc5fdd7f7a/plugins/neon-postgres/mcp.json) declares `https://mcp.neon.tech/mcp`. |
| `quo` | [`plugin_asdk_app_69e6af3297d88191b4925772c50df286`](https://chatgpt.com/plugins/plugin_asdk_app_69e6af3297d88191b4925772c50df286) | The [ChatGPT release](https://chatgpt.com/backend-anon/ps/plugins/plugin_asdk_app_69e6af3297d88191b4925772c50df286) declares `https://mcp.quo.com/sse`. The [Claude marketplace](https://claude.com/marketplace/connectors/quo) confirms the existing connector `connector.5b1d1665-4793-4a8c-98cf-909e00e97a29` at `https://mcp.quo.com/mcp`. |

**Pending reconciliation.** ProPR returned HTTP 401 for the import TODO and requires sign-in for the amendment runs linked from issue #755. The issue does not enumerate the remaining 51 Claude mappings. Public marketplace and publisher records can confirm listing identities and endpoint matches, but the amendment table is needed to establish which 51 mappings are in this batch.

### Endpoint evidence

- **Hugging Face.** The primary `https://huggingface.co/mcp` passed anonymous Streamable HTTP validation with MCP `2026-07-28`. A separate anonymous discovery session using MCP `2025-11-25` listed `hf_fs`, `hf_whoami`, `hub_repo_details`, and `hub_repo_search`. The catalog sanitizer marked the tool inventory `partial` and retained all four tools. The snapshot also retained 100 of 160 resources and recorded an empty template list and an unsupported `prompts/list` response (`-32601`). Anonymous initialization at `https://huggingface.co/mcp?login` returned HTTP 401 with a Bearer challenge pointing to `https://huggingface.co/.well-known/oauth-protected-resource/mcp?login`.
- **Quo.** The primary `https://mcp.quo.com/mcp` and the [documented legacy SSE alternative](https://mcp.openphonelabs.com/) both returned HTTP 401 without credentials. The SSE response advertised a Bearer challenge with `error="invalid_token"` and resource metadata at `https://mcp.quo.com/.well-known/oauth-protected-resource/sse`. The primary validator recorded the OAuth challenge and obtained no anonymous inventory.

## Batch 20 import

GitHub issue [#757](https://github.com/integry/mcptest/issues/757) tracks this import. The post-#756 catalog grew from 889 to 922 entries. Matching the 33 candidates first on directory and listing ID, then on normalized primary, browser, and alternative URLs, found no existing matches. The import appended 48 directory listings to the new entries and 51 Claude plugin listings to existing entries. Existing listing sources and registry and community attribution were preserved.

### Relevance snapshot

The [Claude connector index](https://claude.com/marketplace/connectors-plugins) and [plugin index](https://claude.com/marketplace/plugins) were retrieved at 22:15:11 UTC on November 24, 2026. The connector index returned 1,218 records, including 1,214 numeric popularity scores. The plugin index returned 543 records at import time. The issue recorded 542, and all 51 requested plugin IDs were available in the live index.

The [connector snapshot](catalog-batch-20-claude-snapshot.tsv) records each connector ID and score in the original array order from the connector page's embedded Next.js payload. The source HTML SHA-256 was `6688e462990f127774ff962a132ba3c6313675896370e8732a84a861906885e6`.

Sort numeric scores in descending order, preserving snapshot order for ties. For a one-based rank, compute `Math.round(100 * (1214 - rank) / 1214)`. Apply it when a catalog entry has exactly one ranked Claude listing, as in the [batch 15 review](catalog-batch-15-review-evidence.md). This reproduced all 64 changes to prior records, including the seven additions from batch 19, and matched all 33 supplied batch 20 scores. Arca moves from 32 to 37 at rank 767, and VistaPrint from 42 to 46 at rank 654. Windsor.ai retains 96 under the multiple-listing convention. The 24 unlisted, unscored entries remain unscored.

### Validation and endpoint provenance

- The repository validator reached all 33 primaries. It recorded OAuth evidence for 31 gated endpoints and a bearer challenge for Coralogix EU2, which also published OAuth metadata. Drata's saved validator result names the slashless endpoint. A separate exact initialization at the catalog's trailing-slash URL returned HTTP 401.
- LegalZoom's primary and `/mcp/v1` identified themselves as `legalzoom-default` at build `ac1cc3978d33b139badb44ae3a0af8c363fd88a0`. The canonical snapshot records four anonymously discovered tools at the primary only. The plugin route returned HTTP 401 before identifying itself. [LegalZoom manifest](https://github.com/legalzoom/claude-plugins/blob/f9fd8a0ca6e1421bc1aacb113a109663a7a6f6d8/plugins/legalzoom/.mcp.json)
- Exact initialization at all 28 Zoho regional alternatives returned HTTP 401 with protected-resource metadata. Removing the `claude-` prefix from the US hostnames changed the metadata URLs. The catalog retains the prefix and `/mcp/message` path for every region.
- Claude lists alternate routes for Crustdata, Lawve AI and Inkbox. The Crustdata Claude route advertises a separate authorization server. ChatGPT releases name the alternatives for Crustdata, Idiolect and Inkbox, and the primaries for Grain, RocketReach and Cognito Forms. The public ChatGPT releases for Sonos, Gem, LunarCrush, Mem and Circleback confirm listing membership and omit their MCP endpoint URLs.
- LogRocket's bare primary is retained. The publisher's Claude plugin requests the same route with `?toolsets=all`. [LogRocket manifest](https://github.com/logrocket/logrocket-claude-plugin/blob/2e44dbb47faf9bb54e3405a8ae2714e7c5ce9791/plugins/logrocket/.mcp.json)
- ChatGPT mappings for Webull and Funnel are pending. HYPD AI remains queued for a later batch. Crypto.com, Zillow, Lawstronaut, pg-aiguide and Tracy AI Interviewer remain deferred under the issue's inventory validation findings.

## Batch 21 import

The post-#758 catalog grew from 922 to 946 entries with 24 additions. TRES Finance is deferred to the later OAuth batch. The Retell ChatGPT app already matched the supplied directory ID and normalized endpoint. Its catalog ID is now `retell-ai-chatgpt`. The Retell SDK retains its publisher source, relevance, and separate endpoint. [Tracking issue #759](https://github.com/integry/mcptest/issues/759) · [Maintainer scope decision](https://github.com/integry/mcptest/pull/760#issuecomment-7170423694)

Publisher manifests confirm that the Mapbox plugin configures the geocoding, Documentation, and DevKit servers, and that the Sales Cloud plugin configures Salesforce Headless 360 and Slack. Each distinct endpoint carries its plugin's directory ID. Buffer's public ChatGPT release names the existing Buffer endpoint. The existing Mapbox, Slack, and Buffer records retain their publisher sources and scores. [Mapbox manifest](https://github.com/mapbox/mapbox-agent-skills/blob/84d991e36ad5ac7195796ff9e9fdc378155f470c/.mcp.json) · [Sales Cloud manifest](https://github.com/salesforce/salesforce-skills/blob/80434ffa64fad714c52bb1dc7475783306997ca7/salesforce-for-sales/.mcp.json) · [Buffer release](https://chatgpt.com/backend-anon/ps/plugins/plugin_asdk_app_6ae21da086548191a7c824ea3dd59064)

The recorded catalog validation shows all 24 additions and the reconciled Retell app online. Mapbox Documentation listed three tools anonymously. The default validator received an OAuth challenge at the Retell app. A separate anonymous session negotiated MCP 2025-06-18 as Retell 2.4.0 and listed 27 tools and six resources. Its prompt listing returned HTTP 401. Retell's protected-resource metadata names the Render endpoint, where a separate anonymous session also identified Retell 2.4.0. All 12 Sigma regional URLs returned HTTP 401 during anonymous initialization. Authenticated inventories remain unverified. [Retell protected-resource metadata](https://chatgpt-app.retellai.com/.well-known/oauth-protected-resource/mcp) · [Sigma regional endpoints](https://github.com/sigmacomputing/sigma-plugin/blob/0dfd34f1086060e7faea43adad562fb070aa04a8/README.md)

The ProPR import TODO returned HTTP 401. The public batch records identified three additional queued servers whose publisher-documented endpoints passed validation. Synthflow shares its Claude plugin with the existing documentation server. Its connector ranked 856 of 1,214 for a relevance score of 29. Spotify Confidence Flags shares its plugin with Spotify Confidence Docs. HYPD AI uses its publisher's shared OAuth endpoint and has no verified directory ID or relevance score in this import. [Issue #755](https://github.com/integry/mcptest/issues/755) · [Issue #757](https://github.com/integry/mcptest/issues/757) · [Claude connector index](https://claude.com/marketplace/connectors-plugins)

The batch 14 carry-forward evidence supplied seven more verified entries. CharGen, Hoplix, PyAI, Signal8, TenderLead, and Vokolla completed anonymous sessions using MCP 2025-11-25 and returned tool lists. The canonical snapshots record only the sections observed, with the catalog size and privacy limits applied. The default validator received OAuth challenges for these endpoints. Semgrep AppSec Platform returned HTTP 401 at its primary and read-only URLs. Vokolla's ChatGPT release names the editorial profile, recorded as an alternative. The batch 15 carry-forward identified OKX, whose protected-resource metadata confirms the exact Claude connector endpoint. It returned HTTP 401 and ranks 887 of 1,214 for a relevance score of 27. [Batch 14 evidence](catalog-batch-14-review-evidence.md#carry-forward) · [Batch 15 evidence](catalog-batch-15-review-evidence.md) · [OKX protected-resource metadata](https://www.okx.com/api/v1/mcp/trading-oauth-simple/.well-known/oauth-protected-resource)

### Batch 21 follow-up

The ProPR import TODO `ff14e799-4a20-42ec-9345-51b2c726d117` requires separate access. The correction run reported 1,224 records and 1,221 numeric popularity scores from the public Claude connector index retrieved on November 25, 2026. It recorded the source HTML SHA-256 as `fdb90f7c42e95ac67b8dc01a5ac9022fd6741d9b320477b8aa81c5954e81593b` and attributed 76 relevance changes to that input, including the three specialized WeInc connectors. The six queued initial scores of 50 were assigned to CharGen, Hoplix, PyAI, Signal8, TenderLead, and Vokolla. [Claude connector index](https://claude.com/marketplace/connectors-plugins)

Funnel's ChatGPT listing connects to the global server. For EU-hosted accounts, enable Developer mode in ChatGPT, add a custom plugin using `https://mcp.eu.ai.funnel.io/mcp` and OAuth, then sign in to Funnel. Anonymous initialization of the EU endpoint returned HTTP 401 with an OAuth challenge. Its protected-resource metadata reports the exact EU URL. [Global ChatGPT listing](https://chatgpt.com/plugins/funnel) · [Funnel's ChatGPT setup guide](https://help.funnel.io/en/articles/16522580-connect-funnel-mcp-to-chatgpt) · [EU protected-resource metadata](https://mcp.eu.ai.funnel.io/.well-known/oauth-protected-resource/mcp)

#### Claude relevance evidence

**Maintainer decision required.** The original HTML and ordered ranking input could not be recovered from the available Git history, prior run bundle path, or GitHub Actions artifacts. The public archive returned no capture for the retrieval date, the live HTML hash differed, and the ProPR correction task API required authentication (HTTP 401). The reported HTML hash, denominator, and source-derived scores remain unverified. A maintainer needs to decide whether to obtain the original response from the correction run or explicitly accept the provenance gap. [Correction run](https://ui.gitfix.dev/tasks/pr-comments-batch-integry-mcptest-760-1795615667711) · [Partial ProPR review](https://github.com/integry/mcptest/pull/760#issuecomment-7173223817)

If the original HTML becomes available, verify its SHA-256 with `sha256sum`, extract the ordered connector array from the embedded Next.js payload, and check for 1,224 records and 1,221 numeric scores. Sort the numeric scores descending, preserving source order for ties. For catalog entries with exactly one ranked Claude listing, compute `Math.round(100 * (1221 - rank) / 1221)` using one-based rank. Compare the computed values and the set of changed IDs against the Git comparison below.

The comparison starts at `a3613ed6bc9e08408703fb2afe0016af93716dde`, immediately before the corrections, and ends at the correction commit `b4ac0334a5d2c24c4c8913593c48ca72804cdd00`. It records 76 changed values on entries with Claude listings and six separate initial scores. All 82 values are present at reviewed head `6f872e5353cf8f75ad8b75f2dab425234dd5d670`. Run this from the repository root to print every changed value and its Claude listing IDs as TSV. [Download the exact correction diff](https://github.com/integry/mcptest/compare/a3613ed6bc9e08408703fb2afe0016af93716dde..b4ac0334a5d2c24c4c8913593c48ca72804cdd00.diff)

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const readCatalog = (revision) => new Map(JSON.parse(execFileSync('git', [
  'show', `${revision}:src/data/serverCatalog.json`,
], { maxBuffer: 20_000_000 })).map((entry) => [entry.id, entry]));
const before = readCatalog('a3613ed6bc9e08408703fb2afe0016af93716dde');
const corrected = readCatalog('b4ac0334a5d2c24c4c8913593c48ca72804cdd00');
const reviewed = readCatalog('6f872e5353cf8f75ad8b75f2dab425234dd5d670');
assert.deepEqual(new Set(corrected.keys()), new Set(before.keys()));
assert.deepEqual(new Set(reviewed.keys()), new Set([...corrected.keys()].filter((id) => id !== 'tres-finance')));

const initial = new Set(['char-gen', 'hoplix', 'pyai', 'signal8', 'tenderlead', 'vokolla']);
const changes = [];
for (const [id, entry] of corrected) {
  if (reviewed.has(id)) assert.equal(reviewed.get(id).relevance, entry.relevance, id);
  const previous = before.get(id);
  if (previous.relevance === entry.relevance) continue;
  const listings = (previous.directoryListings ?? [])
    .filter(({ directory }) => directory === 'claude')
    .map((listing) => listing.id);
  if (initial.delete(id)) {
    assert.equal(previous.relevance, undefined, id);
    assert.equal(entry.relevance, 50, id);
    continue;
  }
  assert(listings.length > 0, id);
  assert.equal(reviewed.get(id)?.relevance, entry.relevance, id);
  changes.push([id, previous.relevance ?? 'unset', entry.relevance, listings.join(',')]);
}
assert.equal(initial.size, 0);
assert.equal(changes.length, 76);
console.log('id\tbefore\tafter\tclaudeListingIds');
for (const row of changes) console.log(row.join('\t'));
JS
```

#### Complete capability comparison

The reviewed PR base is `c3fd6700c98f3f6c951e86c3971d97568c02b094` and the reviewed head is `6f872e5353cf8f75ad8b75f2dab425234dd5d670`. The downloadable diff includes the complete `src/data/catalogCapabilities.json` patch (14,182 added and 8,635 removed lines). Its file section matched the local Git diff byte for byte. [Download the full diff](https://github.com/integry/mcptest/compare/c3fd6700c98f3f6c951e86c3971d97568c02b094..6f872e5353cf8f75ad8b75f2dab425234dd5d670.diff) · [Base JSON](https://raw.githubusercontent.com/integry/mcptest/c3fd6700c98f3f6c951e86c3971d97568c02b094/src/data/catalogCapabilities.json) · [Head JSON](https://raw.githubusercontent.com/integry/mcptest/6f872e5353cf8f75ad8b75f2dab425234dd5d670/src/data/catalogCapabilities.json)

The base contains 441 snapshots and the head contains 449. All 441 base IDs remain present with deeply equal JSON values. There are zero removals and zero modifications to existing snapshot values. The eight new snapshot IDs are `char-gen`, `hoplix`, `mapbox-docs`, `pyai`, `retell-ai-chatgpt`, `signal8`, `tenderlead`, and `vokolla`. The base had no snapshot under the legacy Retell ChatGPT ID.

Run this from the repository root to reproduce the patch and check every snapshot at the pinned revisions. It requires Git and Node.js.

```sh
git diff --no-ext-diff --no-textconv \
  c3fd6700c98f3f6c951e86c3971d97568c02b094 6f872e5353cf8f75ad8b75f2dab425234dd5d670 \
  -- src/data/catalogCapabilities.json

node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const readSnapshots = (revision) => JSON.parse(execFileSync('git', [
  'show', `${revision}:src/data/catalogCapabilities.json`,
], { maxBuffer: 20_000_000 }));
const base = readSnapshots('c3fd6700c98f3f6c951e86c3971d97568c02b094');
const head = readSnapshots('6f872e5353cf8f75ad8b75f2dab425234dd5d670');
assert.equal(Object.keys(base).length, 441);
assert.equal(Object.keys(head).length, 449);
for (const [id, snapshot] of Object.entries(base)) {
  assert(Object.hasOwn(head, id), id);
  assert.deepEqual(head[id], snapshot, id);
}
assert(!Object.hasOwn(base, 'retell-ai-chatgpt-app'));
const added = Object.keys(head).filter((id) => !Object.hasOwn(base, id)).sort();
assert.deepEqual(added, [
  'char-gen', 'hoplix', 'mapbox-docs', 'pyai', 'retell-ai-chatgpt', 'signal8', 'tenderlead', 'vokolla',
]);
console.log('441 preserved, zero removed or modified, eight added', added);
JS
```

#### Reproduce the batch 21 review

Use the PR base `c3fd6700c98f3f6c951e86c3971d97568c02b094`. Generate the full comparison locally with Git to include the capability patch that GitHub omitted from the earlier review.

```sh
base=c3fd6700c98f3f6c951e86c3971d97568c02b094
git diff --no-ext-diff --binary --full-index "$base" HEAD
gh api -H 'Accept: application/vnd.github.diff' "repos/integry/mcptest/compare/$base...$(git rev-parse HEAD)"
gh issue view 759 --repo integry/mcptest --json body,comments,url
npm run build
CHROME_PATH=/usr/bin/chromium npm run test:e2e -- tests/e2e/not-found.e2e.ts -g 'legacy Retell'
```

For a structural check, save the following as `dist/verify-batch-21.mts` after building and run `npx vite-node --script dist/verify-batch-21.mts`. It verifies the 24 additions with recorded online validation, the TRES Finance exclusion, normalized endpoint uniqueness across the full catalog, all 441 preserved inventories and eight new ones, and the generated Retell alias and canonical sitemap entry.

```ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeCatalogEndpoint } from '../src/utils/catalogSubmission.ts';

const base = 'c3fd6700c98f3f6c951e86c3971d97568c02b094';
const read = (name, ref?) => {
  const path = `src/data/${name}.json`;
  return JSON.parse(ref
    ? execFileSync('git', ['show', `${ref}:${path}`], { maxBuffer: 20_000_000 })
    : readFileSync(path, 'utf8'));
};
const legacy = 'retell-ai-chatgpt-app';
const canonical = 'retell-ai-chatgpt';
const deferred = 'tres-finance';
const prior = read('serverCatalog', base);
const current = read('serverCatalog');
const priorIds = new Set(prior.map(({ id }) => id === legacy ? canonical : id));
const currentIds = new Set(current.map(({ id }) => id));
const additions = current.filter(({ id }) => !priorIds.has(id));
assert.equal(priorIds.size, 922);
assert.equal(current.length, 946);
assert.equal(currentIds.size, current.length);
assert.equal(additions.length, 24);
assert([...priorIds].every((id) => currentIds.has(id)));
assert(!currentIds.has(legacy));
assert(!currentIds.has(deferred));

const owners = new Map();
for (const server of current) {
  const alternatives = (server.alternativeEndpoints ?? []).map(({ url }) => url);
  for (const endpoint of [server.url, server.browserUrl, ...alternatives].filter(Boolean)) {
    const key = normalizeCatalogEndpoint(endpoint);
    assert(key, endpoint);
    assert(!owners.has(key) || owners.get(key) === server.id, `Duplicate endpoint ${key}`);
    owners.set(key, server.id);
  }
}
const validation = new Map(read('catalogValidation').map((row) => [row.serverId, row]));
assert(!validation.has(deferred));
assert.equal(validation.get(canonical)?.status, 'online');
assert(!existsSync(`public/server-logos/${deferred}.svg`));
for (const { id, listingSource } of additions) {
  assert.equal(validation.get(id)?.status, 'online', id);
  assert.equal(listingSource?.kind, 'publisher', id);
}
console.table(additions.map(({ id, url }) => ({ id, url })));

const oldSnapshots = read('catalogCapabilities', base);
const snapshots = read('catalogCapabilities');
assert.equal(Object.keys(oldSnapshots).length, 441);
for (const [id, snapshot] of Object.entries(oldSnapshots)) {
  assert.deepEqual(snapshots[id], snapshot, id);
}
assert.deepEqual(Object.keys(snapshots).filter((id) => !Object.hasOwn(oldSnapshots, id)).sort(),
  ['char-gen', 'hoplix', 'mapbox-docs', 'pyai', canonical, 'signal8', 'tenderlead', 'vokolla']);
assert.equal(snapshots[canonical].tools.observedCount, 27);

const page = (id) => readFileSync(`dist/servers/${id}/index.html`, 'utf8');
const canonicalUrl = `https://mcptest.io/servers/${canonical}/`;
const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
assert.equal(page(legacy), page(canonical));
assert(page(canonical).includes(`<link rel="canonical" href="${canonicalUrl}"`));
assert.equal(sitemap.split(`<loc>${canonicalUrl}</loc>`).length - 1, 1);
assert(!sitemap.includes(`/servers/${legacy}/`));
assert(!sitemap.includes(`/servers/${deferred}/`));
assert(!existsSync(`dist/servers/${deferred}/index.html`));
```

## Batch 22 import

GitHub issue [#761](https://github.com/integry/mcptest/issues/761) tracks this import under queue reference `ff14e799-4a20-42ec-9345-51b2c726d117`. It builds on batch 21 (`699058e59a5707c624b5e9adbbbef4c76c01b1f5`). The catalog grew from 946 to 976 entries. The 30 candidates were matched first on directory and listing ID, then on the normalized primary and alternative URLs. Neither pass found an existing match. Each new record is internal, with a `publisher` listing source, a Streamable HTTP OAuth primary, and every identified Claude and ChatGPT listing.

### Relevance snapshot

The [Claude connector index](https://claude.com/marketplace/connectors-plugins) was retrieved at 23:15 UTC on November 25, 2026. It returned 1,224 records, of which 1,221 had numeric popularity scores. The [ranking snapshot](catalog-batch-22-claude-ranking.tsv) lists those 1,221 connector IDs and scores in rank order: scores descending, ties in source order, one `id<TAB>score` line each, with no header. Its SHA-256 is `c4a84ba4ba1e2e1e82f47d4e7c2801dfa2b2fb6f2c9b1ef96b8448f7b27c4ca4`, which matches the hash supplied in the issue.

For an entry with exactly one ranked Claude listing, the score is `Math.round(100 * (1221 - rank) / 1221)`, where `rank` is the one-based line number. The snapshot reproduces all 29 supplied scores for new records and the five supplied scores for existing records with Claude listings. No other catalog entry's score differs from the snapshot. ThoughtSpot SpotterCode has only an unranked Claude plugin and stays unscored. HYPD AI has no Claude listing and gets its first score of 50.

```sh
sha256sum docs/catalog-batch-22-claude-ranking.tsv
awk -F'\t' '$1 == "connector.d4b6d94e-8fd7-4936-a525-a1852acd3bb4" { print NR, int(100 * (1221 - NR) / 1221 + 0.5) }' \
  docs/catalog-batch-22-claude-ranking.tsv   # Send: 381 69
```

### Existing records

- `nooks`, `highspot`, `midpage` and `hypd-ai` each gained their ChatGPT listing. Their earlier listings and publisher sources are unchanged.
- `aws` gained ChatGPT `plugin_asdk_app_6a0b1644959c8191a6ecd016190651cd`. The AWS Core release configures the existing primary. The publisher source, regional alternatives and relevance 88 are unchanged.
- `datadog` gained ChatGPT `plugin_asdk_app_69e8c7f174a08191a28b6da96c8062c4` (Datadog Legacy, US1) and the `?toolsets=core,visualizations` US1 alternative. The primary, publisher source and relevance 97 are unchanged. The primary and the new alternative both returned HTTP 401 without credentials. [Datadog Legacy release](https://chatgpt.com/backend-anon/ps/plugins/plugin_asdk_app_69e8c7f174a08191a28b6da96c8062c4)

### Validation and endpoint provenance

- All 30 primaries are `online` in `src/data/catalogValidation.json` with OAuth authentication challenges. Authenticated tool inventories are unverified, and `src/data/catalogCapabilities.json` gained no snapshots. Revalidating AWS refreshed only the timestamp of its existing anonymous snapshot.
- **ThoughtSpot SpotterCode.** The primary `https://spottercode.thoughtspot.app/mcp` returned an OAuth challenge. The read-only alternative `https://spottercode.thoughtspot.app/mcp/docs` negotiated Streamable HTTP MCP `2025-03-26` without credentials as "Thoughtspot Embed SDK Docs Helper" 1.0.0. It listed `get-rest-api-reference` and `get-developer-docs-reference`. That tool list is recorded only on the alternative. The Claude plugin and ChatGPT listing are attributed to the primary.
- Alternatives are recorded as separate endpoints with their own evidence: Harmonic legacy SSE, Local Falcon `/mcp`, Conductor `/mcp/v3` (indexed by Claude and serving a different tool set), the PocketSmith read-only server, and the Brightflag EU and AU regions. All returned HTTP 401 without credentials.
- MyChatBot and Eraser also accept publisher-issued bearer tokens, so `alternativeAuthTypes` lists `bearer-token` for both. MyChatBot's listings are attributed only to the sales endpoint.
- BILL's ChatGPT listing points to [OpenAI's BILL plugin page](https://openai.com/business/plugins/bill/). The public ChatGPT release lookup returned "Plugin not found." The ChatGPT LP and GP releases for Chronograph omit endpoint URLs. Both are attributed to the shared Chronograph endpoint, together with its two Claude plugins.
- Cortellis CMC Intelligence is separate from the existing Cortellis Regulatory Intelligence entry. S&P Global Adaptive Retrieval is separate from `sp-global-kensho`.
- Every new record uses a generated monogram logo.

No candidates were deferred.

## Batch 23 import

GitHub issue [#763](https://github.com/integry/mcptest/issues/763) tracks this import under queue reference `ff14e799-4a20-42ec-9345-51b2c726d117`. It builds on batch 22 (`ae8fc5ae8008dfc47d56ed3f86242e113bb41bf5`). The catalog grew from 976 to 1,005 entries. The 30 candidates were matched first on directory and listing ID, then on the normalized primary and alternative URLs. GLG matched the existing `glg` record on its Claude connector, its ChatGPT listing and its URL. Batch 22 had already imported it with the same publisher source and relevance 65, so it was left unchanged. The other 29 candidates had no match. Each one is internal, with a `publisher` listing source, a Streamable HTTP OAuth primary, every identified Claude and ChatGPT listing, and a generated monogram logo.

### Relevance snapshot

The [Claude connector index](https://claude.com/marketplace/connectors-plugins) was retrieved at 04:12 UTC on November 26, 2026. It returned 1,226 records, of which 1,222 had numeric popularity scores. The source HTML SHA-256 was `fcd058a595d7e21b1d82234721de37eb97d10d51ed41a14a93afe91f3a930753`. The [ranking snapshot](catalog-batch-23-claude-ranking.tsv) uses the batch 22 format: scores descending, ties in source order, one `id<TAB>score` line each, with no header. Its SHA-256 is `3896b54f35188dcd1cbe8ac306c356bb56ebd1e6d5fda9dedd344466c8b93802`.

For an entry with exactly one ranked Claude listing, the score is `Math.round(100 * (1222 - rank) / 1222)`, where `rank` is the one-based line number. Every rank supplied in the issue matches the snapshot line. The nine existing corrections in the issue are exactly the catalog entries whose stored score differed from the snapshot: `tripadvisor`, `brighthire`, `activecampaign`, `airops`, `circleci`, `courtroom5`, `all-accor`, `military-veteran-family-assistant` and `community-funding-nz`. After the import, no catalog entry's score differs from the snapshot.

The formula gives two values that differ from the issue's figures. Attention ranks 446, so `100 * 776 / 1222 = 63.50` rounds to 64, not 63. Sent ranks 458, so `100 * 764 / 1222 = 62.52` rounds to 63, not the 62 given for rows #458–466. Both issue values match the batch 22 denominator of 1,221. The catalog records the 1,222-denominator values, so a later reconciliation against this snapshot does not change them again. Stack Overflow for Agents has only a ChatGPT listing and takes the supplied score of 65. The publisher's dashboard reported 11,543 registered agents, 23,019 posts and replies, and 16,888 verifications.

```sh
sha256sum docs/catalog-batch-23-claude-ranking.tsv
awk -F'\t' '$1 == "connector.352baac0-d2ab-4458-ba9a-85bf162f0980" { print NR, int(100 * (1222 - NR) / 1222 + 0.5) }' \
  docs/catalog-batch-23-claude-ranking.tsv   # Attention: 446 64
```

### Existing records

- `graphify`, `b12`, `rootly` and `thunderphone` each gained their ChatGPT listing. Each public release names the catalog primary. Their relevance (77, 70, 62 and 47) is unchanged.
- `b12` now uses a `publisher` listing source, B12's [guide to connecting an AI agent](https://support.b12.io/en/v3/connecting-an-ai-agent-to-b12s-mcp-server). The caveat saying the publisher did not document the endpoint was removed. B12 still completes an anonymous handshake. Revalidation refreshed its tool snapshot because the `generate_website` description changed upstream.

### Validation and endpoint provenance

- All 29 new primaries are `online` in `src/data/catalogValidation.json` with OAuth challenges. Authenticated tool inventories are unverified, and `src/data/catalogCapabilities.json` gained no snapshots. DevRev, Rillet and Reclaim.ai answered HTTP 401 without a `WWW-Authenticate` header. Jasper, ThoughtSpot Spotter and Stack Overflow sent a Bearer challenge without a `resource_metadata` pointer. The validator keeps the declared OAuth type for all six. Rillet, Reclaim.ai and Jasper publish protected-resource metadata at the origin.
- Each ChatGPT listing resolves to a public release from the expected developer. The Enterpret, Stack Overflow for Agents, Rippit, Rillet, DataHub and Payhawk releases name the catalog primary. The other releases omit endpoint URLs.
- **RingCentral Chat.** The versioned primary and the unversioned `/ringex/team-chat` alternative both returned HTTP 401. Each has its own protected-resource metadata and requests the same `ReadAccounts TeamMessaging` scopes. The publisher labels the service beta.
- **Chargebee.** The US primary and the EU and AU alternatives each returned HTTP 401. Their protected-resource metadata names the matching regional authorization server (`app.chargebee.com`, `app.eu.chargebee.com`, `app.au.chargebee.com`). The US, EU and AU ChatGPT listings are recorded on the one record.
- **ThoughtSpot Spotter.** Claude's connector configures `https://agent.thoughtspot.app/mcp?api-version=latest`, and ThoughtSpot documents the bare URL as the latest version. The bearer-token alternative `https://agent.thoughtspot.app/token/mcp` answered HTTP 400 "Bearer token is required" without credentials. With a placeholder token, it asked for the ThoughtSpot host as `token@ts-host` or in an `x-ts-host` header.
- DevRev accepts a personal access token as `Authorization: Bearer <token>`, [Rillet](https://docs.api.rillet.com/docs/mcp) accepts an API key as `Authorization: Bearer <API_KEY>` on the same endpoint, and Hive accepts an `api-key` request header. All three are recorded as optional `requiredHeaders` with the matching `alternativeAuthTypes`; OAuth stays the primary `authType`.
- Webex Suite (`/mcp/webex-suite`) is separate from the existing `webex-meetings` record. Stack Overflow (`mcp.stackoverflow.com`) is separate from Stack Overflow for Agents (`agents.stackoverflow.com/mcp`).
- The Candid, Brisk and Flourish help centers returned HTTP 403 to the container. Flourish's Zendesk article API confirms its endpoint. Candid's and Brisk's protected-resource metadata name the exact catalog primaries. The Mentimeter, Chargebee and MT Newswires pages did not include the endpoint in their server-rendered HTML. Their protected-resource metadata names the catalog primary as its resource.
