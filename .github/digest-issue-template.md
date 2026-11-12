Write the monthly digest article "{{article_title}}" and open a pull request with it. This issue was opened by the scheduled `.github/workflows/monthly-digest.yml` workflow; the full writing brief from `docs/monthly-digest.md` is copied below, so no other context is needed.

## {{month_name}} at a glance

| Field | Value |
| --- | --- |
| Article | `src/content/articles/{{slug}}.md` |
| Page | `/learn/{{slug}}` |
| Window | {{window_start}} to {{window_end}}, inclusive |
| `title` | `"{{article_title}}"` |
| `navTitle` | `"MCP changes, {{month_short}}"` |
| `metaTitle` | `"{{article_title}} \| mcptest.io"` |
| `order` | `{{order}}` (reference track, computed from the existing digests) |
| `lastReviewed` | The date you open the pull request, `YYYY-MM-DD`, on or after {{window_end}} |
| `relatedSlugs` | Start with `{{previous_slug}}`, the previous digest |

## Checklist

- [ ] Only `src/content/articles/{{slug}}.md` is added. No other article, component, style, script or data file changes.
- [ ] Every item is dated inside {{window_start}} to {{window_end}} and has an inline link that is also in `sourceLinks`.
- [ ] All six `##` sections are present, in order; empty ones say "No documented changes in this window."
- [ ] `npm test`, `npm run typecheck` and `npm run build` pass.
- [ ] `dist/learn/{{slug}}/index.html` exists and the page is listed in `dist/llms.txt` and `dist/learn/feed.xml`.

---

{{brief}}
