# Discord interactions

## Entry points

| Surface | Module | Where the translation lands |
| --- | --- | --- |
| `/translate text: [target]` | `src/commands/translate.ts` | **public** `channel.send` (ephemeral reply only when there is no channel to post to) |
| "Translate Message" context menu | `src/commands/translateMessage.ts` | **public** reply to the target message |
| Reply + `@mention` (optional language hint) | `src/mentions.ts` (`MessageCreate`) | **public** reply |
| Flag reaction (🇫🇷 on any message) | `src/reactions.ts` (`MessageReactionAdd`) | **public** reply |
| Language select menus | `src/components/languageSelect.ts` | **public** `channel.send`, a new post per pick |
| `/tb-help` (supported languages and their codes) | `src/commands/help.ts` | ephemeral — not a translation |

Every translation goes out through `publishTranslation()` (`src/publish.ts`), which posts it and
records `{channelId, messageId, target, source}` under the source message's id so an edit can find
it again — see [translation.md](translation.md). An interaction still defers and answers
ephemerally, but that answer is the `reply.posted` acknowledgement or a refusal; the translation
itself is a real message, because an ephemeral one is visible to one person and cannot be edited
later. Free text (`/translate text:`) is recorded nowhere: a `t_<hex>` id has no message to follow.

`src/interactions.ts` is the single `InteractionCreate` listener: it routes by the type guards
(`isChatInputCommand`, `isMessageContextMenuCommand`, `isAutocomplete`, `isStringSelectMenu`) and
catches everything, wording `BackendError`s via `src/errors.ts` and logging the rest at error.
Add a new command by exporting its builder from `src/commands/`, appending it to
`commandDefinitions` in `src/commands/index.ts`, and adding a branch in `route()`.

## Rules every handler follows

- **Acknowledge within 3 seconds.** `deferReply({ flags: MessageFlags.Ephemeral })` is the first
  statement, on every interaction including a select. Autocomplete must `respond()` within 3 s too,
  so it reads only `ctx.languages.peek()` and never awaits the backend.
- **`flags: MessageFlags.Ephemeral`**, never `ephemeral: true` (deprecated in discord.js 14).
- **Handlers declare a structural interface** of what they read (`TranslateInteraction`,
  `LanguageSelectInteraction`, `MentionMessage`, ...). TypeScript proves the real discord.js object
  assignable at the router; tests pass fakes from `src/fixtures/interaction.fixture.ts` and
  `message.fixture.ts`.
- **Limits enforced in `src/reply.ts`**: embed description ≤ 4096 (truncated with `…`), ≤ 25 options
  per select menu, at most 2 menus per role (4 rows). Input text is capped at 4000 chars in
  `src/translate.ts`.
- **Every string goes through `ctx.i18n.forLocale(interaction.locale)`** (guild locale on the mention
  trigger); language names and hint parsing take `tr.language`. See [i18n.md](i18n.md).
- **Every trigger that can reach the backend checks `ctx.rateLimiter` first** — see below.

## Rate limiting

`src/rateLimit.ts` counts every request against a per-user-per-minute and a per-guild-per-hour
budget (`RATE_LIMIT_USER_PER_MIN`, `RATE_LIMIT_GUILD_PER_HOUR`), as fixed-window `INCR`+`EXPIRE`
keys `rl:u:<userId>:<window>` and `rl:g:<guildId>:<window>`. Budgets, not a cooldown between
requests: the bot exists for fast-moving threads where one person translates several messages in a
row, and a fixed delay would punish exactly that. Cache hits count too — a request costs a Discord
API call whether or not it reaches the backend.

Six surfaces check it: `/translate`, the context menu, the mention trigger, the flag reaction,
**the select menus** — a menu pick re-translates and posts, and the menus are clickable by anyone in
the channel, which makes them the cheapest surface to hammer — and **the edit refresh**
(`src/invalidation.ts`), which checks once per post it is about to rewrite with `userId: null`: the
work costs the backend, so the guild budget sees it, but nobody requested it, so no one person is
charged. A refusal there stops the whole refresh and leaves the posts stale.

**Where the check goes, and what a refusal looks like, differ by surface:**

- *Interactions* (`/translate`, context menu, select) check **after the defer** so the 3 s
  acknowledgement still lands, and **before `ctx.languages.get()`**, which is itself a backend call
  on a cold start. A refusal is an ephemeral `buildNoticeReply` via `rateLimitMessageFor()`.
