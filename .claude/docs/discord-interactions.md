# Discord interactions

## Entry points

| Surface | Module | Visibility |
| --- | --- | --- |
| `/translate text: [target]` | `src/commands/translate.ts` | ephemeral |
| "Translate Message" context menu | `src/commands/translateMessage.ts` | ephemeral |
| `/tb-help` (supported languages and their codes) | `src/commands/help.ts` | ephemeral |
| Reply + `@mention` (optional language hint) | `src/mentions.ts` (`MessageCreate`) | **public** |
| Flag reaction (🇫🇷 on any message) | `src/reactions.ts` (`MessageReactionAdd`) | **public** |
| Language select menus | `src/components/languageSelect.ts` | ephemeral (new message on a public reply; edit in place on an ephemeral one) |

`src/interactions.ts` is the single `InteractionCreate` listener: it routes by the type guards
(`isChatInputCommand`, `isMessageContextMenuCommand`, `isAutocomplete`, `isStringSelectMenu`) and
catches everything, wording `BackendError`s via `src/errors.ts` and logging the rest at error.
Add a new command by exporting its builder from `src/commands/`, appending it to
`commandDefinitions` in `src/commands/index.ts`, and adding a branch in `route()`.

## Rules every handler follows

- **Acknowledge within 3 seconds.** `deferReply({ flags: MessageFlags.Ephemeral })` (or
  `deferUpdate()` on an ephemeral message's component) is the first statement. Autocomplete must
  `respond()` within 3 s too, so it reads only `ctx.languages.peek()` and never awaits the backend.
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
arrive — cache invalidation misses them and a flag on older history does nothing. `oldMessage` in
`messageUpdate` may be partial (`content: null`); a partial reaction and its partial message are
fetched in `handleFlagReaction` before the text is read.
