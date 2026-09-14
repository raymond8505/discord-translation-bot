#!/usr/bin/env sh
# Blocks a secret from reaching git history, where removing it means a rewrite
# and a rotation rather than an edit. Called by .husky/pre-commit.
#
# Two checks, cheapest first:
#   1. No .env file may be staged at all (.env.example is the exception).
#   2. gitleaks over the staged diff, if gitleaks or docker is available.
#
# Check 2 is best-effort by design: a contributor without either still gets
# check 1, and the `secrets` job in .github/workflows/deploy.yml scans the full
# history on every push regardless. A hook that cannot be installed is not a
# control; the CI job is.

set -eu

GITLEAKS_VERSION="v8.30.1"

fail() {
  echo "" >&2
  echo "COMMIT BLOCKED: $1" >&2
  echo "" >&2
  exit 1
}

# --- 1. Staged .env files ------------------------------------------------
# --diff-filter=ACM: added, copied, modified. A deletion is fine.
staged=$(git diff --cached --name-only --diff-filter=ACM)

# `.env`, `.env.local`, `.env.production` … but never `.env.example`.
offenders=$(printf '%s\n' "$staged" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$offenders" ]; then
  echo "$offenders" >&2
  fail "the file(s) above hold real configuration and must never be committed.
Put placeholders in .env.example instead. If this is genuinely not a secret,
rename it so it does not match .env*."
fi

# --- 2. gitleaks over the staged diff ------------------------------------
# `protect --staged` reads the staged diff and reports repo-relative paths, so
# the path allowlists in .gitleaks.toml apply. (`detect --no-git` reports
# absolute paths and they silently would not.)
#
# Exit codes are read rather than just tested: gitleaks returns 1 for "leaks
# found" and 2 for "could not run", and docker returns 125 when the run itself
# fails. Treating every non-zero as a leak turns a broken scanner into a
# blocked commit with a message that names the wrong problem.
run_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then
    gitleaks protect --staged --config .gitleaks.toml --redact --no-banner
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    # Git for Windows rewrites /repo into a host path on the way to docker,
    # which makes -w land somewhere meaningless. These two disable that for
    # this command; other shells have never heard of them and ignore them.
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
      docker run --rm -v "$PWD:/repo" -w /repo \
      "zricethezav/gitleaks:${GITLEAKS_VERSION}" \
      protect --staged --config .gitleaks.toml --redact --no-banner
  else
    return 127
  fi
}

set +e
run_gitleaks
scan_status=$?
set -e

case "$scan_status" in
  0) ;;
  1)
    fail "gitleaks found a secret in the staged changes (shown above, redacted).
Remove it and, if it was ever real, rotate it — a secret that reached a commit
is only gone once the history is rewritten AND the credential is replaced."
    ;;
  *)
    # Best-effort by design: a contributor without gitleaks or docker still gets
    # check 1, and the `secrets` job in CI scans the full history on every push.
    # A hook that cannot be installed is not a control; the CI job is.
    echo "note: secret scan did not run (status ${scan_status}); committing anyway." >&2
    echo "      CI scans the full history on push regardless." >&2
    ;;
esac
