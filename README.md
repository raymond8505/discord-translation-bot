# Discord Translation Bot

Self-hosted, on-demand translation for a small Discord community. Three
containers on one VPS: the bot (Node 24, discord.js 14), Redis (cache), and
LibreTranslate (Argos models, entirely local, no third-party API).

## What it does

| Trigger | How | Reply |
| --- | --- | --- |
| Reply to a message and `@mention` the bot | `@bot`, `@bot french`, `@bot fr:en` | Public reply with the translation and source/target menus |
| Right-click a message → Apps → **Translate Message** | context menu | Ephemeral (only you see it) |
| `/translate text:<text> [target] [source]` | slash command, both language options autocomplete | Ephemeral |
| `/tb-help` | lists every supported language with the code `target:` and `@bot <code>` accept | Ephemeral |

- Target language defaults to your Discord client language (slash / context
  menu) or the server's preferred locale (mention trigger).
- Source language is auto-detected and the reply shows the detection
  confidence. Below 50% the reply says so and how to force it: `@bot fr:en`
  (source:target), `@bot fr:` (source only), or `/translate` with `source:`.
  A forced source also replaces the cached translation for everyone.
- Every reply carries **source and target menus** (two rows each): the
  source menus show what was detected and let you correct it (or go back to
  Auto-detect); the target menus re-translate into another language. On a
  public reply a menu answers you privately; on an ephemeral reply it edits
  in place.
- Any supported language to any other (Argos pivots through English
  internally). The language menus and autocomplete follow what LibreTranslate
  reports, re-checked every 5 minutes.
- Translations are cached in Redis for 30 days per message and target; an
  edit or delete of the source message drops its cache entries.
