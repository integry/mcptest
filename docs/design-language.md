# mcptest.io design language

mcptest.io is an instrument for inspecting protocol traffic. The UI reads like
one: a bright, airy inspector on a cool lavender wash, white surfaces drawn
with hairlines, protocol facts set in mono, tight corners and one deep green
accent. This note lists the tokens in `src/styles/tokens.css` and the rules
for using them, so later changes stay consistent. `src/styles/tokens.test.ts`
and `src/components/designSystem.test.tsx` enforce most of it.

No new UI or CSS dependencies: Bootstrap 5 stays underneath, the token layer
restyles it. Components consume tokens; they never hard-code a hex value.

## Direction

- **One accent.** A deep instrument green (`#1d6b53`) is the only brand
  colour, used for the action a view exists for (Connect, Run tool). In the
  dark theme it brightens to `#3fc794` with a deep green ink (`#04140e`).
- **Cool neutrals on a wash.** Ink-navy text, white surfaces and hairline
  borders on a page that fades from a cool blue corner to lavender
  (`--page-wash`). The header, sidebar and session strip are translucent over
  the wash; every panel is an opaque surface.
- **Mono for protocol facts and structure.** JetBrains Mono (bundled) sets
  URLs, method and tool names, protocol versions, status chips, counts, the
  session tabs and the small capital section labels. Body copy, headings
  and buttons stay in Inter.
- **Tight corners, no elevation.** Cards, panels and buttons share a 4px
  radius; the only shadow is for floating surfaces.

## Tokens

### Scale (theme-independent)

| Token | Value | Use |
| --- | --- | --- |
| `--font-family-sans-serif` | Inter Variable | Everything that is not a protocol fact or a structural label |
| `--font-family-mono` | JetBrains Mono Variable | URLs, methods, tool names, versions, counts, status chips, session tabs, section labels |
| `--text-2xs` … `--text-2xl` | 11, 12, 13, 14, 16, 18, 22, 28px | Type scale. Body is `--text-base` (14px); nothing is smaller than `--text-2xs` |
| `--weight-regular/medium/semibold/bold` | 400 / 500 / 600 / 650 | Headings 650, labels and buttons 600, body 400 |
| `--border-radius`, `--button-radius` | 0.25rem | Cards, panels, inputs, menus, buttons, status chips' containers |
| `--border-radius-sm`, `--button-radius-sm` | 0.1875rem | Small controls, status chips, inline code |
| `--radius-pill` | 999px | Status dots and progress tracks only |
| `--space-1` … `--space-8` | 4px steps | All padding, margins and gaps |
| `--main-pad` | clamp(1rem, 2vw, 1.5rem) | Workspace padding; the session strip bleeds back across it |
| `--rail-width` | 3px | The signal rail (see below) |
| `--motion-fast`, `--motion-base` | 120ms, 200ms | Hover/press and theme transitions. `0ms` under `prefers-reduced-motion` |
| `--code-font-size`, `--code-line-height`, `--code-radius` | 0.8rem, 1.55, 0.25rem | Every code block (inspector, report, reading layout) |

