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
backend's live set (`ctx.languages.get()`), so an install without `zh-Hant` serves zh-TW via `zh`,
and Croatian simply drops out of the menu on a backend that lacks `hr`.

**Two code spellings.** `LT_LOAD_ONLY` takes Argos model codes (`pb`, `zh`, `zt`), but
LibreTranslate's `/languages` and `/translate` expose them as `pt-BR`, `zh-Hans`, `zh-Hant`
(`libretranslate/language.py` `aliases`). The table lists both, API spelling first. Code matching in
`parseLanguageHint` is case-insensitive and returns the backend's exact spelling; the customId
pattern accepts `xx`, `xxx`, and `xx-Xxxx` forms.

- `resolveTarget(locale, supported)`: table → bare prefix → `en`.
- `resolveLanguageCode(code, supported)`: one table code → the first of its `codes` the backend
  serves, else null. `src/flags.ts` maps flag emoji onto table codes and resolves them through it.
- `menuLanguages(supported, uiLang)`: dedupes by backend code, named in `uiLang` and sorted by that
  name (≤ 50 for two menus).
- `labelFor(code, uiLang)`: the table label for `en`; otherwise ICU's `Intl.DisplayNames` on the
  def's first code, capitalised. Never passes `auto` or a `t_…` id to ICU (it throws).
- `parseLanguageHint(text, supported, uiLang)`: English or `uiLang` label / code / locale, tolerates
  "to|into|in" prefixes.
- `parseLanguageSpec(text, supported, uiLang)`: `source:target` with either side optional, or a bare
  target; reports `unresolved` parts so callers can name what they didn't understand.
- `SupportedLanguages` (`src/languages.ts`) memoizes only a successful fetch; a memo older than
  `LANGUAGES_REFRESH_MS` (5 min) is served but re-fetched in the background, so a changed
  `LT_LOAD_ONLY` shows up without a bot restart. `peek()` is the synchronous view for autocomplete.

## Detection confidence

`TranslateResult.confidence` (0-100) is LibreTranslate's `detectedLanguage.confidence` and is kept in
the cache entry. `src/reply.ts` renders `detected: French (45%)` and, below `LOW_CONFIDENCE_PERCENT`
(25), adds a "the source language is a guess" field telling the user how to force the source. An
explicit source stores no confidence and renders as `source: French`.

**Why the floor is 25 and not 50.** A *correct* detection scores under 50 often enough that the field
was firing on ordinary English. `libretranslate/detect.py` has two paths, and both produce honest low
scores:

- Under 20 characters it uses lexilang, a dictionary matcher whose confidences are small by nature.
  Measured against the running stack: `"how are you?"` → `en` at **30**, while `"hello"` → 90.
- At 20+ characters it uses langdetect, then filters the candidates to the loaded language set
  **without renormalizing** — probability lost to a language that is not loaded is discarded, not
  redistributed. English is hit hardest, since its nearest langdetect candidates are Dutch, German,
  Afrikaans and Danish and only the first two are among the seven the bot loads.

Full English sentences score 100, so 25 still leaves real doubt flagged. A failure anywhere in
`detect()` returns the literal `Language("en", 0)`, so a give-up is indistinguishable from English at
0% and reaches the reply as one — that case stays flagged (`undetectableResponse` in
`libretranslate.fixture.ts` is that shape; `"🎉🎉"` reproduces it live).

## Cache

`src/cache.ts` over a structural `RedisLike` (get / set with `EX` / del / `scanIterator` yielding
`string[]` batches — node-redis ≥ 5 semantics).

| Key | Value | TTL |
| --- | --- | --- |
| `tr:{sourceId}:{target}` | JSON `{ text, backend, source_lang, created_at, confidence? }` | `CACHE_TTL_SECONDS` |
| `src:{sourceId}` | original text (for the re-translate menu) | same |

`translateWithCache()` (`src/translate.ts`) is cache-first; every cache call is wrapped so a Redis
outage logs and degrades to uncached — it never fails a reply. Corrupt entries read as misses. A
forced `source` skips the read and overwrites the entry.

Invalidation (`src/invalidation.ts`): `messageUpdate` when the content actually changed (or the old
message is partial) and `messageDelete` call `cache.invalidate(id)` = `SCAN MATCH tr:{id}:*` +
`DEL` in batches, then `DEL src:{id}`. Never `KEYS`; never `DEL` with an empty list (the server
rejects it — the fake throws to keep the guard honest).
