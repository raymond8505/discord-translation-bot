# Discord Translation Bot — Handoff

## Goal
Self-hosted, zero-cost (beyond existing Hostinger VPS) Discord translation bot. On-demand only. Community < 100 members; scale is not a concern.

## ⚠️ BLOCKED: VPS specs
Before sizing LibreTranslate or considering Ollama, run on the VPS and record here:

```
free -h && nproc && df -h /
```

- RAM: ___
- vCPUs: ___
- Free disk: ___

Sizing rules:
- ≥4 GB RAM, ≥10 GB disk → LibreTranslate with full language set.
- Less → LibreTranslate with `LT_LOAD_ONLY` whitelist (ask Raymond which languages).
- Ollama fallback only if ≥8 GB RAM and Argos quality proves inadequate. Do not build it in phase 1.

## Architecture
Three containers via Docker Compose on the VPS:

| Service | Image | Notes |
|---|---|---|
| `bot` | own Dockerfile (Node 22, discord.js v14) | stateless |
| `redis` | `redis:7-alpine` | `appendonly yes`, bind localhost / internal network only |
| `libretranslate` | `libretranslate/libretranslate` | internal network only, no host port |

Translation backend is behind an interface so LibreTranslate → Ollama is a config swap later.

## Bot behavior
- **Slash command** `/translate [target?]` — translates the replied-to message, or accepts text.
- **Message context-menu command** "Translate Message".
- Target language defaults to `interaction.locale` (map Discord locale codes → ISO 639-1 for LibreTranslate, e.g. `en-US` → `en`, `zh-CN` → `zh`, `es-ES` → `es`).
- Source language: `auto` (LibreTranslate detect).
- Reply is **ephemeral**, includes a language `StringSelectMenu` to re-translate into a different target.
- Many-to-many: any supported source to any supported target (Argos pivots via English internally).

## Cache (Redis)
- Key: `tr:{message_id}:{target_lang}`
- Value: JSON `{ text, backend, source_lang, created_at }`
- `SET ... EX <ttl>` on write. TTL env var `CACHE_TTL_SECONDS`, default 30 days.
- Check cache before calling backend; on hit, still allow language-select re-translate (separate key).
- **Invalidation**: on `messageUpdate` and `messageDelete`, `SCAN MATCH tr:{message_id}:*` and `DEL`. Requires:
  - `GatewayIntentBits.MessageContent` + `Guilds` + `GuildMessages`
  - `Partials.Message` (edits to uncached messages arrive as partials)
- No `KEYS` in production; use `SCAN`.

## Backend interface
```ts
interface TranslationBackend {
  name: string; // stored in cache entry
  translate(text: string, source: 'auto' | string, target: string): Promise<{ text: string; detectedSource: string }>;
  languages(): Promise<string[]>; // populates select menu
}
```
Implement `LibreTranslateBackend` (POST `/translate`, GET `/languages`). Stub `OllamaBackend` file with TODO; do not implement.

## Config (env)
```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GUILD_ID=            # register commands guild-scoped for fast iteration
REDIS_URL=redis://redis:6379
LT_URL=http://libretranslate:5000
BACKEND=libretranslate
CACHE_TTL_SECONDS=2592000
```

## Discord app setup (manual, Raymond)
1. Create app at discord.com/developers → Bot → enable **Message Content Intent**.
2. Invite URL scopes: `bot`, `applications.commands`. Permissions: Send Messages, Read Message History.
3. Paste token/client ID into `.env`.

## Deliverables
- `docker-compose.yml`, `Dockerfile`, `.env.example`
- `src/index.ts`, `src/commands/translate.ts`, `src/commands/translateMessage.ts`, `src/cache.ts`, `src/backends/{index,libretranslate,ollama}.ts`, `src/locale.ts`
- `scripts/deploy-commands.ts` (guild-scoped registration)
- README: setup, deploy, swapping backend, adjusting TTL

## Out of scope (phase 1)
- Auto-translate channels, mirror channels
- Ollama backend
- Per-user language preference persistence (locale default is sufficient)
- Metrics/dashboards

## Raymond's conventions
- Terse communication, plan before execute, ask before assuming on ambiguity.
- Correct him directly if an assumption is wrong.
