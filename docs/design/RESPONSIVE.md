# Mizzou responsive layouts (docs/design/RESPONSIVE.md)

Mizzou is an agent people use for hours at a desk, and a buddy they check on a phone. So each form factor gets its own layout, built from the same brand tokens. This file overrides every width, "phone frame" and "max width 720px" statement elsewhere. Brand does not change: grayscale Liquid Glass on `#E9E9EB`, black only on the one primary action, Inter, Pinyon Script wordmark, all values from `styles/tokens.css` and `docs/design/html`. The structure below follows the pattern Claude's own interface uses (pinned sidebar, centered chat column, side panel that opens when there is something to show), restyled in Mizzou's glass.

## 1. Breakpoints and what each one is

| Form | Width | Test widths | Navigation | Evidence and plan |
|---|---|---|---|---|
| Mobile | under 768 | 360, 390, 430 | Slide-out drawer from the menu button | Inline expand, bottom sheet for the plan |
| Tablet | 768 to 1099 | 768, 820, 834, 1024 | 72px icon rail; expands to a 304px overlay with scrim | Right slide-over sheet, 380px, with scrim |
| Desktop | 1100 and up | 1280, 1440, 1920 | Pinned 288px sidebar; can collapse to the 72px rail | Right panel, 360px (400px at 1600+), pinned when open |

Tablet means touch: 44px targets, no hover-only controls. Desktop means pointer and keyboard: hover states, visible focus rings, shortcuts.

## 2. Wireframes

```
MOBILE (390)                TABLET (820)                      DESKTOP (1440)
+--------------+            +--+--------------------+        +-------+---------------------+---------+
| =  Mizzou  + |            |= |   Mizzou        +  |        |Mizzou |  chat title     Plan|         |
|              |            |+ |                     |        |  [+]  |                     | Where I |
|  Howdy, John |            |R |    Howdy, John      |        |Remind.|   user bubble       | found   |
|  What ...    |            |C |    What ...         |        | cards |   status lines      | this    |
|              |            |S |                     |        |Chats  |   cards (2-col)     |         |
| Coming up    |            |  |  Coming up (card)   |        |  ...  |                     | "quote" |
| [+][ Msg  ^ ]|            |  |  [+][ Message   ^ ] |        |Settng |  [+][ Message  ^ ]  | source  |
+--------------+            +--+--------------------+        +-------+---------------------+---------+
 drawer on menu              rail -> overlay on tap            sidebar | column 760 | panel on demand
```

## 3. Shell rules (this is where the current build is wrong)

- There is no phone frame at any width. `.mz-shell` is only the full-viewport background layer (page color plus blobs). It must not have a max-width.
- One `AppShell` component with a CSS grid: `grid-template-columns: var(--sidebar) minmax(0, 1fr) var(--panel)`. Only the CSS variables change per breakpoint. Do not render a second hidden copy of any screen with `display: none`.
- Mobile and tablet: sidebar is `position: fixed` overlay with a scrim. Desktop: it is a grid column.
- The right panel is a grid column on desktop and a fixed slide-over on tablet. It is not rendered on mobile.
- Use `100dvh`, safe-area insets, and `min-width: 0` on grid children so nothing overflows. No horizontal scroll from 320 to 1920 or at 200% zoom.
- Backdrop blur only on the sidebar, composer, right panel and modals (3 layers maximum). Cards in the chat use the translucent glass fill, hairline border and shadow without blur on tablet and desktop. Mobile follows the PNGs.

## 4. Home and conversation, per form

Empty state (before the first message)
- Mobile: as the PNGs. Greeting centered, Coming up card above the composer.
- Tablet: same stack in a 680px column, larger greeting.
- Desktop: greeting around 35% of the viewport height, then a large centered composer (max 720px, 64px tall), then "Coming up" as a row of up to three glass cards with a "See all" link below the composer. This is the Claude pattern: the composer sits in the middle until the first message.

Active state (after the first message)
- Composer docks to the bottom of the column at every width. Greeting and Coming up disappear. Chat column: 100% on mobile, max 680px tablet, max 760px desktop (800px at 1600+).
- Desktop top bar inside the column: chat title on the left, a "Plan" button on the right that toggles the right panel.

Cards
- Requirements: two columns (Documents, Rules) when the column is 720px or wider, one column below. Each row keeps its check or exclamation and the underlined "Where I found this".
- Plan timeline: three steps in a row when 720px or wider, vertical below.
- Draft card: larger text area on desktop with the word count shown. Approve & Sync and Not yet sit in one row, right-aligned, on desktop, and stacked full-width on mobile.
- Application Pack: checklist pinned in the right panel on desktop, copy-ready answers in the column, emails in an accordion.

"Where I found this"
- Mobile: expands inline, as now. Tablet: opens the slide-over sheet. Desktop: fills the right panel with the quote, the source link and the page title; the clicked row stays highlighted.

## 5. Landing and sign-up

- Landing, mobile: as the PNG.
- Landing, tablet: centered hero, wordmark about 120px, headline 40px, CTA 360px wide.
- Landing, desktop: top bar with wordmark left and "Log in" right. Two columns, max 1200px. Left: wordmark, headline (clamp 40 to 56px), the "You approve every step" pill, "Try it for free" (black, 280px) and the log in line. Right: a static glass preview of a real result (a fictional user bubble, three status lines with checks, a requirements card with "Where I found this"). Larger blurred blobs, positioned by viewport width.
- Sign-up: glass card, max 440px, centered at every width, back button inset 24px from the viewport's top-left.

## 6. Type, spacing, interaction

- Type with `clamp()`: greeting 28 to 44px, headline 40 to 56px, body 16px, caption 13 to 14px. Max line length about 70 characters.
- 4px spacing grid. Radii from tokens (24px cards, fully rounded buttons).
- Motion: Framer Motion springs from the spec, panel slide 240ms, reduced-motion respected.
- Keyboard (desktop): Enter sends, Shift+Enter adds a line, Ctrl/Cmd+K new chat, Esc closes the panel or modal. Visible focus ring in black, 2px.
- Contrast 4.5:1 for every text-on-glass pair.

## 7. Build order (commit each, then the human screenshots at three widths)

1. Foundation: remove the phone frame, `AppShell` grid, breakpoint variables, sidebar states.
2. Landing and sign-up, all three forms.
3. Home empty state, all three forms.
4. Conversation, cards, composer docking, right panel and tablet sheet.
5. Sidebar contents, logout modal, Clear all with Undo, rail collapse.
6. Polish: hover and focus states, motion, wordmark spacing, empty and error states.

## 8. Acceptance checklist (the human runs this in the browser)

At 390, 820 and 1440 (and spot-check 360, 1024, 1920) for the landing, sign-up, home, a conversation with cards, and the open sidebar:
- No overlap, no clipped text, no horizontal scroll.
- Nothing sits in a narrow centered strip on a wide screen.
- The navigation behavior matches section 1.
- Evidence opens inline, in a sheet, or in the right panel as specified.
- Black appears only on the one primary action per screen.
- Buttons are at least 44px on mobile and tablet.
