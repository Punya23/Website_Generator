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

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
