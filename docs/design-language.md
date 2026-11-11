# mcptest.io design language

mcptest.io is an instrument for inspecting protocol traffic. The UI should read
like one: calm graphite surfaces, one strong accent, protocol facts set in
mono, and a few signature elements reused everywhere. This note lists the
tokens in `src/styles/tokens.css` and the rules for using them, so later
changes stay consistent. `src/styles/tokens.test.ts` and
`src/components/designSystem.test.tsx` enforce most of it.

No new UI or CSS dependencies: Bootstrap 5 stays underneath, the token layer
restyles it. Components consume tokens; they never hard-code a hex value.

## Direction

- **One accent.** The green of the logo (`#2bcb3a`) is the only brand colour.
  In the light theme it is darkened to `#167a2c` so white text passes AA on
  it; in the dark theme it is used near full strength (`#46d35a`) with a deep
  green ink (`#04140a`) for text on it.
- **Graphite neutrals.** Grey with a faint green cast, never the blue-slate
  of a stock admin template.
- **Mono for protocol facts.** JetBrains Mono (bundled) sets URLs, method and
  tool names, protocol versions, status codes, counts, the wordmark and
  section labels. Body copy and buttons stay in Inter.
- **Depth from surface steps, not shadows.** Page, raised and surface are
  three distinct steps; the only shadow is for floating surfaces.

## Tokens

### Scale (theme-independent)

| Token | Value | Use |
| --- | --- | --- |
| `--font-family-sans-serif` | Inter Variable | Everything that is not a protocol fact |
| `--font-family-mono` | JetBrains Mono Variable | URLs, methods, tool names, versions, counts, wordmark, section labels |
| `--text-2xs` … `--text-2xl` | 11, 12, 13, 14, 16, 18, 22, 28px | Type scale. Body is `--text-base` (14px); nothing is smaller than `--text-2xs` |
| `--weight-regular/medium/semibold/bold` | 400 / 500 / 600 / 650 | Headings 650, labels and buttons 600, body 400 |
| `--border-radius`, `--button-radius` | 0.5rem | Cards, panels, inputs, menus, buttons |
| `--border-radius-sm`, `--button-radius-sm` | 0.375rem | Small controls, segmented items, inline code |
| `--radius-pill` | 999px | Status pills only. Buttons are never pills |
| `--space-1` … `--space-8` | 4px steps | All padding, margins and gaps |
| `--rail-width` | 3px | The signal rail (see below) |
| `--motion-fast`, `--motion-base` | 120ms, 200ms | Hover/press and theme transitions. `0ms` under `prefers-reduced-motion` |
| `--code-font-size`, `--code-line-height`, `--code-radius` | 0.8rem, 1.55, 0.5rem | Every code block (inspector, report, reading layout) |

