# Discord Translation Bot

Self-hosted, on-demand translation for a small Discord community. Three
containers on one VPS: the bot (Node 24, discord.js 14), Redis (cache), and
LibreTranslate (Argos models, entirely local, no third-party API).

## What it does

| Trigger | How | Reply |
| --- | --- | --- |
| React to a message with a country flag | 🇫🇷 🇩🇪 🇯🇵 … | Public reply with the translation and source/target menus |
| Reply to a message and `@mention` the bot | `@bot`, `@bot french`, `@bot fr:en` | Public reply with the translation and source/target menus |
| Right-click a message → Apps → **Translate Message** | context menu | Public reply to that message; only you see the "posted it" note |
| `/translate text:<text> [target] [source]` | slash command, both language options autocomplete | Public post in the channel; only you see the "posted it" note |
| `/tb-help` | lists every supported language with the code `target:` and `@bot <code>` accept | Ephemeral |

- Target language defaults to your Discord client language (slash / context
  menu) or the server's preferred locale (mention and flag triggers).
- Flags that share a language are one request: 🇬🇧 🇺🇸 🇨🇦 🇦🇺 and 🏴󠁧󠁢󠁥󠁮󠁧󠁿 all ask
  for English, and only the first flag for a language posts a translation.
  A flag for a language this install doesn't serve — or a country with no
  language in the table — gets a reply saying so, with the target menus to
  pick by hand. Reactions that aren't flags are ignored.
- Source language is auto-detected and the reply shows the detection
  confidence. Below 25% the reply says so and how to force it: `@bot fr:en`
  (source:target), `@bot fr:` (source only), or `/translate` with `source:`.
  A forced source also replaces the cached translation for everyone.
- **Every translation is a real message in the channel.** They are for the
  people who need them, not only for whoever asked, and a message is something
  the bot can come back and correct. Refusals and "that message has no text"
  stay private to you.
- Every translation carries **source and target menus** (two rows each): the
  source menus show what was detected and let you correct it (or go back to
  Auto-detect); the target menus re-translate into another language. A pick
  posts the new translation to the channel as well.
- Any supported language to any other (Argos pivots through English
  internally). The language menus and autocomplete follow what LibreTranslate
  reports, re-checked every 5 minutes.
- **Edit a message and its translations edit themselves.** The bot remembers
  which of its posts translated which message, and rewrites every one of them
  into the language it was posted in. Delete the message and its cache entries
  and that record go; the posts stay, since deleting them would erase what was
  said.
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

`.env.example` sets `LT_LOAD_ONLY=en,es,fr,de,nl,pt,pb` so LibreTranslate
downloads only those models. That is the same list the deploy writes on the
VPS, and it matches the committed locale files in `src/i18n/messages`. The
codes are Argos spellings — `pb` is Brazilian Portuguese, which
`/languages` reports back as `pt-BR`. Add a code here to test a language the
bot does not ship messages for; leaving the variable out entirely loads all
~100 models (~10 GB).

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

- `yarn test`, `yarn typecheck`, `yarn lint` — the pre-commit hook runs the
  staged-secret check, typecheck and lint-staged; the pre-push hook runs the
  tests. The secret check refuses a staged `.env` outright, and scans the
  staged diff with `gitleaks` when gitleaks or Docker is available (it says so
  and continues when neither is, since CI scans on every push regardless).
- `yarn dev` runs the bot on the host with `tsx watch`; it needs reachable
  `REDIS_URL` / `LT_URL`, which the compose stack deliberately does not
  expose, so the container loop above is the supported path.

## Deploy (VPS)

`.github/workflows/deploy.yml` runs on every PR and push to `main`:

