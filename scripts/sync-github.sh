#!/usr/bin/env bash
# Commit and push local changes to GitHub (skips if nothing changed).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "sync-github: not a git repo — run git init first" >&2
  exit 1
fi

git add -A
if git diff --cached --quiet; then
  echo "sync-github: $(date -u +%Y-%m-%dT%H:%M:%SZ) — no changes"
  exit 0
fi

MSG="sync: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git commit -m "$MSG"
git push origin HEAD
echo "sync-github: pushed $(git rev-parse --short HEAD)"
