# Remove Opportunity Radar Design

## Goal

Completely remove the Opportunity Radar feature from Signal Hub. Signal Flow
returns to two user-facing mobile panels, Latest Signals and AI Summary, while
all Opportunity-specific API, worker, storage, health, deployment, and service
code is removed.

## Scope

### Signal UI

- Remove the Opportunity tab and panel from desktop and mobile Signal layouts.
- Remove the `OpportunityRadar` component and its tests.
- Remove the `opportunityEnabled` prop and
  `OPPORTUNITY_RADAR_UI_ENABLED` feature flag.
- Keep the existing two-panel mobile swipe behavior between the feed and AI
  summary, including the summary top-position behavior and feed position
  restoration.

### Application Code

- Delete all `/api/opportunities` routes and route tests.
- Delete Opportunity-specific rules, sources, AI evaluation, storage, worker,
  URL helpers, shared types, and their tests.
- Delete the Opportunity worker script and package scripts.
- Remove Opportunity references from the system health snapshot and systemd
  service registry.
- Remove Opportunity service creation, enablement, and restart behavior from
  the VPS deployment script and update its tests.
- Remove obsolete Opportunity design and implementation documents because the
  Git history remains the recovery source.

### Runtime Cleanup

- Stop and disable `signal-hub-opportunity.service` on the VPS.
- Remove the Opportunity systemd unit and reload systemd.
- Delete `opportunities.sqlite`, `opportunities.sqlite-wal`, and
  `opportunities.sqlite-shm` from the Signal Hub runtime directory.
- Remove `OPPORTUNITY_*` entries from local and VPS `.env.local` files without
  displaying unrelated secrets.

## Out of Scope

- Signal feed behavior, TG/X collection, and translation.
- Signal AI summaries.
- Stocks, Holding, Douyin, authentication, and PWA behavior.
- Historical Git commits containing Opportunity Radar.

## Resulting Signal Layout

Desktop keeps the existing two-column feed and AI summary layout. Mobile keeps
one horizontal pager with two tabs:

1. Latest Signals
2. AI Summary

There is no replacement for Opportunity Radar and no hidden feature flag.

## Error Handling

- Runtime cleanup must tolerate an already stopped or missing service.
- Database cleanup is limited to the three explicitly named Opportunity
  SQLite files inside the configured Signal Hub runtime directory.
- Deployment must not restart or modify Signal collection workers for this UI
  removal; only the web service needs restarting after the new build.

## Verification

- Add/update source-contract tests proving the Signal layout has only feed and
  summary panels and no Opportunity imports or feature flag.
- Update deployment, service registry, system health, and homepage tests.
- Run the full test suite, ESLint, and production build.
- Verify no Opportunity references remain in active code, package scripts, or
  deployment configuration.
- Verify GitHub and VPS use the same commit.
- Verify `signal-hub-opportunity.service` is absent and the three Opportunity
  SQLite files are absent on the VPS.
