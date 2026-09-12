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
| `redis.fixture.ts` | `makeFakeRedis()` — in-memory `RedisLike`; SCAN yields an empty page first then `COUNT`-sized pages; `del([])` throws |
| `cache.fixture.ts` | `cacheEntry` / `makeCacheEntry()` |
| `backend.fixture.ts` | `makeFakeBackend()` — records `translateCalls`, default echo translation `[target] text` |
| `context.fixture.ts` | `makeContext()` — full `AppContext` over the fakes, `makeRecordingLogger()` |
| `interaction.fixture.ts` | chat-input / autocomplete / context-menu / select fakes with a `calls` log, `lastReplyDescription()` |
| `message.fixture.ts` | `makeMentionMessage()` for the mention trigger |

## Patterns

- Handlers are tested through their structural interfaces with the fakes above; the router test
  (`src/interactions.test.ts`) wraps a fake in the type-guard surface with `asInteraction()`.
- Assert on builder output via `.toJSON()` (`embed.toJSON().description`,
  `row.toJSON().components[0].options`).
- Fake timers: `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync()`; restore in
  `afterEach`. The heartbeat test writes under `os.tmpdir()`.
- A cache hit in one step of a multi-step test hides a backend call in the next — vary the target
  (the router test does) rather than clearing the fake.
