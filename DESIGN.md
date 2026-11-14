# A to Z Growth Suite design system

Use the exact customer-facing name **A to Z Growth Suite**. Technical repository/database identifiers remain unchanged. Existing WordPress Admin menu instructions retain the actual plugin label until that plugin changes.

## Original logos

Only the two owner-supplied original PNGs are official. Primary: golden circular badge for Auth and brand presentation. Secondary: horizontal rectangle for headers and sidebars. Preserve original bytes, dimensions, transparency and proportions; never redraw, crop, recolor, stretch or pair both in one branding area. Use local repository assets at runtime.

**Blocked:** both public R2 downloads returned HTTP 403 from the managed environment proxy. Original files and integrity evidence are unavailable. Do not claim logo integration or sampled palette validation. The old custom monogram has been removed; a plain text identity remains until originals can be securely downloaded and verified. See frontend/public/branding/README.md. No production Cloudflare/R2 policy change is authorized.

## Tokens and accessibility

`frontend/src/brand.css` centralizes the starting palette, gradient, surfaces, spacing unit and radius. Signature decorative gradient: pink red #FF0054 → cyan #00B8C8; gold #EAB51C is complementary, not body text. These suggested palette values await comparison with the actual PNGs. Text-bearing primary buttons/navigation use darker endpoints #B5003F → #00616B for white contrast. Keep brand gradients selective; no gradient body text.

Use system fonts, existing layout architecture and restrained spacing. Preserve semantic headings, visible focus, keyboard navigation, route protection and explicit unavailable labels. Respect reduced motion. Current UI supports a consistent light mode even when the OS requests dark mode; full dark-mode theming is **not implemented**, so no unsupported dark toggle is presented. Desktop and mobile fixtures must fit without horizontal page scrolling. No fake connection success, metrics or customer records are added to product screens.

Existing Playwright gallery captures login/signup, customer/admin dashboards, WordPress Manager, account and mobile customer dashboard. New checks cover canonical identity, no replacement marks/broken logo requests, light-mode behavior under dark preference, gradient contrast endpoints and reduced motion. Synthetic screenshot data is test evidence, not a live integration claim.