### Palette (defined in both themes; the dark theme is designed, not inverted)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--body-bg` | `#f3f4f9` | `#0c0f16` | Page colour under the wash |
| `--page-wash` | blue-to-lavender radial wash | navy-to-violet radial wash | `background-image` of the page. The only gradient in the system |
| `--sidebar-bg` / `--strip-bg` | white at 42% / 55% | white at 2% / 2.5% | Translucent sidebar and session strip over the wash |
| `--card-bg-secondary` | `#f1f2f6` | `#1c212d` | Raised wells: code blocks, neutral chips, protocol chip in the command bar |
| `--card-bg` | `#ffffff` | `#151923` | Surface: cards, panels, the active sidebar item and session tab |
| `--card-header-bg` | `#f8f9fb` | `#181c27` | Card header band and table heads |
| `--text-color` | `#12151c` | `#e8ebf2` | Primary text; also the active tab underline |
| `--text-accent` | `#2e3340` | `#c5cad6` | Secondary emphasis, sidebar links |
| `--text-muted` | `#5a6070` | `#9aa1b2` | Supporting text, section labels, timestamps |
| `--primary-color` | `#1d6b53` | `#3fc794` | The accent: primary buttons, focus, active rails |
| `--primary-hover` | `#155440` | `#6fd9b0` | Hover/pressed primary |
| `--primary-ink` | `#ffffff` | `#04140e` | Text and spinners on the accent |
| `--accent-text` | `#155440` | `#6fd9b0` | Accent-coloured text on washes |
| `--accent-wash` | `#e4f1ec` | `#13291f` | Selected list item, selected chip |
| `--ink-button-bg` / `-hover` / `-text` | `#141824` / `#2a3040` / `#ffffff` | `#e8ebf2` / `#ffffff` / `#0c0f16` | Account actions (Login with Google) beside the accent, never competing with it |
| `--success-color` / `--warning-color` / `--danger-color` / `--info-color` | `#167a2c` / `#975300` / `#c42b2b` / `#0b6f8a` | `#46d38a` / `#f2b33d` / `#ff7a80` / `#5ccfe8` | Status only: chips, rails, verdict icons, session dots. The light values are shared with the published SVG badges |
| `--border-color` | `#e2e4eb` | `#272c39` | Hairlines between and around surfaces |
| `--border-strong` | `#cdd1db` | `#383e4d` | Dividers that must be seen: table head rule, dashed empty states |
| `--input-border` | `#858b9b` | `#6a7184` | Field and command bar borders. Holds 3:1 against the surface (WCAG 1.4.11) |
| `--disabled-bg` / `--disabled-text` / `--disabled-border` | `#eceef3` / `#626877` / `#d8dbe3` | `#222734` / `#8b92a3` / `#2e3342` | Every disabled control except the primary button |
| `--primary-soft` / `--primary-soft-border` / `--primary-soft-ink` | `#d3e9e0` / `#9ccbb9` / `#1a5e48` | `#183a2e` / `#2c6a53` / `#8fdcbd` | The disabled primary button: the accent at reduced emphasis |
| `--chrome-bg` / `--chrome-raised` | `#ffffff` / `#f6f7fa` | `#0a0d13` / `#151923` | The header (frosted, 78% over the wash) and the command bars |
| `--chrome-text` / `--chrome-muted` | `#12151c` / `#5a6070` | `#e8ebf2` / `#9aa1b2` | Text inside the chrome |
| `--chrome-border` / `--chrome-control-border` | `#e2e4eb` / `#858b9b` | `#222734` / `#6a7184` | Chrome hairlines; field borders inside the chrome (3:1) |
| `--chrome-accent` / `-hover` / `-ink`, `--chrome-accent-soft*` | the theme accent | the theme accent | The accent inside the chrome |
| `--hero-bg` / `--hero-border` | `#ffffff` / `#e2e4eb` | `#121620` / `#272c39` | Page heads of the server profile, tool pages and articles |
| `--wire-request` / `--wire-response` | `#5a6070` / `#1d6b53` | `#9aa1b2` / `#3fc794` | Rails on outbound and inbound JSON-RPC messages |
| `--link-color` / `--link-hover` | `#155440` / `#0b3326` | `#6fd9b0` / `#ffffff` | Inline links |
| `--focus-ring` | 3px accent at 26% | 3px accent at 35% | Focus on buttons, inputs and nav items |
| `--hover-wash` / `--active-wash` | 4.5% / 8% ink | 6% / 10% white | Hover and pressed backgrounds of ghost controls and nav items |
| `--shadow-float` | soft | deep | The only shadow: menus, popovers, dialogs, the mobile drawer |

`--secondary-*`, `--catalog-secondary-text`, `--accent-violet` and
`--primary-light` remain for the existing components that use them.

## Rules

1. **Accent budget.** One solid primary button per view, for the action the
   view exists for (Connect, Run tool, Run Report, Test it live). Everything
   else is an outline, ghost or link. Never use the accent for decoration.
2. **Disabled.** A disabled button of any variant but primary is
   `--disabled-bg` with `--disabled-text`, at full opacity. A disabled
   primary stays the primary action at reduced emphasis: `--primary-soft`
   with a `--primary-soft-ink` label (Connect before a URL is typed), and
   turns solid as soon as it is enabled. Never use opacity to disable.
3. **Pressed and hover.** Hover darkens (solid) or washes (outline, ghost);
   pressed adds a one-pixel settle. No lifts, no scale, no glow. The solid
   primary carries a one-pixel inset lower edge so the fill reads as a key.
