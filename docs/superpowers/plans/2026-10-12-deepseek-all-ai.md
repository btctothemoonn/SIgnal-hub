# DeepSeek for All AI Generation

**Goal:** Route every Signal Hub text-generation, extraction and translation request to DeepSeek while preserving sources, schemas, caches and non-AI behavior.

**Approved scope:** All AI features, with direct deployment after verification. MiniMax's separate web-search API remains a retrieval source; it is not a chat model and has no equivalent DeepSeek Chat API replacement.

**Design:** One server-side provider resolver accepts existing DeepSeek credentials or legacy credentials explicitly paired with the official DeepSeek endpoint. It never sends MiniMax/OpenAI credentials to DeepSeek or falls back to a different model provider. Use `deepseek-flash` by default, honor explicit DeepSeek model overrides, disable thinking, and bound output. Missing credentials retain the caller's existing cached/rule-based/empty-state behavior. No production credentials are read, copied, created or changed by this change.

## Implementation
- [x] Add failing provider-selection tests, implement `src/lib/deepseek-provider.ts`, and route shared summary configuration through it
- [x] Migrate all eight chat call sites, including standalone translation, Douyin and earnings extraction; preserve the two independent web-search call sites
- [x] Update test-only fixtures and add endpoint/payload/missing-key regressions; preserve historical provider/cache decoding
- [x] Update example configuration and migration notes with safe credential-presence checks and residual search dependency
- [x] Run full unit suite, lint, type check/build, and independent review; address material findings before publication
- [ ] Publish exact verified commit to main, inspect remote/CI, then verify actual production release and health or report the concrete access blocker

## Review focus
- Legacy MiniMax credentials must never be transmitted to DeepSeek
- Hostname lookalikes, URL credentials, query strings and non-HTTPS endpoints must not qualify as official DeepSeek
- An explicitly configured non-DeepSeek fallback must not be called
- Missing credentials must not discard existing summaries or damage data-source collection
- Translation metadata and old caches remain readable; no old translation provider is silently called after migration

## Verification record
- Baseline focused summary/provider/timeout tests passed before modifications
- Production version and configuration remain unverified: unauthenticated version endpoint returned 401; cloud browser navigation was blocked

- Final local verification: all 293 test files passed with TZ=Asia/Shanghai; ESLint and production build (including TypeScript) passed
- Independent review completed; unpaired legacy credentials and malformed endpoint/model-override edge cases fixed with failing-then-passing regression tests
- No production model requests or credential changes were performed during verification
