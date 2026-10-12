# DeepSeek AI configuration

All locally generated AI summaries, investment briefs, earnings explanations,
market narratives, Douyin summaries, earnings snippet extraction and translations
now use the official DeepSeek Chat Completions API. The default is `deepseek-flash`.
Requests use non-thinking mode; structured tasks continue to request JSON.

## Existing credentials

`DEEPSEEK_API_KEY` is the preferred server-only credential. This change does not
create, copy or rewrite any production credential or environment file.

Existing `AI_SUMMARY_API_KEY`, `AI_SUMMARY_FALLBACK_API_KEY`,
`AI_TRANSLATION_API_KEY` or `OPENAI_API_KEY` entries may also be reused when their
corresponding `*_BASE_URL` explicitly points to `https://api.deepseek.com` or
`https://api.deepseek.com/v1`. A missing legacy endpoint is not proof that a key
belongs to DeepSeek. MiniMax/OpenAI endpoints and keys are not fallback providers.
Non-HTTPS, lookalike hosts, URL credentials, query strings and fragments are rejected.

`DEEPSEEK_MODEL` overrides the default. DeepSeek-only `AI_TRANSLATION_MODEL` and
`DOUYIN_AI_MODEL` are more specific overrides. Existing paired DeepSeek model
configuration is retained. Old MiniMax/OpenAI model names are ignored. DeepSeek's
official documentation currently recommends `deepseek-flash`; the older
`deepseek-v4-flash` alias remains supported by DeepSeek.

The legacy `TRANSLATION_PROVIDERS` list and `AI_TRANSLATION_ALLOW_SUMMARY_KEY`
switch no longer select other translation services. Old cached translations and
translations supplied with upstream feeds remain readable and are not deleted.

## Data sources and degraded behavior

The two MiniMax `/v1/coding_plan/search` integrations remain retrieval sources for
news and earnings snippets. They are separate from model generation, and keep
their existing search configuration. Earnings snippet extraction uses a separate
eligible DeepSeek credential; it never forwards a MiniMax search key to DeepSeek.

When DeepSeek is not configured, the settings status reports unavailable, existing
signal summaries are retained, and callers preserve their normal cached,
rule-based or untranslated fallback. No other model provider is silently called.

## Production verification

The existing VPS deployment workflow preserves `.env.local` and `.signal-hub` by
linking them into releases. Configuration changes only take effect after the
relevant services restart. Do not delete caches to validate this migration.

An authorized operator should verify:

1. The active release commit matches the published commit
2. Web, summary and applicable AI workers are active
3. An eligible DeepSeek credential is present, reporting only a boolean; never
   print environment files, credential values or authenticated request headers
4. Newly generated output records use the intended DeepSeek model and retain
   expected schemas and source references

The authenticated `/api/deployment-version` endpoint exposes the release version.
`/api/system-health` can show cached model metadata, but represents the worst
summary scope and cannot alone prove the active provider. A summary GET can
generate content and call the provider; do not use it as a read-only health probe.

Official references:
- https://api-docs.deepseek.com/api/create-chat-completion/
- https://api-docs.deepseek.com/zh-cn/
- https://api-docs.deepseek.com/guides/json_mode/