4. **Surfaces.** Cards and panels: `--card-bg`, one `1px solid
   var(--border-color)` hairline, `--border-radius`, no shadow, no hover lift.
   Only floating surfaces use `--shadow-float`.
5. **The signal rail.** A `--rail-width` left edge marks state, and only
   state: the active sidebar item and selected category (accent), the list
   row under the pointer (accent), the connected console (pass), verdicts,
   discovery results and callouts (status colour), alerts (status colour),
   endpoints, the result payload and every JSON-RPC log entry (wire
   colours). If something has a rail, its colour means something.
6. **Status chips.** `.badge` is a small mono chip with tight corners, a
   soft tint and a same-hue hairline. Pass, warn and fail chips
   (`bg-success`, `bg-warning`, `bg-danger`) lead with a status dot; neutral
   tags (`bg-secondary`, `bg-light`) do not. Chips are read-only.
7. **The wire.** JSON-RPC traffic reads the same everywhere: requests carry
   the `--wire-request` rail and a `→` marker, responses the
   `--wire-response` rail and a `←` marker, errors the danger rail. Payloads
   are mono in a `--card-bg-secondary` well.
8. **Section headers.** Page titles are `h1` at `--text-2xl`, tight tracking.
   Sections inside a page are a heading over a hairline. Structural labels
   (sidebar groups, the Learn toggle, catalog "Categories", table heads, the
   session count) are small mono capitals: `--text-2xs`, semibold,
   `--text-muted`, `0.08em` tracking, `text-transform: uppercase`. Nothing
   else is uppercase or tracked.
9. **Tabs.** In-panel tabs are plain labels on a hairline; the active tab is
   set in the text colour, semibold, with a 2px text-colour underline. The
   session strip under the header is its own bar: a `Sessions N` count, then
   one mono tab per connection divided by hairlines, the active one a white
   surface.
10. **Focus.** Every interactive element shows `--focus-ring` (or a 2px
    accent outline for native controls) on `:focus-visible`.
11. **Brand lockup and chrome.** The header is frosted `--chrome-bg` over
    the wash with a hairline below: the logo in a hairline tile, the
    wordmark in bold sans, a rule, the product name ("Remote MCP Inspector")
    in muted sans, and on the right the theme switch and the ink "Login with
    Google" button. `layout.css` re-declares the theme tokens inside the
    chrome scope (`.app-header`, `.landing-connect`, `.connection-console
    .input-group`, `.discovery-form-row`), so primitives inside it need no
    special rules. Add a selector to that list rather than hand-colouring a
    control.
12. **Motion.** Use `--motion-fast` / `--motion-base`; both drop to `0ms` and
    transitions are disabled under `prefers-reduced-motion: reduce`.
13. **Contrast.** Text tokens hold 4.5:1 on every surface in both themes;
    input borders and the accent hold 3:1. `tokens.test.ts` computes these
    ratios from the token values, so a new colour that fails AA fails the
    test.
14. **Bootstrap tells.** Bootstrap colour utilities (`text-primary`,
    `border-danger`, `bg-primary`, `btn-warning`, …) are remapped to tokens in
    `base.css`. Do not reach for `--bs-*` variables in app CSS; they ignore
    the theme.
15. **Command bar.** The landing and playground "enter an endpoint and go"
    forms are one white bar with an `--input-border` edge: a mono
    `MCP // HTTPS` chip, the borderless mono field, and the solid Connect key
    at the end. Focus rings the whole bar.
16. **Instrument face.** Page heads that identify a thing (server profile,
    tool pages, Learn and Docs articles) sit on `--hero-bg` with a
    `--hero-border` hairline and the 2px accent signal line on top. The
    landing headline ends in an accent block caret.
17. **Numbered rows.** Lists of next steps (the landing "where to start"
    rows) are one surface with hairline rows, a mono `01`, `02` index, and
    the accent rail plus a wash on the row under the pointer. The catalog
    list uses the same rail and wash, and the selected category reads like
    the active sidebar item.
18. **Tables and inline code.** Table heads are a `--card-bg-secondary` band
    with mono, muted column labels over a `--border-strong` rule. Bare inline
    `<code>` is a small neutral chip (`--card-bg-secondary`, hairline,
    `--text-accent`), never Bootstrap's pink.