- *The public triggers* (mention, flag reaction) are **silent** when over budget — logged, never
  answered. A public "slow down" for every refused request doubles the flood it is meant to stop.
  The flag trigger checks before its partial fetches, which a partial message's `guildId` allows.

Two properties are load-bearing and have tests:

- **It fails open.** A Redis outage must cost backend calls, never the bot's ability to answer;
  failing closed would turn a cache outage into a total outage and hand anyone who can disrupt
  Redis a way to silence the bot.
- **It has its own 1 s deadline** (`CHECK_TIMEOUT_MS`). node-redis queues commands against a dead
  server and rejects only on its own 5 s default — measured by killing Redis under a connected
  client — which would add five seconds to every request during an outage, to reach a decision that
  is already going to be "allow".

A refused request does **not** spend the guild budget: the guild counter is only reached once the
user is inside their own, so one spammer cannot burn everyone else's hour while being refused anyway.

## Mention trigger

Fires only when the message is not from a bot, `mentions.has(botId, { ignoreEveryone,
ignoreRoles, ignoreRepliedUser })` is true (a reply to a bot message auto-mentions it and must
not trigger), and `message.reference` is set; otherwise it replies with a one-line hint. Languages:
`parseLanguageSpec()` on the tagging text with mentions stripped reads `source:target`, `source:`,
`:target`, or a bare target; the target falls back to `guild.preferredLocale` → `en` (messages carry
no user locale). Free chat around the mention is tolerated; only the colon form rejects an unknown
name. Replies use `allowedMentions: { repliedUser: false }`.

`/translate` mirrors this: `target` accepts the colon form too, and a separate `source` option
(autocompleted) forces the source. A forced source bypasses the cache read and overwrites the entry
(`src/translate.ts`), so it corrects a wrong detection for everyone.

## Flag reactions

`src/flags.ts` maps a region onto a code `LANGUAGES` already lists — 🇫🇷 and 🏴󠁧󠁢󠁥󠁮󠁧󠁿 decode to `FR` and
`GBENG` from their regional indicators / tag sequence — and resolves it through
`resolveLanguageCode()`, so a flag inherits the menus' preferred-first fallback and an install that
never loaded the language resolves to null exactly like an unmapped country. Sub-regions collapse:
every English-speaking flag is `en`, never `en-GB`. Anything that is not a region flag (👍, 🏴‍☠️, a
custom emoji) is ignored in silence — the trigger must not answer every reaction in the guild.

A flag with no language gets `buildLanguagePickerReply()`: the notice plus the ordinary target menus
(`lang:t:0:auto:<messageId>`), so the pick runs through the select handler and the text comes back
from `channel.messages.fetch`. Duplicates are judged **by language, not emoji** — `alreadyAsked()`
sums the counts of every flag on the message resolving to the same code (all unservable flags share
one bucket), and the handled reaction is itself in `message.reactions.cache`, so two means someone
already asked. Reactions on the bot's own posts are skipped (their text lives in an embed);
reaction *removal* does nothing.

## Menus and the customId scheme

A pick posts a **new** public translation rather than rewriting the one it was clicked on: that post
is a translation someone else asked for, and it keeps following its own source message. The clicker
gets the ephemeral `reply.posted` acknowledgement.

Every translation reply carries up to four select rows: two **source** menus (Auto-detect first,
then the languages, preselecting what was detected or forced) and two **target** menus (preselecting
the current target). Two per role because the Discord-locale list (~29) exceeds the 25-option cap;
Discord allows five rows per message, so there is room for exactly this.

customIds are `lang:<s|t>:<menuIndex>:<other>:<sourceId>` (`src/components/customId.ts`), ≤ 100
chars. `other` is the counterpart's current value (a code or `auto`) so a source pick keeps the
target and a target pick keeps a forced source. `sourceId` is the message snowflake or `t_<16 hex>`
for `/translate text:` (`src/sourceId.ts`). The select handler recovers the text from
`src:{sourceId}` in Redis, then by `channel.messages.fetch(id)` for snowflakes, else reports
expiry. Never put text in a customId.

## Intents and partials

`Guilds`, `GuildMessages`, `MessageContent` (privileged — enable in the developer portal),
`GuildMessageReactions` (not privileged) and `Partials.Message`, `Partials.Reaction`,
`Partials.User`, without which edits, deletes and reactions on messages sent before boot never
arrive — a flag on older history does nothing, and an edit to it reaches neither the cache nor the
posts that quote it. Either side of `messageUpdate` may be partial (`content: null`): the invalidator
fetches a partial `newMessage` before reading the new text, and `handleFlagReaction` fetches a
partial reaction and its partial message before reading theirs.
