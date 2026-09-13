# Discord Translation Bot

Self-hosted, on-demand translation for a small Discord community. Three
containers on one VPS: the bot (Node 24, discord.js 14), Redis (cache), and
LibreTranslate (Argos models, entirely local, no third-party API).

## What it does

| Trigger | How | Reply |
| --- | --- | --- |
| Reply to a message and `@mention` the bot | `@bot`, `@bot french`, `@bot fr:en` | Public reply with the translation and two language menus |
| Right-click a message → Apps → **Translate Message** | context menu | Ephemeral (only you see it) |
| `/translate text:<text> [target] [source]` | slash command, both language options autocomplete | Ephemeral |

- Target language defaults to your Discord client language (slash / context
  menu) or the server's preferred locale (mention trigger).
- Source language is auto-detected and the reply shows the detection
  confidence. Below 50% the reply says so and how to force it: `@bot fr:en`
  (source:target), `@bot fr:` (source only), or `/translate` with `source:`.
  A forced source also replaces the cached translation for everyone.
- Every reply carries **two select menus** to re-translate into another
  language. On a public reply the menu answers you privately; on an
  ephemeral reply it edits in place.
- Any supported language to any other (Argos pivots through English
  internally). The language menus and autocomplete follow what LibreTranslate
  reports, re-checked every 5 minutes.
- Translations are cached in Redis for 30 days per message and target; an
  edit or delete of the source message drops its cache entries.

## Architecture

```
Discord ⇄ bot ──► redis          (cache, appendonly, internal only)
             └──► libretranslate (port 5000, internal only, models in a volume)
```

No service publishes a port. The bot needs outbound HTTPS to Discord only.
The translation backend sits behind `src/backends/types.ts`'s
`TranslationBackend` interface; LibreTranslate is the phase-1 implementation
and `src/backends/ollama.ts` is a stub for a later LLM backend.

## Discord app setup (once per environment)

Use **two apps**: one for production, one for local development. Two gateway
sessions on the same token would both answer every trigger.

1. [discord.com/developers](https://discord.com/developers/applications) →
   New Application → **Bot** → enable **Message Content Intent** (privileged;
   login fails without it) → Reset Token, copy it.
2. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`;
   permissions **Send Messages** and **Read Message History**. Open the URL
   and invite the bot to your server (the dev app goes in a dev server).
3. Copy the **Application ID** (`DISCORD_CLIENT_ID`) and, in Discord with
   Developer Mode on, right-click the server → Copy Server ID (`GUILD_ID`).

Commands are registered guild-scoped on every boot (instant, no global
propagation delay). `yarn deploy-commands` registers them without starting
the bot, useful for checking a token/guild pairing.

## Local development

Requirements: Node 24.16.0 (`corepack enable`), Docker Desktop.

```bash
yarn install          # installs deps and the git hooks
cp .env.example .env  # fill in the dev app's token, client id, guild id
yarn docker:up        # docker compose up --build -d — same file the VPS runs
yarn docker:logs      # follow the bot's log
```

`.env.example` sets `LT_LOAD_ONLY=en,es,fr,de` so LibreTranslate downloads
only those models (a few hundred MB). Change the list to what you need to
test; leave it **unset** on the VPS for the full set.

Compose shortcuts (all in `package.json`):

| Script | Runs |
| --- | --- |
| `yarn docker:up` | `docker compose up --build -d` |
| `yarn docker:down` | `docker compose down` (keeps the model and Redis volumes) |
| `yarn docker:restart` | rebuild and recreate only the bot container |
| `yarn docker:restart:lt` | recreate libretranslate (picks up a changed `LT_LOAD_ONLY`; new models download on boot) |
| `yarn docker:watch` | rebuild the bot image on changes under `src/` |
| `yarn docker:logs` / `docker:logs:all` | follow the bot's log / every service |
| `yarn docker:ps` | container status and health |
| `yarn docker:cache` | list cached translation keys in Redis |
| `yarn docker:languages` | the language codes LibreTranslate currently reports |

Other loops:

- `yarn test`, `yarn typecheck`, `yarn lint` — the pre-commit hook runs
  typecheck + lint-staged, the pre-push hook runs the tests.
- `yarn dev` runs the bot on the host with `tsx watch`; it needs reachable
  `REDIS_URL` / `LT_URL`, which the compose stack deliberately does not
  expose, so the container loop above is the supported path.

## Deploy (VPS)

`.github/workflows/deploy.yml` runs on every PR and push to `main`:

1. **test** — `yarn typecheck`, `yarn lint`, `yarn test:run`
2. **build** — `scripts/validate-deploy-env.sh`, `docker build .`,
   `docker compose config`
3. **deploy** (push to `main` only) — ssh to the VPS, clone or
   `git reset --hard origin/main` at `VPS_DEPLOY_PATH`, write `.env` from
   secrets, `docker compose up -d --build --remove-orphans`, wait for the
   bot container to report **healthy**, `docker image prune -f`.

GitHub secrets: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID`,
`GH_DEPLOY_KEY` (read-only deploy key for this repo), `VPS_HOST`,
`VPS_USER`, `VPS_SSH_KEY`, `VPS_DEPLOY_PATH`.

**First deploy:** LibreTranslate downloads ~10 GB of models into the
`lt-models` volume. The deploy does not wait for it; the bot comes up and
answers "still starting up" until the models are loaded (watch
`docker compose logs -f libretranslate`; the container turns healthy when
done). VPS sizing: 16 GB RAM / 160 GB disk comfortably covers the full set.

The bot has no HTTP port. Its Docker health check reads the mtime of a
heartbeat file the process touches every 30 s while its gateway session is
up; `docker compose ps` shows the status.

## Swapping the translation backend

1. Implement `TranslationBackend` (`src/backends/types.ts`): `translate()`
   returns the text and the detected source code; `languages()` returns the
   backend's language codes (these populate the menus after intersecting
   with `src/locale.ts`).
2. Add a case to `createBackend()` in `src/backends/index.ts` and the value
   to the `BACKEND` enum in `src/env.ts`.
3. Set `BACKEND=<name>` in `.env` (locally) and in the `.env` heredoc of
   `deploy.yml` (production).

Cache entries record the backend that produced them, so old hits remain
identifiable after a swap; drop them with `redis-cli --scan --pattern 'tr:*'`
piped to `DEL` if the new backend should retranslate everything.

## Adjusting the cache TTL

`CACHE_TTL_SECONDS` (default `2592000`, 30 days) applies to new writes. Set
it in `.env` locally, or edit the literal in the `.env` heredoc of
`deploy.yml` for production. It is validated as a positive integer at boot.

## Troubleshooting

- **Bot container restarting** — `docker compose logs bot`. The first lines
  after "fatal startup error" name the misconfigured variable, or
  `TokenInvalid` / "Used disallowed intents" from Discord.
- **"still starting up" replies** — LibreTranslate is downloading or loading
  models; `docker compose ps` shows it `starting` until healthy.
- **A language is missing from the menus** — the backend does not report
  it; check with `yarn docker:languages`.
- **No response to @mention** — the tagging message must be a *reply*, and
  the Message Content intent must be enabled in the developer portal.
