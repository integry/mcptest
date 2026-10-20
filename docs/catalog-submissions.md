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
   - more than 10 submissions per client address, or more than 5 per endpoint host, in 24 hours.
2. The Worker triggers the `catalog-submission` [`repository_dispatch`](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event) event with the submission as the payload.
3. The [`Catalog submission`](../.github/workflows/catalog-submission.yml) workflow runs `npm ci` on Node 22, then:
   1. `scripts/apply-catalog-submission.ts` (through `npm run apply-catalog-submission -- apply`) re-validates the payload with the same schema and appends the entry to `serverCatalog.json`. The id is derived from the endpoint host (`https://mcp.acme.dev/mcp` becomes `acme`, with `-2` appended if `acme` is taken). The entry gets `listingSource: { "kind": "community-submission" }` and transport and auth taken from the browser evidence. A licensed logo is downloaded to `public/server-logos/<id>.svg` or `.png` with its license note. A logo that cannot be downloaded or fails the asset rules, or a submission without one, gets a generated monogram (`generated-fallback`). The script also updates the catalog size in `src/utils/catalogUtils.test.ts`.
   2. `npm run validate-catalog -- --only <id>` probes the new server from the runner and merges its result into `catalogValidation.json` and `catalogCapabilities.json`. The command fails unless the server is `online`.
   3. `npm run validate-catalog-assets` checks the logo and provenance fields.
   4. The `report` step aligns the entry's transport and auth type with what the runner observed and writes the pull request body. The body contains the submitter's description, the browser-side evidence, the runner-side validation result with its log, the contact email, and a checklist for the maintainer.
   5. A pull request is opened from the branch `submissions/<id>` with the label `catalog-submission`. If either runner check failed, the pull request is opened as a **draft** that shows the failure.

Usually the pull request appears a few minutes after you submit. A second submission for the same id updates the same branch and pull request.

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
   - `requiresOAuth` and `authType` (`none`, `oauth`, `bearer-token`, `api-token`, `api-key`). Record what validation observes, not only what the docs say.
   - For OAuth servers, an `oauthRegistration` block. Use `"mode": "unknown"` with `evidenceUrl` and `reviewedAt` unless you have tested the registration flow against hosted mcptest.
   - Optional fields: `requiredHeaders` (header templates with exactly one `<PLACEHOLDER>` and never a real credential), `alternativeAuthTypes`, `alternativeEndpoints`, `exactEndpointOnly` (set this when the documented URL is an origin root or a non-standard path that must not be rewritten to `/mcp` or `/sse`), `caveats`, `homepageUrl`, and `sourceUrl`.
   - Use an existing category where one fits. Propose a new category only when several servers need it.
2. **`public/server-logos/<id>.svg` or `.png`**: the logo file. See the logo rules below.
3. **`src/data/catalogValidation.json`** and **`src/data/catalogCapabilities.json`**: regenerate these with `npm run validate-catalog`. Do not edit them by hand.
4. **`src/utils/catalogUtils.test.ts`**: update the expected catalog size.

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

1. `npm run validate-catalog` probes every live endpoint. Each request times out after 12 seconds, and each server gets at most 120 seconds for all its probes. A server that runs out of time is recorded as `offline` with `errorCode: "timeout"`.
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