- The bot's own replies, menus and command descriptions follow your Discord
  client language (the server's preferred locale on the mention trigger),
  with language names from ICU. See [Localization](#localization).

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
| `yarn locales:generate` | fill the bot's message files for every language LibreTranslate serves (see [Localization](#localization)) |

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

### Repository secrets

The `deploy` job needs all eight before it can run. Set them at **Settings →
Secrets and variables → Actions → New repository secret**; the names must
match exactly. The `test` and `build` jobs need none of them, so a run that
goes green twice and then fails on "Deploy to VPS" is the signature of a
secret that is missing or wrong.

| Secret | Value |
| --- | --- |
| `DISCORD_TOKEN` | Developer Portal → your **production** app → Bot → Reset Token. Shown once; a reset invalidates the running bot's session. |
| `DISCORD_CLIENT_ID` | Same app → General Information → Application ID. |
| `GUILD_ID` | In Discord with Developer Mode on, right-click the server → Copy Server ID. |
| `VPS_HOST` | Hostname or IP you SSH to. |
| `VPS_USER` | SSH user on that host. |
| `VPS_DEPLOY_PATH` | Absolute path to check the repo out at, e.g. `/opt/discord-translation-bot`. Created on first deploy; `.env` and the Docker volumes live there, so never delete it. |
| `VPS_SSH_KEY` | **Private** half of a key the Action uses to log into the VPS (below). |
| `GH_DEPLOY_KEY` | **Private** half of a key the VPS uses to clone this repo (below). |

Both key secrets hold a whole private key file. `-N ""` generates them without a
passphrase, which is required — the Action cannot type one.

Run everything below **on the VPS**, in the shell you get from:

```bash
ssh <your-own-user>@<VPS_HOST>
```

Your own login, with whatever key you already use. Generating both keypairs
there keeps the commands in a plain bash shell and means no public key ever has
to be moved between machines.

#### Key 1 of 2 — GitHub Actions → VPS (`VPS_SSH_KEY`)

```bash
ssh-keygen -t ed25519 -C "github-actions-dtb" -f ~/.ssh/dtb_vps -N ""
```

That one command writes **two** files:

| File | Which half | Goes to |
| --- | --- | --- |
| `~/.ssh/dtb_vps` | private (no extension) | the `VPS_SSH_KEY` secret |
| `~/.ssh/dtb_vps.pub` | public | this VPS's `~/.ssh/authorized_keys` |

Install the public half on this same machine — appending it to `authorized_keys`
is what lets the Action log in:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat ~/.ssh/dtb_vps.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Now print the private half:

```bash
cat ~/.ssh/dtb_vps
```

Select and copy **everything** it prints — the first line
`-----BEGIN OPENSSH PRIVATE KEY-----`, every line between, and the last line
`-----END OPENSSH PRIVATE KEY-----`. Then, on GitHub: **Settings → Secrets and
variables → Actions → New repository secret**, *Name* `VPS_SSH_KEY`, *Secret* =
the block you just copied. **Add secret**.

#### Key 2 of 2 — VPS → GitHub (`GH_DEPLOY_KEY`)

Still on the VPS:

```bash
ssh-keygen -t ed25519 -C "dtb-vps-deploy" -f ~/.ssh/dtb_repo -N ""
```

Again two files, and this time the halves go to two *different* places on
GitHub:

| File | Which half | Goes to |
| --- | --- | --- |
| `~/.ssh/dtb_repo` | private (no extension) | the `GH_DEPLOY_KEY` secret |
| `~/.ssh/dtb_repo.pub` | public | this repo's **Deploy keys** |

Print the public half:

```bash
cat ~/.ssh/dtb_repo.pub
```

It prints one line, shaped `ssh-ed25519 AAAAC3Nza… dtb-vps-deploy`. Copy that
whole line. On GitHub: **Settings → Deploy keys → Add deploy key**, *Title*
`dtb-vps`, *Key* = that line, and **leave "Allow write access" unchecked** — the
VPS only ever reads. **Add key**.

Print the private half:

```bash
cat ~/.ssh/dtb_repo
```

Copy from `-----BEGIN OPENSSH PRIVATE KEY-----` through
`-----END OPENSSH PRIVATE KEY-----` inclusive, and paste it into **Settings →
Secrets and variables → Actions → New repository secret**, *Name*
`GH_DEPLOY_KEY`. (GitHub strips the trailing newline from every multiline
secret; the workflow writes it back with `printf '%s\n'`, so you do not need to
do anything about it.)

#### Check the deploy key, then clean up

From the VPS, with the public half registered above (answer `yes` to the
host-key prompt):

```bash
ssh -i ~/.ssh/dtb_repo -o IdentitiesOnly=yes -T git@github.com
```

A working deploy key answers:

```
Hi raymond8505/discord-translation-bot! You've successfully authenticated, but GitHub does not provide shell access.
```

`Permission denied (publickey)` instead means `dtb_repo.pub` did not land in
Deploy keys. `VPS_SSH_KEY` has no equivalent self-test — the deploy run is what
proves it (see the empty-commit trigger below).

Wait for a green deploy, then delete both private keys from the VPS. Nothing on
the machine reads either file: GitHub holds both, and the workflow writes
`GH_DEPLOY_KEY` to `~/.ssh/github_discord_translation_bot` itself on every run.

```bash
rm ~/.ssh/dtb_vps ~/.ssh/dtb_repo   # keep both .pub files
```

The workflow clones over SSH (`git@github.com:…`), which is why the deploy key
is needed even while the repo is public.

Prerequisites on the VPS: Docker with the Compose plugin, and the `VPS_USER`
able to run `docker` without `sudo`.

Only a push to `main` deploys. `workflow_dispatch` runs `test` and `build`
but skips `deploy` (`if: github.event_name == 'push'`), so it cannot be used
to check the secrets — push an empty commit instead:

```bash
git commit --allow-empty -m "chore: trigger deploy" && git push
```

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

## Localization

`src/i18n/messages/en.json` holds every message the bot sends; the other
`<code>.json` files next to it are produced by LibreTranslate and committed.

```bash
yarn locales:generate              # fill missing keys/files for every language the stack serves
yarn locales:generate --force      # retranslate everything
yarn locales:generate --only fr,de # just these codes
yarn locales:generate --check      # no docker: list files missing keys, exit 1 if any
```

The script talks to LibreTranslate through the running bot container, so
`yarn docker:up` first. With `LT_LOAD_ONLY` set locally only those languages
are generated; the full set needs every model loaded (unset it, or run on the
VPS). Placeholders like `{name}` and code spans are shielded from the
translator; a string the model still mangled is kept in English and named in
the summary so you can edit the file by hand. Hand edits survive later runs,
which only fill keys that are missing. Language *names* are not in these
files: they come from Node's ICU data in the reader's language.

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
  it; check with `yarn docker:languages`. Locally that usually means it is
  not in `LT_LOAD_ONLY`; Argos has no Croatian model at all. Valid codes are
  the `from_code`/`to_code` values in the
  [Argos model index](https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json).
  Note the spelling difference: load `pb`, `zh`, `zt` and LibreTranslate
  reports them as `pt-BR`, `zh-Hans`, `zh-Hant`.
- **No response to @mention** — the tagging message must be a *reply*, and
  the Message Content intent must be enabled in the developer portal.
