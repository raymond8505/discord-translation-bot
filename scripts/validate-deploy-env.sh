#!/usr/bin/env bash
# Validates that every process.env.X read in src/ is written to the VPS .env
# by the deploy workflow, and that every secret the .env heredoc references
# is wired through the ssh-action step.
#
# Rules:
#   1. Every process.env.X in src/ (except NODE_ENV) must appear as a
#      left-hand name in the workflow's .env heredoc
#   2. Every ${REFVAR} referenced in the heredoc must be in the env: block
#   3. Every ${REFVAR} referenced in the heredoc must be in the envs: list
#
# Limitations:
#   - Does not detect dynamic env access via process.env[key]; src/env.ts
#     lists every var explicitly for this reason
#   - Assumes heredoc lines follow the pattern: echo "NAME=${REFVAR}" or
#     echo "NAME=literal"
#
# Run locally:  bash scripts/validate-deploy-env.sh
# Run in CI:    called by the build job in deploy.yml

set -euo pipefail

DEPLOY_FILE=".github/workflows/deploy.yml"
SRC_DIR="src"
ERRORS=0

fail() { echo "ERROR: $*" >&2; ERRORS=$((ERRORS + 1)); }

# process.env.X names in src/ (no tests, no NODE_ENV).
SRC_VARS=$(grep -rh --include="*.ts" --exclude="*.test.ts" --exclude-dir="fixtures" \
    -oE 'process\.env\.[A-Z_]+' "$SRC_DIR" \
  | sed 's/process\.env\.//' \
  | sort -u | grep -v '^NODE_ENV$' || true)

echo "=== Validating ${DEPLOY_FILE} ==="

# Heredoc lines look like: echo "NAME=${REFVAR}" or echo "NAME=literal"
HEREDOC_NAMES=$(grep -F 'echo "' "$DEPLOY_FILE" \
  | sed 's/.*echo "//; s/=.*//' \
  | grep -E '^[A-Z_]+$' \
  | sort -u || true)

# Right-hand refs: only lines whose value is ${REFVAR}
HEREDOC_REFS=$(grep -F 'echo "' "$DEPLOY_FILE" \
  | grep -F '=${' \
  | sed 's/.*=[$]{//; s/[}"].*//' \
  | grep -E '^[A-Z_]+$' \
  | sort -u || true)

# Keys in env: block — lines like "  KEY: ${{ secrets.X }}"
ENV_BLOCK_KEYS=$(grep -F ': ${{' "$DEPLOY_FILE" \
  | sed 's/^[[:space:]]*//; s/:.*//' \
  | grep -E '^[A-Z_]+$' \
  | sort -u || true)

# Vars in the envs: list
ENVS_LIST=$(grep -F 'envs:' "$DEPLOY_FILE" \
  | sed 's/.*envs:[[:space:]]*//' \
  | tr ',' '\n' \
  | grep -E '^[A-Z_]+$' \
  | sort -u || true)

echo "--- Rule 1: process.env vars in src/ must be in .env heredoc ---"
while IFS= read -r var; do
  [ -z "$var" ] && continue
  echo "$HEREDOC_NAMES" | grep -qx "$var" \
    || fail "process.env.$var used in src/ but NOT written to .env"
done <<< "$SRC_VARS"

echo "--- Rule 2: heredoc \${REFVAR}s must be in env: block ---"
while IFS= read -r var; do
  [ -z "$var" ] && continue
  echo "$ENV_BLOCK_KEYS" | grep -qx "$var" \
    || fail "\${$var} referenced in heredoc but NOT in env: block"
done <<< "$HEREDOC_REFS"

echo "--- Rule 3: heredoc \${REFVAR}s must be in envs: list ---"
while IFS= read -r var; do
  [ -z "$var" ] && continue
  echo "$ENVS_LIST" | grep -qx "$var" \
    || fail "\${$var} referenced in heredoc but NOT in envs: list"
done <<< "$HEREDOC_REFS"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAILED: $ERRORS env sync error(s). See above." >&2
  exit 1
fi

echo "All env sync checks passed."
