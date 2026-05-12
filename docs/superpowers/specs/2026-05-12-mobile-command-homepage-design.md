# Mobile Command Homepage Design

## Scope

Optimize the logged-in Signal Hub homepage for a phone-first PWA experience using the selected "Mobile Command" direction. This first pass focuses on visual hierarchy, mobile ergonomics, and overall product polish. It does not change Telegram, X, 985, holdings, stocks, AI summary, authentication, or persistence behavior.

## Design Direction

The homepage should feel like a compact real-time signal console on mobile. The strongest signals should be visible immediately after opening the PWA: app identity, live source health, key counts, an AI summary block, and the merged signal feed.

The visual tone should be darker, tighter, and more operational than the current warm desktop layout, while staying readable and restrained. Avoid decorative gradients, marketing composition, and oversized text. Controls and cards should use stable dimensions, clear borders, and small-radius corners consistent with a serious dashboard.

## Architecture

Keep the existing `AppShell` and homepage composition. Update layout and styling in small, local changes rather than replacing the app structure:

- `src/components/app-shell.tsx` owns the global frame, header, navigation, status pills, theme toggle, settings, and logout.
- `src/app/page.tsx` controls the homepage grid order and mobile/desktop column behavior.
- `src/components/unified-news-panel.tsx` owns the merged Telegram/X/985/Truth feed presentation.
- `src/components/alpha-summary-card.tsx` remains the AI summary surface.
- `src/app/globals.css` owns theme tokens and global polish.

The mobile layout should present AI summary before or near the top of the feed without breaking desktop two-column usage. Desktop should continue to show the feed as the primary left column and AI summary as the right rail.

## Requirements

- Make the logged-in homepage read well at iPhone-sized widths.
- Keep all existing routes, data fetching, polling, auth, and API behavior unchanged.
- Improve the shell header so it is compact, readable, and not overcrowded on mobile.
- Make status pills horizontally scrollable or otherwise stable on narrow screens.
- Bring the AI summary forward on mobile so the user sees the current market/signal brief early.
- Improve feed card visual hierarchy: source, time, title, body, media, translation, and metrics should be easy to scan.
- Keep desktop layout functional and visually consistent with the mobile redesign.
- Preserve PWA metadata and installability.
- Do not introduce a new design library or dependency.
- Avoid page text that explains how to use the app.

## Non-Goals

- No new data sources.
- No native iOS wrapper.
- No offline mode, push notifications, or service worker work.
- No authentication changes.
- No broad rewrite of the large feed component.
- No deployment changes in this step.

## Testing

Use the existing lightweight `.mjs` assertion style where practical. Add or update focused tests for layout contracts and key shell/feed text where the code structure supports it. Verify with focused tests for touched components, lint, and a production build.

Manual verification should include:

- `http://localhost:3000` after login on desktop.
- Mobile-width browser viewport for the homepage.
- PWA-relevant metadata still available at `/manifest.webmanifest`.
- No regression to protected-login behavior.
