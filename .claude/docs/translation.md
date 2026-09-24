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

`src/cache.ts` over a structural `RedisLike` (get / set with `EX` / del).

**Two keyings, on purpose.** A translation is keyed by *what was said*; the stored source text and
the post registry by *where it was said*. A string reposted in ten messages is one entry and one
backend call, while edit-follow and the re-translate menu still have a per-message handle.

| Key | Value | TTL |
| --- | --- | --- |
| `tr:{contentHash}:{source}:{target}` | JSON `{ text, backend, source_lang, created_at, confidence? }` | `CACHE_TTL_SECONDS` |
| `src:{sourceId}` | original text (for the re-translate menu, and to tell a real edit from an unfurl) | same |
| `post:{sourceId}` | JSON `[{ channelId, messageId, target, source }]` — every translation the bot posted about that message (`src/posts.ts`) | same, re-set on each post |

`contentHash` (`src/sourceId.ts`) is sha256 of the NFC-normalised text, hex-truncated to 32 chars,
taken **after** the `MAX_INPUT_CHARS` truncation — 128 bits, because a collision here serves one
person's translation to another for a whole TTL. `sourceIdForText` slices the same digest to 16 for
its `t_…` id, which is squeezed by the 100-char customId limit. `{source}` is the **requested**
source (`auto` or a forced code), never the detected one, so a correction and a detection never read
each other's entry. The backend name is deliberately **not** in the key: a hit is served whoever
wrote it, as it always was. `sourceId` (snowflake, or `t_…` for free text) is no longer part of it.

`translateWithCache()` (`src/translate.ts`) is cache-first; every cache call is wrapped so a Redis
outage logs and degrades to uncached — it never fails a reply. Corrupt entries read as misses.

A forced `source` **reads** its own key — the source is pinned, so the stored entry is exactly the
one asked for — and on a miss writes **both** `tr:{hash}:{forced}:{target}` and
`tr:{hash}:auto:{target}`: the user is correcting a wrong detection, and the correction should be
what everyone gets from then on. That was always the intent; only the mechanism changed.

A cache **hit** still writes `src:{sourceId}`. It used to fall out of the miss path, but a hit can
now belong to a different message, and without it this message would lose its re-translate menu and
its edit detection purely because someone else had said the same thing first. A backend failure
still stores nothing.

Keys written under the old `tr:{sourceId}:{target}` shape are unreachable and expire on their TTL.
There is no migration.

## Invalidation and edit-follow

`src/invalidation.ts` handles `messageUpdate` and `messageDelete`. `cache.invalidate(id)` is now just
`DEL src:{id}` — never with an empty list (the server rejects it; the fake throws to keep the guard
honest). **Translations need no sweep and cannot be swept:** they are content-keyed, so edited text
hashes to a different key and the old entry is never looked up again. It lingers, unreachable, until
its TTL, which is cheaper than keeping a message-to-hash index alive purely to delete from it.
`post:{id}` is likewise untouched: the registry has to survive the edit that triggers the refresh.
A delete drops it explicitly, via `posts.drop(id)`.

An edit then rewrites what is already in the channel, because a translation presented as a reading
of a message that now says something else is worse than none:

1. `shouldInvalidateOnUpdate()` — an edit that left the text alone (unfurl, pin) stops here. A
   partial `oldMessage` has no content to compare, so it counts as changed.
2. A partial `newMessage` is fetched; the new text is the whole point.
3. **The new text is compared against `src:{id}`.** Equal means nothing really changed, and nothing
   is touched. This is what keeps every unfurl on pre-boot history — which reaches step 2 with no
   old content to rule it out — from costing a backend call per post.
4. `cache.invalidate(id)` (the stored source only), then `posts.list(id)`. No posts, or no text left
   in the message, and the refresh ends; the posts already in the channel stay as they are, there
   being no text to put in them.
5. Per post: a guild-only rate-limit check, `translateWithCache()` for that post's own `target` and
   `source` (a forced source stays forced — and since every ref re-translates the same new text, two
   refs sharing a target collide in the content-keyed cache, a forced ref's auto-mirror feeding an
   auto ref its correction; that is the correction winning, as intended), and `ctx.messages.edit()` (`src/messages.ts`, the only
   Discord write outside a handler). `gone` — the post or channel is deleted, or access is lost —
   prunes it with `posts.forget()`. One post failing never costs the others theirs.
