# Mizzou UI corrections (docs/design/UI_CORRECTIONS.md)

This file supersedes `docs/design/RESPONSIVE.md` wherever they differ. Specifically it removes the pinned sidebar, the 72px rail, the collapse button and the right evidence rail. Brand tokens do not change.

## 0. Rules that govern everything

1. **Zero state.** Every list, card, badge and panel starts empty or absent. Nothing is shown because it might be useful. Things appear only when real data exists or when the user asks for them.
2. **Nothing is pinned.** No sidebar, rail or panel is ever permanently on screen. Navigation and evidence are overlays the user opens by clicking.
3. **Overlays never move the layout.** Opening or closing a panel must not change the width or position of the chat column.
4. **One mechanism per job.** One menu panel. One evidence overlay. No inline expanders that duplicate them.
5. **Each device has its own design** for landing, sign-up, home and overlays (sections 4 and 5), not one layout stretched.
6. **Craft bar (section 6) is a requirement,** not polish.

## 1. App shell, all devices

Delete: the pinned `.pinned` sidebar, `.railCol`/`RailStrip`, `collapseBtn`, `EvidenceRail`, `railOpen`, `collapsed`, `--sidebar`, `--panel`, the grid-column layout and every related media query. The shell is a single centered column plus overlays.

Top bar (fixed, 56px plus safe-area, z-index 30), three controls in this order:
- Left: menu button (the two-line icon from the PNGs). Opens the menu panel on click only. No hover open. No edge swipe is required, but may be added on touch.
- Center: wordmark (Pinyon Script). On home and in a chat the wordmark stays; the chat title never replaces it.
- Right: new-chat button, solid and fully opaque at all times.
- All controls: 44px circles, glass fill, 20px SVG icons with one stroke width (1.75). Insets: mobile 16px, tablet 24px, desktop 24px from the viewport edge (the bar spans the viewport on desktop, the column below it stays centered).

Known bug to fix: a faded new-chat icon renders behind the page at low opacity on tablet and desktop. Blobs are `z-index: 0; pointer-events: none`; all content sits above them; no control is ever below the blob layer.

## 2. Menu panel (the "sidebar")

- Opens when the menu button is clicked. Closes on: its own close button, a scrim click, Esc. Focus is trapped while open and returns to the menu button on close. Page scroll is locked while open.
- It overlays. The chat column does not shift or resize.
- Mobile: left drawer, 84vw wide, max 340px, full height, slide 260ms.
- Tablet: floating glass panel, 360px wide, inset 12px from top, bottom and left, 28px radius.
- Desktop: floating glass panel, 320px wide, inset 16px from top, bottom and left, 28px radius, token shadow.
- Header: wordmark on the left, a proper close button (X icon, 44px) on the right. Not text glyphs like « or ».
- Content, top to bottom: New chat row, Reminders (count badge only if the count is above zero; "No reminders yet" when empty), Chats ("Clear all" only if chats exist; "No chats yet" when empty), then Settings and the user row at the bottom (name from the real profile, or "Guest").
- Log out confirmation modal renders through a portal at z-index 70.

## 3. Home and conversation

Home, zero state:
- Greeting and composer only. Nothing else.
- **Coming up does not render when there are no reminders.** It appears when at least one real reminder exists, with a spring rise, listing up to three. It has a close button. Closing hides it until a new reminder is created or one becomes due (store a dismissed-version value with the reminders store). "See all" opens the menu panel at Reminders.
- Mobile: composer docked at the bottom, greeting centered in the remaining space.
- Tablet and desktop: composer centered directly below the greeting; after the first message it docks to the bottom.

Bug to find and fix: at about 640px wide the greeting block is centered in the left half of the viewport and its left edge is clipped ("What" cut off). Audit widths, `--col`, flex centering and overflow on every wrapper. No horizontal scroll or clipping at any width from 320 to 1920.

## 4. "Where I found this" (evidence)

- Never visible on home. Never a column. It exists only after the user clicks "Where I found this" on a requirement, and disappears when closed.
- Mobile: bottom sheet, max 60dvh, drag handle, scrim, close button.
- Tablet: right floating glass sheet, 400px, inset 12px, scrim.
- Desktop: right floating glass card, 380px, top 88px, inset 16px, no scrim, closes on outside click, Esc or its close button. The page behind does not resize.
- Content: requirement title, the evidence quote, the source page title, "Open the source page". Remove the inline expander so there is one mechanism.
- It closes when the chat changes.

## 5. Landing and sign-up: separate design per device

Landing
- Mobile: as the PNG.
- Tablet: one large glass card, max 560px, centered. Inside: wordmark, headline (44px), the "You approve every step" pill, a 360px black "Try it for free" button, the log in line. Larger blobs behind.
- Desktop: top bar with the wordmark left and a "Log in" text button right. Two columns, max 1200px. Left, left-aligned: wordmark, headline (clamp 48 to 64px), pill, a row with "Try it for free" (black, 280px) and "Log in". Right: three stacked glass cards that explain the product in plain copy: "Tell me what you want", "I read the whole official site", "You approve every step". Static product copy only, no fake user data, no fake results.

Sign-up
- Mobile: as the PNG.
- Tablet: centered glass card 480px, back button inside the card's top-left.
- Desktop: split screen. Left half: wordmark and the headline "From link to executed application." Right half: the glass sign-in card, 440px, centered. Back button at the top-left of the viewport.

First-run workflow: landing, sign-up (or guest), empty home. No extra tutorial or welcome screens. The profile is built in conversation only when a task needs it.

## 6. Craft bar (applies to every screen)

- 8px grid. All spacing and sizes are multiples of 4 or 8.
- One icon set: SVG, 20px, stroke 1.75, round caps. No text glyphs as icons, no emoji.
- Type: Inter 400, 500 and 600 only. `text-wrap: balance` on headlines. Tabular numerals for dates and counts. Line-height 1.4 to 1.5 for body.
- Opacity below 1 is allowed only on disabled controls. Nothing partly visible, ghosted or behind another layer.
- Every interactive element has default, hover (pointer devices), focus-visible (2px black ring), active and disabled states. 44px minimum touch targets on mobile and tablet.
- Motion: 200ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`, springs for card rise and sheets, and `prefers-reduced-motion` respected. No layout shift on open or close.
- z-index scale as tokens: blobs 0, content 1, top bar 30, scrim 40, panel 50, evidence 60, modal 70, toast 80.
- Backdrop blur on at most three layers at once: the top bar, the open panel or sheet, and the composer. Chat cards use the translucent fill, hairline border and shadow.
- No leftover or dead code, no commented-out blocks, no duplicate hidden copies of any screen.

## 7. Acceptance (the human checks these in the browser)

Widths: 360, 390, 430, 640, 768, 820, 1024, 1180, 1440, 1920. Screens: landing, sign-up, empty home, home with one reminder, conversation with requirements, menu panel open, evidence open, logout modal.
- Fresh storage opens to greeting plus composer only. No Coming up, no panel, no badge, no name.
- The menu panel opens only on click and closes by all three methods. No pinned UI at any width.
- Opening the menu or evidence never changes the column's width or position.
- No ghost icons, no clipping, no horizontal scroll, no overlap.
- Landing and sign-up look different on mobile, tablet and desktop, as specified.
- The "Where I found this" overlay is absent from home.
