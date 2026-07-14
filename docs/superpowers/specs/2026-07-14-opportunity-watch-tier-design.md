# Opportunity Radar Watch Tier Design

## Goal

Keep the existing strict confirmation standard while preventing the Opportunity Radar from appearing empty when useful single-source candidates have not yet reached the confirmation threshold.

## Considered Approaches

1. Lower the global display threshold from 75 to 60. This is simple, but it makes weak single-source candidates look confirmed and removes the meaning of the current threshold.
2. Add a separate watch tier for scores from 60 through 74. This preserves the 75-point confirmation contract while exposing useful candidates with clear evidence-strength labeling. This is the selected approach.
3. Relax clustering and corroboration rules. This may improve multi-source matching, but it risks merging unrelated events and requires a separate precision review before production use.

## Data Contract

- Add `OpportunityTier = "confirmed" | "watch"`.
- Add `tier` to `OpportunityCard`.
- Make `selectedAt` nullable because watch candidates are intentionally not part of the daily confirmed selection.
- Keep the existing `/api/opportunities` query parameters and response envelope.
- For `status=active`, return:
  - confirmed cards that have `selected_at`, are not expired, score at least 75, and are not dismissed;
  - up to five watch cards that are not expired, are not dismissed, have no `selected_at`, and score from 60 through 74.
- For `status=history`, preserve the existing selected-history behavior and mark returned cards as `confirmed`.
- Market and sort filters continue to apply to both tiers.

## UI Behavior

- Split active results into two full-width sections:
  - `确认机会`: confirmed cards, score 75 or higher;
  - `候选观察`: watch cards, score 60 through 74.
- Show a restrained tier badge on each card so the distinction remains visible when cards are scanned or expanded.
- When a section has no cards, show a short section-specific empty state rather than making the whole radar look broken.
- Keep follow, dismiss, evidence expansion, market filters, sorting, browser cache, five-minute polling, and manual refresh behavior unchanged.
- Manual refresh continues to read the persisted snapshot only and does not trigger AI work.

## Selection Semantics

- The hourly worker and the 75-point daily selection threshold remain unchanged.
- The daily cap of ten confirmed opportunities remains unchanged.
- Watch candidates are dynamic and may enter or leave the watch section after each hourly scoring cycle.
- A watch candidate becomes confirmed only through the existing worker selection path after its final score reaches at least 75.

## Error Handling

- AI-unavailable candidates may appear in the watch tier using their rule-only score and the existing `AI 待补充` fallback.
- API or browser refresh failures retain the last browser cache, as they do today.
- Missing evidence or summaries must not prevent a scored watch candidate from rendering.

## Tests

- Store tests prove active results include confirmed cards plus at most five 60-74 watch cards, exclude scores below 60, expired cards, and dismissed cards, and preserve history behavior.
- Route/type tests prove the response contract includes the tier and nullable `selectedAt` fields without adding query parameters.
- Component tests prove confirmed and watch cards render in separate labeled sections and preserve the existing empty, follow, dismiss, and expansion behavior.
- Run the full test suite, ESLint, TypeScript, and production build before deployment.

## Non-Goals

- Do not lower the confirmed threshold.
- Do not change AI prompts, provider routing, worker frequency, source windows, scoring weights, or clustering rules.
- Do not change Signal Flow, Stocks, Holding, or Douyin behavior.
