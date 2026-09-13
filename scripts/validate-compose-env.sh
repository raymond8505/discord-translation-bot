#!/usr/bin/env bash
# Renders docker-compose.yml under production conditions and fails if any
# container environment variable comes out set-but-empty.
#
# Why this exists: an env var that is absent and one that is present-but-blank
# are different things to the program inside the container. `${VAR:-}` renders
# a blank string, which Compose passes through as a real, set variable —
# libretranslate reads a blank LT_LOAD_ONLY as "load zero languages" and dies
# on an empty list. To mean "unset", a compose entry must be key-only
# (`LT_LOAD_ONLY:`), which renders as null and is omitted from the container.
#
# Production conditions = the .env the deploy heredoc writes, which is a
# strict subset of .env.example. A render against .env.example cannot catch
# this class of bug: every var it exercises has a value.
#
# Run locally:  bash scripts/validate-compose-env.sh
# Run in CI:    called by the build job in deploy.yml

set -euo pipefail

DEPLOY_FILE=".github/workflows/deploy.yml"
COMPOSE_FILE="docker-compose.yml"

# Rendered in a temp project directory so the developer's own .env is never
# read or written. --project-directory is what points `env_file: .env` at that
# directory.
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# The heredoc's NAME=value lines, with ${SECRET} refs given a placeholder so
# the secrets read as set. Blanks left here would be indistinguishable from
# the bug being hunted.
grep -F 'echo "' "$DEPLOY_FILE" \
  | sed 's/.*echo "//; s/".*//' \
  | grep -E '^[A-Z_]+=' \
  | sed 's/=[$]{[A-Z_]*}$/=placeholder/' \
  > "$TMP_DIR/.env"

echo "=== Validating ${COMPOSE_FILE} against the deploy heredoc's .env ==="
cat "$TMP_DIR/.env"

if ! RENDERED=$(docker compose -f "$COMPOSE_FILE" --project-directory "$TMP_DIR" config 2>&1); then
  echo "FAILED: docker compose config could not render ${COMPOSE_FILE}:" >&2
  echo "$RENDERED" >&2
  exit 1
fi

# `docker compose config` emits deterministic indentation: service at 2
# spaces, environment: at 4, each variable at 6.
EMPTIES=$(printf '%s\n' "$RENDERED" | awk '
  /^  [a-z0-9_-]+:$/           { svc = substr($1, 1, length($1) - 1) }
  /^    environment:$/         { inenv = 1; next }
  inenv && /^      [A-Za-z_][A-Za-z0-9_]*:/ {
                                 if ($0 ~ /: ""$/) {
                                   key = substr($1, 1, length($1) - 1)
                                   print "  " svc "." key
                                 }
                                 next
                               }
  inenv                        { inenv = 0 }
')

if [ -n "$EMPTIES" ]; then
  echo ""
  echo "FAILED: set-but-empty environment variable(s) in the production render:" >&2
  echo "$EMPTIES" >&2
  echo "" >&2
  echo "Use a key-only entry (NAME: with no value) to leave one genuinely unset." >&2
  exit 1
fi

echo "No set-but-empty environment variables."
