# Article figures

Learn articles can carry diagrams. A figure is a hand-authored SVG file that
is inlined into the page, so it uses the site's tokens and follows the light
and dark themes. This note covers the syntax, the SVG contract, the style and
the backlog of articles that still need a figure. `src/content/figures.ts`
holds the rules and `src/content/figures.test.tsx` and the build enforce them.

## Adding a figure

1. Save the SVG as `src/content/figures/<article-slug>/<name>.svg`. The
   directory is the slug of the one article that uses it; `<name>` is
   lowercase kebab-case.
2. Place it in the article on a line of its own, with a blank line before and
   after:

   ```markdown
   ![Alt text that says what the figure shows](../figures/<article-slug>/<name>.svg "One-sentence caption.")
   ```

   - The alt text is the figure's accessible name and replaces the figure in
     the raw `.md` export, so it must describe the content, not the picture
     type alone.
   - The caption is required and is shown under the figure.
   - Put the figure next to the section it explains. Do not remove the text
     it illustrates.
3. Run `npx vitest run src/content/figures.test.tsx` and look at the article
   in both themes, at desktop and phone width.

Articles take no other images. A figure file that no article places fails the
build, as does a placed figure with no file.

## SVG contract

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320">
  <rect class="fig-box" x="20" y="12" width="100" height="40" rx="2"/>
  <text class="fig-title" x="70" y="36.5" text-anchor="middle">MCP client</text>
  <path class="fig-line" d="M120 32H233"/>
  <path class="fig-head" d="M240 32l-8 -4v8z"/>
</svg>
```

- The root takes only `xmlns` and `viewBox="0 0 <width> <height>"`, in whole
  numbers, at most 720 wide.
- Only static shapes and text: `rect`, `path`, `line`, `circle`, `ellipse`,
  `polygon`, `polyline`, `text`, `tspan`, `g`. No `style`, `script`, `use`,
  `image`, links, ids, markers, gradients, filters or animation.
- Every shape and every `<text>` has a `fig-*` class. Colours, fonts and
  stroke styles come only from those classes: no `style`, `fill`, `stroke`,
  `font-*`, `color` or `opacity` attributes and no colour values. `fill="none"`
  and `stroke="none"` are the one exception.
- Draw arrowheads as small filled paths (`fig-head`), as in the example.

| Class | Use |
|---|---|
| `fig-box` | Neutral box: an actor, a component, a step |
| `fig-box-accent` | The one box the figure is about |
| `fig-line` | Connector or arrow shaft |
| `fig-line-accent` | The path the figure is about |
| `fig-line-danger` | A failure path |
| `fig-dashed` | Added to a line: a response or an optional path |
| `fig-guide` | Lifeline or other faint guide |
| `fig-rule` | Hairline separating rows or groups |
| `fig-head`, `fig-head-accent`, `fig-head-danger` | Arrowhead matching its line |
| `fig-dot`, `fig-dot-accent` | Point marker on a line |
| `fig-label` | Label in Inter, 13px |
| `fig-title` | Label in Inter semibold: actor and box names |
| `fig-mono` | Protocol fact in JetBrains Mono, 11.5px |
| `fig-muted`, `fig-accent-text`, `fig-danger-text` | Added to a text class to change its colour |

The classes are defined in `src/components/learn/ReadingLayout.css`. A new
class needs an entry in `FIGURE_CLASSES` (`src/content/figures.ts`), a rule in
that stylesheet using tokens only, and a row here.

## Style

Figures follow [the design language](design-language.md).

- **One accent.** The teal-green accent marks only the path or element the
  figure is about. Everything else is neutral. Danger colours are for a
  failure path only.
- **Mono for protocol facts.** URLs, methods, headers, field names, status
  codes, tool names and versions use `fig-mono`. Everything else uses
  `fig-label` or `fig-title`.
- **Square and flat.** `rx="2"` on boxes, hairline strokes, no decoration,
  icons or emoji.
- **Text stays out of the drawing.** Put labels beside the shapes or in a
  label column, not across lines. In a sequence diagram, label each step in
  the left column and keep the lifeline area for arrows, as in
  `oauth-for-mcp-explained/authorization-sequence.svg`.
- **Readable on a phone.** Figures are never scaled below two thirds of their
  drawn size; the canvas scrolls sideways instead. Keep to about 8 boxes or
  10 messages. A larger figure is two figures, or too detailed.
- **Only what the article says.** Labels use the article's terms. Do not add
  steps, names or values the article and its `sourceLinks` do not have.

## Backlog

In priority order. Mark an article done when its figure is merged, or
"no figure needed" with a one-line reason.

| Article | Figure | Status |
|---|---|---|
| `oauth-for-mcp-explained` | Sequence: the seven authorization steps | Done |
| `mcp-explained-for-everyone` | Structure: app, client and server | |
| `what-is-mcp` | Structure: host, client, server and what they exchange | |
| `remote-vs-local` | Structure: stdio next to Streamable HTTP | |
| `mcp-vs-api-vs-function-calling` | Structure: where each one sits between model and service | |
| `troubleshooting` | Decision tree: from symptom to the guide that fixes it | |
| `remote-mcp-server-401-unauthorized` | Sequence: challenge, discovery and retry, with the failure points | |
| `mcp-cors-headers-for-browser-clients` | Sequence: preflight and the actual request | |
| `mcp-session-not-found-after-deploy` | Sequence: a session id reaching an instance that does not have it | |
| `mcp-long-running-tools` | Sequence: progress and completion of a long call | |
| `mcp-406-not-acceptable-415-and-405` | Decision tree: which header or method produces each status | |
| `should-you-build-mcp-server` | Decision tree: build, wrap an API, or neither | |
| `mcp-server-authentication-patterns` | Decision tree: choosing an authentication pattern | |
| `mcp-server-connected-but-no-tools` | Decision tree: why a connected server lists no tools | |
| `convert-local-stdio-mcp-server-to-remote` | Structure: before and after the conversion | |
| `mcp-bot-protection-blocking-clients` | Sequence: a client request stopped at the bot-protection layer | |
| `mcp-oauth-2-1-reference` | Structure: the metadata documents and what points to what | |
| `mcp-protocol-timeline` | Timeline: protocol revisions | |
| `mcp-protocol-versions-explained` | Sequence: version negotiation | |

Not planned: the client connection guides (`connect-mcp-server-to-*`,
`add-remote-mcp-server-to-claude`), which need screenshots of signed-in
clients, and the short `mcp-error-*` articles.