### Palette (defined in both themes; the dark theme is designed, not inverted)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--body-bg` | `#eef0ee` | `#0b0d0c` | Page. Sidebar background |
| `--card-bg-secondary` | `#f5f7f5` | `#1c211e` | Raised wells: code blocks, tab tracks, table heads, neutral pills |
| `--card-bg` | `#ffffff` | `#141816` | Surface: cards, panels, header, inputs' surroundings |
| `--card-header-bg` | `#f9faf9` | `#171b19` | Card header band, so a panel's title row reads as structure |
| `--text-color` | `#121513` | `#e9ece9` | Primary text |
| `--text-accent` | `#343b37` | `#c6cdc8` | Secondary emphasis, neutral outline buttons |
| `--text-muted` | `#5a625d` | `#9aa49e` | Supporting text, labels, timestamps |
| `--primary-color` | `#167a2c` | `#46d35a` | The accent: primary buttons, focus, active rails, links on hover |
| `--primary-hover` | `#106323` | `#74e383` | Hover/pressed primary |
| `--primary-ink` | `#ffffff` | `#04140a` | Text and spinners on the accent |
| `--accent-text` | `#106323` | `#74e383` | Accent-coloured text on washes (active nav icon, selected chip) |
| `--accent-wash` | `#e6f1e8` | `#15291a` | Background of the active nav item, selected list item, selected chip |
| `--success-color` / `--warning-color` / `--danger-color` / `--info-color` | `#167a2c` / `#975300` / `#c42b2b` / `#0b6f8a` | `#46d35a` / `#f2b33d` / `#ff7a72` / `#5ccfe8` | Status only: pills, rails, verdict icons |
| `--border-color` | `#dce1dd` | `#2a312d` | Hairlines between and around surfaces (decorative) |
| `--border-strong` | `#c3cac5` | `#3a423d` | Dividers that must be seen: header lockup rule, neutral pill outlines, dashed empty states |
| `--input-border` | `#7d8781` | `#66716a` | Field and neutral outline-button borders. Holds 3:1 against the surface (WCAG 1.4.11) |
| `--disabled-bg` / `--disabled-text` / `--disabled-border` | `#e4e8e5` / `#6b736e` / `#d3d9d5` | `#232925` / `#8a938d` / `#2f3632` | Every disabled control, whatever its variant |
| `--wire-request` / `--wire-response` | `#5a625d` / `#167a2c` | `#9aa49e` / `#46d35a` | Rails on outbound and inbound JSON-RPC messages |
| `--link-color` / `--link-hover` | `#106323` / `#0a3f16` | `#74e383` / `#ffffff` | Inline links |
| `--focus-ring` | 3px accent at 28% | 3px accent at 35% | Focus on buttons, inputs and nav items |
| `--hover-wash` / `--active-wash` | 5% / 8.5% ink | 6% / 10% white | Hover and pressed backgrounds of ghost controls and nav items |
| `--shadow-float` | soft | deep | The only shadow: menus, popovers, dialogs, the mobile drawer |

`--secondary-*`, `--catalog-secondary-text`, `--accent-violet` and
`--primary-light` remain for the existing components that use them.

## Rules

1. **Accent budget.** One solid primary button per view, for the action the
   view exists for (Connect, Run tool, Run Report, Test it live). Everything
   else is an outline, ghost or link. Never use the accent for decoration.
2. **Disabled is neutral.** A disabled button of any variant is
   `--disabled-bg` with `--disabled-text`, at full opacity. Never fade the
   accent: a pale green reads as "almost enabled".
3. **Pressed and hover.** Hover darkens (solid) or washes (outline, ghost);
   pressed adds a one-pixel settle. No lifts, no scale, no glow.
4. **Surfaces.** Cards and panels: `--card-bg`, one `1px solid
   var(--border-color)` hairline, `--border-radius`, no shadow, no hover lift.
   Only floating surfaces use `--shadow-float`.
5. **The signal rail.** A `--rail-width` left edge marks state, and only
   state: the active sidebar item (accent), verdicts and callouts (status
   colour), alerts (status colour), the result payload and every JSON-RPC log
   entry (wire colours). If something has a rail, its colour means something.
6. **Status pills.** `.badge` is a fully round, soft-tinted pill with a
   same-hue hairline. Pass, warn and fail pills (`bg-success`, `bg-warning`,
   `bg-danger`) lead with a status dot; neutral tags (`bg-secondary`,
   `bg-light`) do not. Pills are read-only; nothing clickable is round.
7. **The wire.** JSON-RPC traffic reads the same everywhere: requests carry
   the `--wire-request` rail and a `→` marker, responses the
   `--wire-response` rail and a `←` marker, errors the danger rail. Payloads
   are mono in a `--card-bg-secondary` well.
8. **Section headers.** Page titles are `h1` at `--text-2xl`, tight tracking.
   Sections inside a page are a heading over a hairline. Small structural
   labels (sidebar groups, catalog "Categories", "On this page", report
   kickers) are mono, `--text-muted`, 13px, natural case, no tracking.
9. **Tabs.** Tabs sit in a raised track; the active tab is a surface with a
   2px accent underline, so selection never relies on a surface step alone.
10. **Focus.** Every interactive element shows `--focus-ring` (or a 2px
    accent outline for native controls) on `:focus-visible`.
11. **Brand lockup.** The header carries a 2px accent signal line on its top
    edge, the logo, the wordmark in mono, a `--border-strong` rule and the
    product name in muted sans.
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
