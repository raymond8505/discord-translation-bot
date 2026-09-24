# Testing

vitest 5, `environment: node`, collection glob `src/**/*.test.ts` (a test outside that glob is
skipped without any error). `yarn test:run` is the pre-push hook; `yarn typecheck` covers test files too (`tsc` catches
what esbuild strips), so run it separately and read its own exit code.

## Fixtures

All shaped data lives in `src/fixtures/*.fixture.ts` and is imported by tests; test files hold no
module-level literals or `makeX` factories. The fixtures are **runner-free** — they never import
vitest — so any harness can use them, and `tsconfig.build.json` excludes the directory from the
image.

| Fixture | Provides |
| --- | --- |
| `env.fixture.ts` | `validEnvSource` / `makeEnvSource()` (raw strings), `validEnv` / `makeEnv()` (parsed) |
| `languages.fixture.ts` | `libreLanguageCodes` (realistic `/languages` set incl. `zt`/`nb`/`pb`, no `hr`/`lt`), `primaryOnlyCodes`, `makeSupported()` |
| `libretranslate.fixture.ts` | response payloads, `makeJsonResponse()`, `makeFetch()` (records calls), `makeHangingFetch()` (drives the real timeout path) |
| `redis.fixture.ts` | `makeFakeRedis()` — in-memory `RedisLike` + `RateLimitRedis`; `del([])` throws; `incr` returns the new value so "1 means first in the window" holds; `expireCalls` records TTLs. `makeFailingRedis()` rejects every command, `makeHangingRedis()` never settles |
| `cache.fixture.ts` | `cacheEntry` / `makeCacheEntry()` |
| `backend.fixture.ts` | `makeFakeBackend()` — records `translateCalls`, default echo translation `[target] text` |
| `context.fixture.ts` | `makeContext()` — full `AppContext` over the fakes, `makeRecordingLogger()`, and `alwaysLimited(scope, retryAfter)` for a handler's over-limit branch (pass as `rateLimiter`) |
| `messages.fixture.ts` | `makeMessages()` — the real `en` plus a partial `fr` (`frenchMessages`), `zh-Hans` without `zh-Hant`, and `nb`; `makeContext()` builds its `i18n` from it so handler tests never depend on generated files |
| `interaction.fixture.ts` | chat-input / autocomplete / context-menu / help / select fakes with a `calls` log; each takes the `locale` its handler reads, plus `userId`/`guildId` (`USER_ID`/`GUILD_ID` by default, `guildId: null` for a DM). `lastReplyDescription()` reads the ephemeral answer, `lastPostDescription()` / `lastPostPayload()` what landed in the channel (`send`, or the `reply` the message triggers post) |
| `post.fixture.ts` | `CHANNEL_ID` / `POSTED_MESSAGE_ID`, `makePostRef()`, and `makePostedMessages()` — a fresh id per post, so a fixture driven twice records two distinct posts and the registry keeps both |
| `messageEditor.fixture.ts` | `makeFakeMessageEditor()` — records every `edit`, and replays `gone` or a rejection for named message ids |
| `invalidation.fixture.ts` | `makeEditedMessage()` — the `messageUpdate` payload, partial or full, with `fetchCalls` proving the partial path |
| `message.fixture.ts` | `makeMentionMessage()` for the mention trigger; its `author` is a recipient, so `message.author.dms` holds the refusals it was sent (`dmsClosed` makes them fail) |
| `dm.fixture.ts` | `makeRecipient()` — records every `send` in `dms` **before** throwing, so a test can tell "never tried" from "refused"; `lastDmDescription()` reads the last one |
| `reaction.fixture.ts` | `makeFlagReaction()` (siblings seed `reactions.cache` for the duplicate rule; `fetchCalls` proves the partial path), `makeReactingUser()`, and the `FLAGS` / `NON_FLAGS` emoji written as escapes |

## Patterns

- Handlers are tested through their structural interfaces with the fakes above; the router test
  (`src/interactions.test.ts`) wraps a fake in the type-guard surface with `asInteraction()`.
- Assert on builder output via `.toJSON()` (`embed.toJSON().description`,
  `row.toJSON().components[0].options`).
- Fake timers: `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync()`; restore in
  `afterEach`. The heartbeat test writes under `os.tmpdir()`.
- **A cache hit in one step of a multi-step test hides a backend call in the next** — vary the target
  (the router test does) rather than clearing the fake. The translation cache is **content-keyed**,
  so two steps collide whenever `(text, requested source, target)` match: a different message id no
  longer separates them, and most handler tests reuse one fixture text. The corollary that is easy to
  miss: a **forced-source step also fills the `auto` entry** for that text and target, so an auto step
  after a forced one on the same pair is a hit. `commands/translate.test.ts` carries a comment saying
  why its four steps must all use different targets.
- **The default `makeContext()` carries a real limiter over the fake Redis**, so a test that drives
  one handler many times can exhaust a budget and start getting refusals instead of translations.
  Reach for `alwaysLimited()` to assert the over-limit branch; for everything else keep the run
  under `RATE_LIMIT_USER_PER_MIN` (20) or vary the actor with `userId`.
- Deadline paths (`CHECK_TIMEOUT_MS`) need `vi.useFakeTimers()` plus
  `await vi.advanceTimersByTimeAsync(...)`, and `vi.useRealTimers()` in a `finally`.
