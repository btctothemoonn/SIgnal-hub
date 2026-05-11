# Installable PWA Design

## Scope

Make Signal Hub installable from iPhone Safari and other modern browsers as a minimal PWA. This step adds web app metadata and home-screen icons only. It does not add offline caching, push notifications, or deployment automation.

## Architecture

Use Next.js 16 App Router metadata conventions. `src/app/manifest.ts` returns a static web app manifest. `src/app/layout.tsx` advertises the manifest, iOS web app mode, Apple title, status bar style, and app icons. PNG icons live in `public/` and are served as static assets.

The existing admin login proxy already allows manifest/icon paths and protects dashboard/API routes. The manifest starts at `/` so an installed app opens the protected dashboard and redirects to `/login` if the session cookie is missing.

## Requirements

- Add a web app manifest with `name`, `short_name`, `description`, `start_url`, `scope`, `display`, `background_color`, `theme_color`, and PNG icons.
- Add 192x192, 512x512, and Apple touch PNG icons under `public/`.
- Keep the icon design simple and consistent with the current `SH` identity.
- Add iOS web app metadata in `layout.tsx`.
- Do not add a service worker or cache dynamic data.
- Keep existing routes, auth behavior, and data fetching unchanged.

## Non-Goals

- No offline mode.
- No push notifications.
- No native iOS wrapper.
- No deployment or GitHub workflow changes.

## Testing

Use existing `.mjs` assertion tests. Add a manifest contract test, a layout metadata source test, and a PNG asset header test. Verify with the focused tests, direct ESLint, and `next build --webpack`.
