# Deploy (VPS)

The operator's runbook: what the deploy workflow does, the repository secrets it needs, and the
two SSH keypairs that let the pieces talk to each other. Setting this up is a one-time job. For
what the bot is and how to run it locally, see [README.md](README.md).

Prerequisites on the VPS: Docker with the Compose plugin, and the `VPS_USER` able to run `docker`
without `sudo`.

`.github/workflows/deploy.yml` runs on every PR and push to `main`:

1. **secrets** — `gitleaks` over the full history (see [Security](README.md#security))
2. **test** — `yarn typecheck`, `yarn lint`, `yarn test:run`
3. **build** — `scripts/validate-deploy-env.sh`, `docker build .`,
   `docker compose config`
4. **deploy** (push to `main` only) — ssh to the VPS, clone or
   `git reset --hard origin/main` at `VPS_DEPLOY_PATH`, write `.env` from
   secrets, `docker compose up -d --build --remove-orphans`, wait for the
   bot container to report **healthy**, `docker image prune -f`.

## Repository secrets

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
| `REDIS_PASSWORD` | **Optional.** Unset leaves Redis unauthenticated on its own compose network. Set any long random string if the VPS runs other containers — see [Security](README.md#security). |

The three Discord values come from the **production** app. Creating it, and why production and
local development each need their own, is in the README:
[Discord app setup](README.md#discord-app-setup-once-per-environment).

Both key secrets hold a whole private key file. `-N ""` generates them without a
passphrase, which is required — the Action cannot type one.

Run everything below **on the VPS**, in the shell you get from:

```bash
ssh <your-own-user>@<VPS_HOST>
```

Your own login, with whatever key you already use. Generating both keypairs
there keeps the commands in a plain bash shell and means no public key ever has
to be moved between machines.

### Key 1 of 2 — GitHub Actions → VPS (`VPS_SSH_KEY`)

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

### Key 2 of 2 — VPS → GitHub (`GH_DEPLOY_KEY`)

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

### Check the deploy key, then clean up

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
proves it (push to `main`, or use the manual dispatch below).

Wait for a green deploy, then delete both private keys from the VPS. Nothing on
the machine reads either file: GitHub holds both, and the workflow writes
`GH_DEPLOY_KEY` to `~/.ssh/github_discord_translation_bot` itself on every run.

```bash
rm ~/.ssh/dtb_vps ~/.ssh/dtb_repo   # keep both .pub files
```

The workflow clones over SSH (`git@github.com:…`), which is why the deploy key
is needed even while the repo is public.

## When a deploy runs

Deploys run on a push to `main` **and** on a manual `workflow_dispatch` from
`main` — use the Actions tab's "Run workflow" to redeploy without a commit. The
`main` guard matters because a dispatch carries no branch filter of its own,
while the ssh script resets the VPS to `origin/main` regardless: a dispatch from
another branch would report deploying code it never deployed. A pull request
never deploys.

The job also checks `github.repository_owner`, so a fork's own push to `main`
does not queue a deploy against secrets it does not have. Change that value if
you fork this and deploy it yourself.

## First deploy

LibreTranslate downloads the models named by `LT_LOAD_ONLY`
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
