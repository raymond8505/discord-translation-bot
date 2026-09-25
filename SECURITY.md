# Security Policy

## Supported versions

This is a single-deployment hobby project with no release branches. Only the current
`main` receives fixes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** A public report tells
everyone running the bot about the hole before there is a fix for it.

Report privately through GitHub:

**[Security → Report a vulnerability](https://github.com/raymond8505/discord-translation-bot/security/advisories/new)**

Useful things to include: what an attacker can do, the steps to reproduce it, and which
commit you tested. Expect a first response within a week; this is a side project, not a
staffed product.

## Scope

In scope — anything in this repository:

- The bot's handling of Discord input: command options, message content, flag reactions,
  and `customId` values on select menus.
- Cache key construction and anything that lets one user read or overwrite another's
  cached translation.
- The deploy workflow and container configuration, including secret handling.

Out of scope:

- Vulnerabilities in LibreTranslate, Redis, Node, or discord.js themselves. Report those
  upstream; if this project's configuration makes an upstream bug materially worse, that
  part *is* in scope.
- Findings that require an attacker to already have shell access to the host or the
  Discord bot token.
- Denial of service through sheer message volume. The bot ships per-user and per-guild
  rate limits (`RATE_LIMIT_USER_PER_MIN`, `RATE_LIMIT_GUILD_PER_HOUR`) and a self-hoster
  is expected to tune them; a *bypass* of those limits is in scope.

## Notes for self-hosters

Running your own instance makes you the operator, and a few defaults are worth knowing
about. The **[Security section of the README](README.md#security)** covers what the bot
stores, for how long, and which privileged Discord intent it needs and why.
