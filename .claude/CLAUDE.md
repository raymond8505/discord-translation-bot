# Discord Translation Bot — Project Instructions

This file is an **index**: repo-wide conventions that constrain any file you might open, then
triggers pointing at the doc for each subsystem. Detail lives in `.claude/docs/` — read the doc when
its trigger fires, not before. The original spec is `.claude/handoffs/discord-translation-bot-handoff.md`.

## Repo-wide conventions

**ESM with NodeNext**: relative imports carry a `.js` suffix even from `.ts` files; use
`import.meta.dirname`, never `__dirname`.

**All configuration goes through `src/env.ts`**: one zod schema, and each variable named as a literal
`process.env` property in `runtimeEnv()` so `scripts/validate-deploy-env.sh` can prove the deploy
workflow writes it. No `process.env` reads anywhere else in `src/`.

**Handlers take structural slices, not discord.js classes**: each handler declares the interface it
needs (`TranslateInteraction`, `MentionMessage`, ...); the router narrows real objects with the type
guards. Tests drive handlers through `src/fixtures/*.fixture.ts` fakes — never inline shaped objects
in a test file.

**Fixtures are runner-free**: nothing under `src/fixtures/` imports vitest; they record calls in
arrays. `tsconfig.build.json` excludes them from the image.

**Every Discord interaction defers within 3 s and replies with `flags: MessageFlags.Ephemeral`**
(the `ephemeral: true` option is deprecated). Public replies exist only on the mention trigger.

**Redis: `SCAN`, never `KEYS`; guard empty `DEL`s** — the fake in `redis.fixture.ts` enforces both.

**No user-facing string literals in `src/`**: every reply, embed, placeholder and command description
is a key in `src/i18n/messages/en.json` rendered through a `Translator` (`ctx.i18n.forLocale(...)`).

## Read the doc when the trigger fires

- **Touching `deploy.yml`, `docker-compose.yml`, the `Dockerfile`, or adding an env var** → [docs/deployment.md](docs/deployment.md)
- **Adding or changing a command, the mention or flag-reaction trigger, a select menu, or a customId** → [docs/discord-interactions.md](docs/discord-interactions.md)
- **Working on a backend, `src/locale.ts`, `src/flags.ts`, the cache keys, or invalidation** → [docs/translation.md](docs/translation.md)
- **Adding or rewording a message, touching `src/i18n/`, or running `yarn locales:generate`** → [docs/i18n.md](docs/i18n.md)
- **Writing or changing a test or fixture** → [docs/testing.md](docs/testing.md)
