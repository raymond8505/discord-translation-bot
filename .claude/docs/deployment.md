# Deployment

## One compose file, two environments

`docker-compose.yml` is the only compose file and runs unchanged locally and on the VPS. Every
difference is an `.env` value; there is no `docker-compose.override.yml` and none should be added
(it would auto-merge into the production `compose up`).

- `LT_LOAD_ONLY` is a **key-only** entry on the libretranslate service (`LT_LOAD_ONLY:`, no value).
  Compose renders that as null and omits the variable, while still taking a value from `.env`. Both
  environments set one: the deploy heredoc writes `en,es,fr,de,nl,pt,pb` (Argos codes, `pb` =
  `pt-BR`) — the same set as the committed files in `src/i18n/messages` — and `.env.example`
  carries the same list. Loading all ~100 models costs ~10 GB of disk and far more RAM than the bot
  serves languages for. Never give the compose entry a `${LT_LOAD_ONLY:-}` default: that renders a
  blank string, LibreTranslate reads a blank as "load these zero languages", and `create_app` dies
  on `languages[0]` of an empty list — a gunicorn crash loop that `docker compose ps` reports as
  `health: starting` for the full 30-minute `start_period`, so diagnose it with `logs`, not `ps`.
  `scripts/validate-compose-env.sh` fails the build if any container env var renders set-but-empty.
- No service publishes a port. Redis and LibreTranslate are reachable only on the project network.
  For host-side inspection use `docker compose exec` (e.g. `redis-cli`) or run a one-off container
  on `discord-translation-bot_default`.
- `develop.watch` on the bot service is inert unless `docker compose watch` is run.

## Image pins

Neither third-party image floats. `libretranslate/libretranslate` is pinned to an exact version
because every deploy runs `compose up --build`, so `latest` let an unreviewed upstream release pull
itself onto the VPS — into the one container that sees the plaintext of every translated message.
`redis` is pinned to the **minor** (`7.4-alpine`), which still takes patch releases and therefore
security fixes, but never jumps a major behind an unattended deploy. Bump either deliberately.

## Container confinement

All three services run with `no-new-privileges` and `cap_drop: [ALL]`, and all three carry
`mem_limit`/`pids_limit` — the VPS is shared with another project, so a leak or a runaway loop in
one container must not take the host down with it.

Three details are load-bearing and will break the stack if changed carelessly:

- **The bot's `read_only: true` requires its `tmpfs: [/tmp]`.** `src/health.ts` touches
  `/tmp/discord-translation-bot.healthy` every 30 s and the HEALTHCHECK reads that mtime, so a
  read-only root without the tmpfs reports the container unhealthy for as long as it runs.
- **Redis runs as `user: "999:1000"`.** The image's entrypoint otherwise starts as root and
  `gosu`es down, chowning `/data` on the way — which needs `CAP_CHOWN` and `CAP_DAC_OVERRIDE`.
  Under `cap_drop: ALL` that entrypoint fails with `find: ./appendonlydir: Permission denied` and
  the container never goes healthy; root without those caps is subject to ordinary permission
  checks like anyone else. 999:1000 is the uid:gid that already owns the volume, so starting as it
  needs no capabilities at all.
- **Redis's `--maxmemory 384mb` must stay below its `mem_limit`.** Without it a full cache gets the
  container OOM-killed by the kernel; with it, `allkeys-lru` evicts the least-recently-used
  translations and redis keeps serving. Eviction is the right failure mode here — every key in this
  cache is reconstructible from the backend.

LibreTranslate is deliberately **not** `read_only`: unlike the bot it writes throughout its own
filesystem (venv caches, Argos staging), and confining it would mean a tmpfs per path.

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

Each required secret is asserted with `: "${VAR:?...}"` before anything is written. A missing
repository secret arrives as an **empty string**, not as an unset variable, so without the guard it
lands in `.env` as `DISCORD_TOKEN=` and the failure surfaces a job later as a zod error in a
crash-looping container. `:?` treats empty as unset, which is exactly the needed behaviour.

Both secret-bearing writes — the deploy key and `.env` — happen inside `( umask 077; ... )`, then
get a `chmod 600`. Both halves are load-bearing and neither replaces the other: the umask closes
the window between creation and chmod, and the chmod re-modes an `.env` left at `644` by an earlier
deploy, which a umask cannot do to an existing file. Verified on Alpine: default write is `644`,
the hardened write is `600`.

## Public-repo CI posture

The repo is public, so `pull_request` runs fork code on GitHub's runners:

- A top-level `permissions: contents: read` keeps the `GITHUB_TOKEN` that code runs beside
  read-only. Without the block it inherits the *repository* default, which is often read/write.
  Nothing in this workflow writes to the repo, so nothing needs more.
- `appleboy/ssh-action` is **pinned by commit SHA** with the version in a trailing comment, because
  it is handed every deploy secret and a tag can be repointed at new code. Bump it by resolving the
  new tag to a SHA (`gh api repos/appleboy/ssh-action/git/ref/tags/vX.Y.Z`), not by editing the
  comment. First-party `actions/*` stay on major tags.
- The `deploy` job's `if:` carries a `github.repository_owner` guard so a fork's push to its own
  `main` does not queue a deploy that can only fail, and `REPO` is derived from
  `github.repository` so a fork clones itself rather than this repo.
- `concurrency: { group: deploy-vps, cancel-in-progress: false }` queues deploys instead of racing
  two `git reset --hard`/`compose up` runs in one directory. Never set `cancel-in-progress: true`
  here: a cancelled deploy can leave the checkout and the running containers at different commits.

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
