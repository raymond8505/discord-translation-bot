# Deployment

## One compose file, two environments

`docker-compose.yml` is the only compose file and runs unchanged locally and on the VPS. Every
difference is an `.env` value; there is no `docker-compose.override.yml` and none should be added
(it would auto-merge into the production `compose up`).

- `LT_LOAD_ONLY` is a **key-only** entry on the libretranslate service (`LT_LOAD_ONLY:`, no value).
  Compose renders that as null and omits the variable, while still taking a value from `.env` when
  one is set. Set it locally to limit the model download; on the VPS the deploy heredoc does not
  write it, so it is absent and all languages load. Never give it a `${LT_LOAD_ONLY:-}` default:
  that renders a blank string, LibreTranslate reads a blank as "load these zero languages", and
  `create_app` dies on `languages[0]` of an empty list — a gunicorn crash loop that `docker compose
  ps` reports as `health: starting` for the full 30-minute `start_period`, so diagnose it with
  `logs`, not `ps`. `scripts/validate-compose-env.sh` fails the build if any container env var
  renders set-but-empty.
- No service publishes a port. Redis and LibreTranslate are reachable only on the project network.
  For host-side inspection use `docker compose exec` (e.g. `redis-cli`) or run a one-off container
  on `discord-translation-bot_default`.
- `develop.watch` on the bot service is inert unless `docker compose watch` is run.

## Adding an env var

1. Add it to the zod schema **and** to `runtimeEnv()` in `src/env.ts` as a literal `process.env.X`.
2. Add it to `.env.example` with a placeholder.
3. In `.github/workflows/deploy.yml`: if it is a secret, add it to the ssh step's `env:` block, the
   `envs:` list, and the `.env` heredoc; if it is a literal, add just the heredoc line.
4. `bash scripts/validate-deploy-env.sh` must pass — it greps `process.env.X` in `src/` (excluding
   tests and fixtures) and checks the three workflow locations. Never write `process.env.X` in a
   comment; the grep will match it.
5. `bash scripts/validate-compose-env.sh` must pass — it renders the compose file against the .env
   the heredoc writes and rejects any container env var that comes out set-but-empty. A var a
   service is meant to do without belongs in `environment:` as a key-only entry, not as
   `${VAR:-}`.

`env_file: .env` forwards every var to the bot, so `docker-compose.yml` needs no change.

## Deploy workflow

`test` (typecheck, lint, tests) → `build` (validator, `docker build`, `docker compose config` with
`.env.example` copied to `.env`) → `deploy` on pushes to `main` and on manual `workflow_dispatch`
runs from `main`, never on pull requests. The branch guard in the `if:` is what keeps a dispatch
from another branch from reporting a deploy: the ssh script resets the VPS to `origin/main`
regardless of the dispatching ref. The deploy step is
`appleboy/ssh-action` with a **10-minute command timeout**: clone-or-reset at `VPS_DEPLOY_PATH`,
write `.env`, `docker compose up -d --build --remove-orphans`, poll
`docker inspect --format '{{.State.Health.Status}}' discord-translation-bot` for `healthy` (24 × 5 s),
`docker image prune -f`. Never add an `rm -rf` of the deploy path: `.env` and the volumes live there.

Secrets: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID`, `GH_DEPLOY_KEY`, `VPS_HOST`,
`VPS_USER`, `VPS_SSH_KEY`, `VPS_DEPLOY_PATH`. Service URLs, `BACKEND` and `CACHE_TTL_SECONDS` are
literals in the heredoc; change production config by editing them there.

Two of those are OpenSSH **private** keys, and they authenticate opposite directions:
`VPS_SSH_KEY` is how `appleboy/ssh-action` logs into the VPS (its public half is in the VPS user's
`authorized_keys`), `GH_DEPLOY_KEY` is how the VPS clones this repo (its public half is a
write-disabled repo deploy key). GitHub strips the trailing newline from a multiline secret, so the
`printf '%s\n'` that writes `GH_DEPLOY_KEY` to `~/.ssh/github_discord_translation_bot` is load-bearing —
`printf '%s'` yields `error in libcrypto`. Generating and installing both keys: README → "Repository
secrets".

## LibreTranslate first start

The first `up` on the VPS downloads ~10 GB of Argos models into the `lt-models` volume, which can
take longer than the deploy timeout. Therefore:

- the bot's `depends_on.libretranslate` is `service_started`, not `service_healthy`;
- the bot memoizes `languages()` lazily and retries on every call (`src/languages.ts`), replying
  "still starting up" meanwhile;
- the libretranslate healthcheck has `start_period: 30m` so `docker compose ps` shows `starting`
  rather than `unhealthy` during the download;
- the deploy health loop waits only on the bot container.

`LT_UPDATE_MODELS=true` re-checks models on every libretranslate restart (fast once current).

## Image and health

Dockerfile stages: `deps` (full install) → `build` (`yarn build` → `dist/`; needs `yarn.lock` and
`.yarnrc.yml` present or Yarn re-resolves) → `prod-deps` (`yarn workspaces focus --production`) →
`runner` (`package.json` + `node_modules` + `dist`, `USER node`). The `postinstall` runs
`.husky/install.mjs`, which exits early under `NODE_ENV=production`, `CI=true` or `HUSKY=0`,
because the prod-deps stage has no husky package and no `.git`.

The bot has no HTTP port. `src/health.ts` touches `/tmp/discord-translation-bot.healthy` every 30 s
while `client.isReady()`; the HEALTHCHECK fails when the file is missing or older than 90 s. Docker
does not restart on unhealthy — fatal errors must exit the process so `restart: unless-stopped`
acts, which is why `loadEnv()` and `login()` failures call `process.exit(1)`.
