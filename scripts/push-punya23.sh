#!/usr/bin/env bash
# Push this repo as the Punya23 GitHub account (not punyasurana-lab).
# One-time setup: gh auth login -h github.com -p ssh -w  (log in as Punya23)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! gh auth status -h github.com 2>&1 | grep -q "account Punya23"; then
  echo "Punya23 is not logged into GitHub CLI yet."
  echo ""
  echo "Run this once in your terminal (browser will open):"
  echo "  gh auth login -h github.com -p ssh -w"
  echo "  # Choose GitHub.com → SSH → Login with browser → account Punya23"
  echo ""
  echo "If you already have both accounts:"
  echo "  gh auth switch -u Punya23"
  exit 1
fi

echo "Switching GitHub CLI to Punya23…"
gh auth switch -u Punya23
gh auth setup-git -h github.com

git remote set-url origin https://github.com/Punya23/Website_Generator.git
echo "Pushing master → Punya23/Website_Generator…"
git push -u origin master
echo "Done."
