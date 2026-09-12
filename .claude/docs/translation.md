# Translation pipeline

## Backend interface

`src/backends/types.ts`:

```ts
interface TranslationBackend {
  readonly name: string;                       // stored in every cache entry
  translate(text, source /* "auto" | code */, target): Promise<{ text; detectedSource }>;
  languages(): Promise<string[]>;              // backend codes; feed the menus
}
```

Failures are `BackendError` with `kind`: `timeout` | `http` | `network` | `invalid_response` |
`unavailable`. `src/errors.ts` maps kinds to user wording; `network`/`http` read as "still starting
up" because that is what a LibreTranslate that is loading models produces. Only
`createBackend()` in `src/backends/index.ts` names a concrete class; swapping is a `BACKEND` env
change plus a `case`. `OllamaBackend` is a stub that reports `unavailable`.

`LibreTranslateBackend` takes an injected `fetch` and per-call timeouts (30 s translate, 10 s
languages) via `AbortSignal.timeout`. Response contract (verified against v1.9.6):
`POST /translate {q, source, target, format:"text"}` → `{ translatedText, detectedLanguage?:
{ confidence, language } }`; `GET /languages` → `[{ code, name, targets }]`; `GET /health`.

## Language codes

`src/locale.ts` holds `LANGUAGES`: one entry per language with `label`, preferred-first `codes`,
and the Discord `locales` that map to it (all 32, tested). Resolution is always against the
backend's live set (`ctx.languages.get()`), so an install without `zt` serves zh-TW via `zh`, and
Croatian simply drops out of the menu on a backend that lacks `hr`.

- `resolveTarget(locale, supported)`: table → bare prefix → `en`.
- `menuLanguages(supported)`: dedupes by backend code, sorted by label (≤ 50 for two menus).
- `parseLanguageHint(text, supported)`: label / code / locale, tolerates "to|into|in" prefixes.
- `SupportedLanguages` (`src/languages.ts`) memoizes only a successful fetch; `peek()` is the
  synchronous view for autocomplete.

## Cache

`src/cache.ts` over a structural `RedisLike` (get / set with `EX` / del / `scanIterator` yielding
`string[]` batches — node-redis ≥ 5 semantics).

| Key | Value | TTL |
| --- | --- | --- |
| `tr:{sourceId}:{target}` | JSON `{ text, backend, source_lang, created_at }` | `CACHE_TTL_SECONDS` |
| `src:{sourceId}` | original text (for the re-translate menu) | same |

`translateWithCache()` (`src/translate.ts`) is cache-first; every cache call is wrapped so a Redis
outage logs and degrades to uncached — it never fails a reply. Corrupt entries read as misses.

Invalidation (`src/invalidation.ts`): `messageUpdate` when the content actually changed (or the old
message is partial) and `messageDelete` call `cache.invalidate(id)` = `SCAN MATCH tr:{id}:*` +
`DEL` in batches, then `DEL src:{id}`. Never `KEYS`; never `DEL` with an empty list (the server
rejects it — the fake throws to keep the guard honest).
