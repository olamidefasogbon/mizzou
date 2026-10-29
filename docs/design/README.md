# Mizzou design references

- `1-landing.png` … `9-plan-and-draft.png`: the nine mobile screens (390x844 @2x). Layout, spacing, color and glass are exact.
- **The wordmark in the PNGs is a plain serif stand-in.** The real wordmark is the Google Font **Pinyon Script** (text "Mizzou"). Load it with next/font/google and use it for every wordmark.
- `html/*.html`: standalone, openable versions of each screen. Copy exact CSS values from here (glass, radii, colors, spacing). Open them in a browser to see the real Pinyon Script wordmark.
- `source/*.dc.html` and `canvas.json`: the original design-canvas files. They need the canvas runtime (support.js) to render, so use `html/` for viewing. Kept for reference only.

Screen order and links: Landing -> SignUp -> Chat (home) -> PlusMenu / Panel -> Logout; Conversation -> Review -> Approve.
