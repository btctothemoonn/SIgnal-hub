# Owned X reader bridge operations

The Node worker is the sole scheduler and database writer. It spawns
`scripts/x-owned-reader-bridge.py` with a version 1 JSON task over stdin. Python
reads one private X session and emits sanitized JSONL. No credentials belong in
arguments, source control, stdout, stderr, or website responses.

Use Python 3.12 and an external isolated environment with `twscrape==0.20.1`
(see `scripts/requirements-x-owned-reader.txt`). Deployment uses the prevalidated
environment; it does not install or upgrade dependencies on every release.
Keep the session directory private (700) and database/cooldown files private
(600). The bridge requires exactly one active session. Never run the pilot probe
or another collector against that session while the formal worker runs.

`mode: "doctor"` is a network-free stdin task. It emits `doctor` with
`sdkVersion`, `protocolVersion`, `sessionAvailable`, `coolingDown`, and
`nextRetryAt`, followed by `cycle_complete`. It queries aggregate session
readiness and relevant endpoint-lock timestamps without reading cookie columns.
It does not log account names or private paths and does not mutate session locks.

All HTTP requests, including SDK bootstrap, redirects, canonical TweetDetail
confirmation, and timelines, share the same 80-request/180-second gate. Starts
are spaced by at least 2 seconds. HTTPx automatic redirects and transport retries
are disabled before clients are created. The bridge stops through an exception
outside the SDK's retry/account-rotation handlers. Only same-origin redirects
are followed; login/challenge destinations stop the whole run.

Each author receives at most 5 timeline pages in total. UserTweets is scanned
for all authors' `posts-and-quotes` windows before any UserTweetsAndReplies
supplement. Each author's remaining pages then scan replies.
Primary coverage includes full public post/quote bodies available to this session.
Subscriber-only bodies are excluded only after the exact requested TweetDetail
entry proves `TweetPreviewDisplay`, `Subscribe to unlock`, the same author's
official `https://x.com/<author>/superfollows/subscribe` URL, stable ID/author,
and original creation time. Exclusions emit no preview feed/body and supply no
boundary evidence. Account completion reports deduplicated
`subscriberContentExcluded` and `subscriberExcludedTweetIds`; unknown previews
still keep coverage incomplete. Paid bodies are outside this public-feed coverage.
Reply coverage is reported independently. Unknown conversation modules and
preview entries stay incomplete unless each candidate is confirmed through the
requested canonical TweetDetail focal ID. Confirmed history retains its actual
author, original creation time and original ID; timeline arrival time is never
used as publication time. Quoted objects stay context and are not emitted by
recursive parsing. Native reposts remain outside this reader's coverage.

Candidates with an inline stable author ID and original creation time proving
they belong to another author or fall outside this fixed window need no detail
request. Their dates and module positions never supply a paging boundary. All
other ambiguous candidates require independent canonical confirmation, except
missing inline `allTweetIds` candidates whose validated modern Twitter Snowflake
timestamp is outside the window by more than a minute. This conservative fallback
applies only before `fromAt`; IDs after `throughAt` still require canonical
confirmation because edit IDs can postdate the original creation. It excludes
only an older out-of-window ID; it proves no author, body, focal selection, or
pagination boundary. Small/legacy, malformed, overflowing and implausibly future
IDs retain the canonical requirement. Real canonical creation times are checked
against Snowflake decoding in the offline tests. The epoch and suffix layout are
documented in [Twitter's published Snowflake source](https://github.com/twitter-archive/snowflake/blob/snowflake-2010/src/main/scala/com/twitter/service/snowflake/IdWorker.scala).

An explicit `TweetWithVisibilityResults` wrapper may carry a child without a
typename. Such a child is accepted only with matching tweet/author identifiers,
valid original date and full text or complete note text. Arbitrary untyped nodes,
previews, unavailable types and partial bodies stay rejected. Truncated legacy
text remains rejected unless a complete valid note body supplies the full text.

A non-pinned standalone entry before `fromAt`, an explicit Bottom termination,
or an explicitly empty Bottom cursor can prove the window boundary. Missing
cursors, unknown instructions, partial fields, repeated cursors and page limits
cannot prove completion. Verified items may still be emitted during incomplete
checks. Node commits feed writes before persisting a completed checkpoint.

429/zero remaining/error 88 pauses the session until the longest existing or
server-advertised reset/Retry-After, with a minimum 60-second wait. Network and
response failures retain a finite 5-minute cooldown. Budget/deadline exhaustion
reports a finite 60-second next retry without deleting persistent cooldowns.
When every primary window has completed, exhausted optional reply budget simply
ends the cycle with incomplete reply status. It does not pause healthy primary
coverage. Any incomplete primary window still receives the global finite pause;
authentication and rate limits always pause globally.
Authentication/challenge failures pause indefinitely and mark the SDK session
inactive. Restore the session through the approved private setup workflow, then
explicitly retire the bridge's authentication pause file; retain all SDK endpoint
locks and unrelated cooldowns. Never shorten a rate-limit reset to force recovery.

Run offline tests with the pinned environment:

```text
python scripts/x-owned-reader-bridge.test.py
```

The transport tests exercise real HTTPx requests against an ephemeral loopback
server. They do not contact X or open the private production account database.
Windows runs pure parsing/protocol tests; Linux with the pinned SDK runs the
whole suite. A completed bridge protocol (exit 0) does not imply all accounts or
reply windows completed. Inspect account completion and independent reply status.
