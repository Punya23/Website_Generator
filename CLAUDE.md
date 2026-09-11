# Website Generator — project conventions

## Git

After finishing a change (verified working — typecheck/tests pass, or manually confirmed for
docs-only edits), **commit and push directly to `master` without asking first.** No feature
branches, no PRs for this repo's own workflow — `git push origin HEAD:master`.

- Stage only the files you actually touched this session — never someone else's unrelated
  uncommitted WIP sitting in the same worktree.
- Write a real commit message: what changed and why, not just what. End it with the required
  `Co-Authored-By:` trailer.
- Before pushing, `git fetch` and confirm `origin/master` hasn't moved past what you branched
  from. If it has and your local tip is a clean rebase of the same content, `--force-with-lease`
  is fine; if someone else's real work landed, merge it in first — never force over it.
- This applies to every change, including docs-only ones — a docs fix is still a finished, verified
  change.
