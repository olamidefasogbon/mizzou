# Mizzou visual direction: meta.ai style (docs/design/META_STYLE.md)

Decision (Oct 29): Mizzou's look follows meta.ai: white canvas, Meta Blue for actions, black for normal text, Meta-style type and interaction patterns. This replaces the grayscale Liquid Glass look and the nine reference PNGs for visual styling. Everything else stands: the layout rules in `UI_CORRECTIONS.md` (zero state, nothing pinned, overlays never move the layout, separate design per device), all copy, gates and behavior.

## 1. Tokens come from the real site

The human captures the real values from meta.ai (DevTools, Inspect, Computed, or the eyedropper) and saves them in `docs/design/META_TOKENS.md`: font-family for body, headings and composer; hex values for the blue (primary button), page background, black text, secondary text, border, user-bubble gray and hover gray; radii of the composer, bubbles and cards; composer height; shadow; sidebar width; focus ring. When that file exists, use its values exactly. Until it exists, use the provisional values below and keep every value in `styles/tokens.css` so one edit changes everything.

| Token | Provisional value |
|---|---|
| Page | `#FFFFFF` |
| Text | `#000000` |
| Secondary text | `#65676B` |
| Meta Blue (actions, links, focus) | `#0064E0` |
| Blue hover / pressed | `#0057C2` / `#004BA8` |
| Border / divider | `#DEE3E9` |
| Muted surface (user bubble, hover) | `#F1F4F7` |
| Success / error | `#31A24C` / `#E41E3F` |
| Radii | 28px composer and pills, 20px cards, 18px bubbles |
| Shadow | `0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)` |
| Font | meta.ai's computed font if it is a system or open font; otherwise Inter (already loaded) with a system-ui fallback. Do not ship a proprietary font file. |

The wordmark stays Pinyon Script in black unless the human decides otherwise. It is one token (`--mz-wordmark-font`).

## 2. What changes

- Remove: the blurred blobs, `.mz-bg` blobs, `.mz-glass`, every `backdrop-filter`, `--mz-glass*` and `--mz-blob*` tokens.
- Surfaces are flat white with a 1px border and the small shadow. Overlays (menu panel, evidence overlay, modals) are white with the larger shadow and a light scrim where the spec has one.
- Primary actions: filled Meta Blue, white text, fully rounded. Secondary: muted gray fill or blue outline. Links and "Where I found this": blue, underlined on hover. Black is for text only, never for buttons.
- Focus: 2px Meta Blue ring with 2px offset. Hover on pointer devices: blue darkens one step, gray surfaces lighten.
- Icons: keep the single outlined SVG set, 20px, stroke 1.75, black. Active or primary icons blue.

## 3. Patterns (confirm each against meta.ai while capturing tokens)

- Empty state: greeting and a large rounded composer in the middle of the page, with a soft shadow and a round blue send button once there is text. Mobile docks the composer at the bottom.
- Messages: the user's message is a right-aligned muted-gray bubble. Mizzou's replies are plain text on white, left-aligned, no bubble, with generous line height.
- Agent steps ("Reading the admissions page", "Found the FAQ, checking it") appear as one compact list under the reply: a blue spinner while active, a green check when done, ordered and updated in place. Never duplicated.
- Cards (program match, fit, requirements, plan, draft, pack): white, 1px border, 20px radius, 20px padding, one title line, content, then the actions row. Gate buttons: primary blue ("Yes, that's it", "Yes, let's apply", "Approve & Sync"), secondary gray ("Not quite", "Not now", "Not yet").
- Requirement rows: green check or amber exclamation SVG, text, then a blue "Where I found this" link that opens the evidence overlay.
- Top bar: white, 56px, 1px bottom border once the page scrolls, menu button left, wordmark center, new chat right.

## 4. Rebuild the conversation screens (currently unstyled)

`/app/c/[chatId]` and every card on it were never restyled and render as plain HTML. Rebuild them in this style, with CSS modules and tokens only (or fix Tailwind, but do not mix the two approaches). Message list scrolls under the fixed top bar with 72px top padding and above the composer; max column widths as in `UI_CORRECTIONS.md`.

## 5. Landing and sign-up

Same per-device structure as `UI_CORRECTIONS.md` section 5, restyled: white background, blue primary button, black text, hairline borders, no blobs. The "You approve every step" pill stays on the landing page, as a bordered pill.

## 6. Acceptance

- No `backdrop-filter`, blobs or glass tokens remain (grep).
- No black buttons. Every primary action is Meta Blue.
- Contrast: blue on white and text on white at least 4.5:1.
- Conversation page at 390, 820 and 1440: no unstyled elements, no overlap with the top bar, no duplicated messages or steps.
- All colors and radii come from `tokens.css`.
