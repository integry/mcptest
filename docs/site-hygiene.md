# Site hygiene for search: 404s, links, sitemap and canonical URLs

The build (`npm run build`, which ends with `npm run generate-seo`) writes everything a crawler sees: a prerendered HTML page for the home page, the catalog, the guides index, every guide and documentation page and every catalog server, plus `sitemap.xml`, `robots.txt`, `404.html` and `routes.txt`. CI checks the result after every build. This page describes those checks and the one piece of configuration that lives on the origin, outside this repository.

## Real 404s

A single-page app answers every path with its shell and a `200`. Search engines treat those answers as soft 404s. The site now gives unknown paths a real 404 in two places:

- **In the app.** `src/utils/appRoutes.ts` lists the paths the app has a view for. Any other path renders the `NotFound` view (`src/components/NotFound.tsx`) in the reading shell. It links to the playground, the catalog and the guides, includes the guide search box, and sets `<meta name="robots" content="noindex, follow">`. Unknown slugs under `/learn/`, `/docs/` and `/servers/` keep their existing "guide not found" and "server not found" views, which are also noindex.
- **At the origin.** `dist/404.html` is the same page prerendered. It has `<meta name="robots" content="noindex">` and no canonical link or `og:url`. When the origin serves it with a `404` status, the app mounts over it and shows `NotFound`.

`dist/routes.txt` lists every path the app answers:

```text
/                         exact paths: the prerendered pages and the app-only routes
/catalog
/learn/what-is-mcp
/report
/servers/github/
...
/server/*                 every path below a prefix
/call/*
/space/*
/report/*
```

Prerendered pages are files in `dist/`. The app-only routes (`/report`, `/submit`, `/oauth/callback`, `/install-integration` and the four prefixes) have no file and must get the SPA shell, `index.html`, with a `200`. Everything else should get `404.html` with a `404`. The worker routes in `wrangler.toml` (`/badge/server/*`, `/badge/report/*`, `/r`, `/r/*`, `/api/catalog/submissions`) are answered by the Cloudflare worker before the request reaches the origin.

### Origin configuration (maintainer)

This repository does not change the origin. The common single-page-app setting `try_files $uri $uri/ /index.html;` in `location /` is what turns every unknown path into a `200`. Keep that fallback for the app routes only, and let everything else fall through to `error_page 404 /404.html;`:

```nginx
root /path/to/dist;
error_page 404 /404.html;

# Files, directory indexes (/learn/<slug>/index.html) and .html siblings
# (/catalog -> catalog.html). Nothing else: an unknown path is a 404.
location / {
    try_files $uri $uri/index.html $uri.html =404;
}

# App routes with no prerendered file (dist/routes.txt): the SPA shell.
location = /report              { try_files $uri $uri/ /index.html; }
location = /submit              { try_files $uri $uri/ /index.html; }
location = /oauth/callback      { try_files $uri $uri/ /index.html; }
location = /install-integration { try_files $uri $uri/ /index.html; }
location ^~ /server/            { try_files $uri $uri/ /index.html; }
location ^~ /call/              { try_files $uri $uri/ /index.html; }
location ^~ /space/             { try_files $uri $uri/ /index.html; }
location ^~ /report/            { try_files $uri $uri/ /index.html; }
```

The app-only routes change rarely: only when `EXACT_APP_ROUTES` or `APP_ROUTE_PREFIXES` in `src/utils/appRoutes.ts` changes. Compare `dist/routes.txt` with the `location` blocks after such a change. New guides and catalog servers need no origin change, because they are files.

Check the result with `curl -sI https://mcptest.io/no-such-page` (expect `404`) and `curl -sI https://mcptest.io/report` (expect `200`).

If the site is ever served by Cloudflare Pages instead, note that Pages serves a top-level `404.html` with a `404` status for every path without a file, app routes included. Add a `_redirects` file that rewrites the app-only routes to the shell (`/report /index.html 200`, `/server/* /index.html 200`, and so on for each line of `routes.txt` that has no file).

`npm run test:e2e` serves `dist/` with `tests/e2e/static-server.mjs`, which follows the same rules: files first, the shell for `routes.txt`, `404.html` with a `404` for the rest.

## Internal link checker

`npm run check-links` (`scripts/check-links.mjs`) runs in the CI verify job after the build. It reads every HTML page, every raw Markdown export (`/learn/<slug>.md`, `/docs/<slug>.md`) and `llms.txt` in `dist/`, and resolves every internal `href`, `src` and `og:image`/`twitter:image` URL against the generated files, `routes.txt` and the worker routes in `wrangler.toml`. It fails on:

- **Broken links**: no file, app route or worker route answers the path.
- **Missing anchors**: `#id` that the target page does not contain. An anchor on an app-only route cannot be checked and is reported too.
- **Non-canonical variants**: a link that reaches a page by a URL other than its canonical one. That covers a trailing-slash mismatch (`/learn/<slug>/`, `/servers/<id>`), `.html` and `index.html` spellings, `http://mcptest.io` and `www.mcptest.io`.

Code blocks, comments, scripts and JSON-LD are not read as links.

External links are counted but not fetched in CI. Run `npm run check-links -- --list-external` to see them, and `npm run check-links:external` to fetch them (HEAD, falling back to GET, 8 at a time, 10-second timeout). Override the limits with `-- --concurrency 4 --timeout 20000`. `401`, `403` and `429` count as "unverified" rather than broken, because many sites refuse automated requests.

## Sitemap, robots and canonical audit

`npm run test:site-audit` (`scripts/audit-site.test.mjs`, also run in CI after the build) checks `dist/`:

- Every prerendered page except `404.html` has exactly one `<link rel="canonical">` and one `og:url`, and they agree.
- The canonical URL is a bare `https://mcptest.io` URL, and the host serves that same file at it.
- Every indexable page is in `sitemap.xml` exactly once, under its canonical URL. No `noindex` page is listed, and every listed URL is a prerendered page.
- `lastmod` is a guide's `lastReviewed` date, or a server page's latest catalog validation (`checkedAt` in `src/data/catalogValidation.json`). The catalog and home pages use the newest of those dates. Pages with no content date (privacy, terms, contact) have no `lastmod`, rather than the build date.
- `robots.txt` references `https://mcptest.io/sitemap.xml` and blocks no sitemap URL.

All of these URLs come from one helper in the generator, `canonicalUrlFor`: the canonical link, `og:url`, structured data and the sitemap `<loc>`. The home page is `https://mcptest.io`, without a trailing slash. Server pages end in a slash (`/servers/<id>/`), and every other page does not.
