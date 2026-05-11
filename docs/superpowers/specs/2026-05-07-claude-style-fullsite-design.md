# Claude-Style Full-Site Redesign

## Scope

Redesign the full Signal Hub UI: home signals dashboard, holding page, stocks page, and settings page. Keep existing routes, data fetching, state management, and business behavior unchanged.

## Visual Direction

Use a Claude-inspired product style: warm paper background, ink-like foreground, restrained serif headings, fine borders, low-radius surfaces, and terracotta accent actions. The app should still read as a dense trading and research workstation, not a marketing page.

## Architecture

The redesign is implemented through shared CSS tokens in `src/app/globals.css`, shared navigation chrome in `src/components/app-shell.tsx`, and page-level class updates where a component owns its own top-level surfaces. Most existing components already consume Tailwind theme tokens such as `bg-panel`, `border-line`, `text-muted`, `text-accent`, `text-success`, and `text-info`, so token changes should restyle the majority of the app without touching data code.

## Requirements

- Replace the current green/blue grid background with a warm paper-like background.
- Add a serif display font token for headings and app shell identity.
- Move the primary accent from blue to terracotta while keeping green, blue, gold, and red available for semantic data states.
- Restyle `AppShell` sidebar, top header, active nav, status pills, logo, and settings button.
- Restyle settings page containers, tabs, forms, buttons, inputs, list rows, and feedback states to match the same system.
- Lightly tune holding page chart colors and shared summary surfaces so the page does not retain the previous neon dashboard feel.
- Remove temporary preview artifacts from the public app before completion.
- Verify with a failing-then-passing UI theme contract test, lint/build, and browser inspection.

## Non-Goals

- Do not change API routes, fetch behavior, watch-list persistence, holdings math, stock research data, or feed merging behavior.
- Do not introduce a new component library.
- Do not add a landing page.
