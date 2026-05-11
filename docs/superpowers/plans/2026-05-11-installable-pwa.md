# Installable PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Signal Hub installable on iPhone Safari and modern browsers with a manifest and app icons.

**Architecture:** Use Next.js 16 App Router metadata conventions. Add a static `src/app/manifest.ts`, update root metadata in `src/app/layout.tsx`, and generate PNG assets in `public/`.

**Tech Stack:** Next.js 16 App Router, TypeScript metadata routes, existing Node `.mjs` assertion tests, PNG static assets.

---

## File Structure

- Create `src/app/manifest.ts`: returns the web app manifest.
- Create `src/app/manifest.test.mjs`: imports and validates the manifest contract.
- Modify `src/app/layout.tsx`: adds manifest, icons, Apple web app metadata, and theme color metadata.
- Create `src/app/layout-metadata.test.mjs`: source-level test for required metadata fields.
- Create `public/icon-192x192.png`, `public/icon-512x512.png`, `public/apple-touch-icon.png`: app icons.
- Create `public/pwa-assets.test.mjs`: verifies PNG dimensions.

## Tasks

### Task 1: Manifest Contract

- [ ] Write `src/app/manifest.test.mjs` to assert manifest fields and icon references.
- [ ] Run the test and confirm it fails because `src/app/manifest.ts` is missing.
- [ ] Create `src/app/manifest.ts`.
- [ ] Run the manifest test and confirm it passes.

### Task 2: Root Metadata

- [ ] Write `src/app/layout-metadata.test.mjs` to assert layout metadata references the manifest, app icons, Apple web app mode, Apple title, and status bar style.
- [ ] Run the test and confirm it fails because metadata is missing.
- [ ] Update `src/app/layout.tsx` with the required metadata.
- [ ] Run the metadata test and confirm it passes.

### Task 3: Icon Assets

- [ ] Write `public/pwa-assets.test.mjs` to verify PNG signatures and dimensions for the three icon files.
- [ ] Run the test and confirm it fails because icons are missing.
- [ ] Generate simple `SH` PNG icons with warm background and dark foreground.
- [ ] Run the asset test and confirm it passes.

### Task 4: Verification

- [ ] Run the three PWA tests.
- [ ] Run direct ESLint via bundled Node.
- [ ] Run `next build --webpack`.
- [ ] Report any existing warnings separately from new failures.