1. **secrets** — `gitleaks` over the full history (see [Security](#security))
2. **test** — `yarn typecheck`, `yarn lint`, `yarn test:run`
3. **build** — `scripts/validate-deploy-env.sh`, `docker build .`,
   `docker compose config`
4. **deploy** (push to `main` only) — ssh to the VPS, clone or
   `git reset --hard origin/main` at `VPS_DEPLOY_PATH`, write `.env` from
   secrets, `docker compose up -d --build --remove-orphans`, wait for the
   bot container to report **healthy**, `docker image prune -f`.

### Repository secrets

The `deploy` job needs all eight required ones before it can run. Set them at
**Settings → Secrets and variables → Actions → New repository secret**; the
names must match exactly. The `secrets`, `test` and `build` jobs need none of
them, so a run that goes green three times and then fails on "Deploy to VPS" is
the signature of a secret that is missing or wrong — the deploy asserts each one
and names the missing variable rather than writing a blank into `.env`.

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
| `REDIS_PASSWORD` | **Optional.** Unset leaves Redis unauthenticated on its own compose network. Set any long random string if the VPS runs other containers — see [Security](#security). |

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

Deploys run on a push to `main` **and** on a manual `workflow_dispatch` from
`main` — use the Actions tab's "Run workflow" to redeploy without a commit. The
`main` guard matters because a dispatch carries no branch filter of its own,
while the ssh script resets the VPS to `origin/main` regardless: a dispatch from
another branch would report deploying code it never deployed. A pull request
never deploys.

The job also checks `github.repository_owner`, so a fork's own push to `main`
does not queue a deploy against secrets it does not have. Change that value if
you fork this and deploy it yourself.

**First deploy:** LibreTranslate downloads the models named by `LT_LOAD_ONLY`
into the `lt-models` volume. The deploy does not wait for it; the bot comes up
and answers "still starting up" until they are loaded (watch
`docker compose logs -f libretranslate`; the container turns healthy when
done). The seven-language default is a few hundred MB and a minute or two.

Widening that list costs both disk and RAM — the full ~100-model set is ~10 GB
on disk, and Argos loads each model lazily as it is used, so resident memory
grows with the languages actually translated. On a VPS shared with other
containers, check free memory before adding languages; with no swap configured,
exhausting it means the kernel OOM-kills a container rather than degrading.

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

`CACHE_TTL_SECONDS` (default `86400`, 1 day) applies to new writes. Set it in
`.env` locally, or edit the literal in the `.env` heredoc of `deploy.yml` for
production. It is validated as a positive integer at boot.

The TTL **slides for translations**: every cache hit puts the full TTL back, so
a phrase a guild keeps reposting stays cached for as long as it keeps being
used, while something said once is gone the next day. The cache therefore
settles at roughly the size of what your guild repeats rather than growing with
everything it has ever translated. Raise the TTL if you would rather keep more;
the trade is Redis memory and how long message text is retained.

## Security

Running your own instance makes you the operator of a bot that reads message
content and stores it. What that involves, and the knobs that matter:

**It needs the Message Content privileged intent.** Translating a message means
reading it, so there is no version of this bot that does not. Discord gates the
intent in the developer portal, and the bot also requests `Guilds`,
`GuildMessages` and `GuildMessageReactions` — nothing else. Commands are
registered to the single `GUILD_ID`, not globally, so a leaked invite link
cannot put the bot to work in a server you did not choose.

**It stores message text in Redis for a day by default.** Both the translation
and the original text are cached (`tr:…` and `src:…`) for `CACHE_TTL_SECONDS`,
and a translation's expiry is pushed back each time it is reused, so text that
keeps being reposted is retained for as long as that continues. Keeping the
original text is what makes the re-translate menus work without re-fetching,
alongside a list of which of the bot's own posts translated which message
(`post:…`), which is what lets an edit find them. That is a data-retention decision, and it is yours: lower it, and
tell your members if that matters to them. Editing a message invalidates its
entries and rewrites its translations; deleting it drops both the entries and
the record of what was posted.

**Redis and LibreTranslate are unauthenticated by default, and publish no
ports.** They are reachable only on the compose network, which is enough when
the host runs nothing else. If it does, set `REDIS_PASSWORD` — otherwise any
other container on that network can read every cached message. Never add a
`ports:` entry to either service to "check something"; use `docker compose exec`.

**Translation is local.** LibreTranslate runs in your own container with Argos
models. No message text leaves your machine, and there is no third-party
translation API and no key to leak. Swapping the backend is what changes that.

**Rate limits are on by default.** `RATE_LIMIT_USER_PER_MIN` (20) and
`RATE_LIMIT_GUILD_PER_HOUR` (2000) cap what one person, and one server, can ask
of your hardware. They are budgets rather than a delay between requests, so a
fast-moving conversation is unaffected. Raise them if you have the capacity;
removing them entirely means one member can saturate the box. Over the limit,
slash commands answer privately and the public triggers (`@mention`, flag
reaction) simply stay quiet.

**Every translation is public, and anyone in the channel can act on one.** That
is the point of the bot — the room needs the translation, not just whoever asked
— but it means a translation of a message is visible to everyone who can see the
message, whichever trigger produced it. The language menus on a post are
clickable by anyone who can see it, and a click posts another translation and
counts against *that* person's budget.

**The containers are confined.** All three drop every Linux capability, set
`no-new-privileges`, and carry memory and pid limits; the bot additionally runs
on a read-only root filesystem as a non-root user. Redis is capped below its
memory limit so a full cache evicts rather than being OOM-killed.

**Secrets never enter the image or the repo.** They reach the container through
`.env` only, which is in both `.gitignore` and `.dockerignore`; the deploy
writes it under `umask 077`. `gitleaks` scans the full history on every push and
a pre-commit hook refuses a staged `.env`. If you fork this, the CI workflow
expects its own secrets — see [Repository secrets](#repository-secrets).

Found a problem? [SECURITY.md](SECURITY.md) — please not the public tracker.

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
- **No response to a flag** — someone else's flag for the same language is
  already on the message (only the first posts), the emoji is a custom one
  rather than a country flag, or the message is one of the bot's own. Flag
  reactions need no portal change: the reactions intent is not privileged.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE) — **free for any noncommercial purpose**.

Run it on your own Discord server, fork it, change it, share your changes: all free, so
long as no commercial purpose is anticipated. The licence spells out personal use — hobby
projects, private entertainment, study, experiment — and extends the same terms to
charities, schools, public research and government bodies.

Using it commercially — bundling it into a paid product, running it as a service you
charge for, or operating it for a for-profit company's own business — needs a separate
licence. Open an issue or email <raymond@raymondselzer.net> and ask; the answer is not
automatically no.

This is *source-available*, not OSI open source: an OSI-approved licence may not restrict
commercial use, and this one deliberately does.

Security problems go to [SECURITY.md](SECURITY.md), not the public issue tracker.
