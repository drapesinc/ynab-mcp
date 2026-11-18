<!-- Points Claude at AGENTS.md via import; edit AGENTS.md, not this file. -->
@AGENTS.md

## Fork (drapesinc/ynab-mcp)

Upstream is calebl/ynab-mcp-server. The fork keeps upstream's code and tool names and adds one file, `src/profiles.ts` (wired in `src/index.ts`): several YNAB logins via `YNAB_PROFILES`, each tool gets an optional `profile` argument. `dist/` is committed because the Mini runs `dist/index.js` straight from the clone: rebuild and commit it with `src/`.

## Repo hygiene

- Commit scripts, configs and docs. Never commit run outputs (logs, progress files), `.bak-*` copies, `__pycache__`, scratch dirs, or anything holding secrets.
- Put run outputs and scratch under an ignored path the moment you create them, and add the ignore rule in the same commit as the script that makes them.
- Do not leave one-off scripts untracked: commit them with the change they make, or delete them when done.
- End each session with a clean `git status`: commit, ignore, or move aside. Never delete logs.
- Grep new files for tokens and keys before committing. Secrets stay as `op://` references.

## Commit, merge and deploy rules

These rules apply to every Claude session and person working in this repo. One step from PR to live: there is no `pending` branch (retired 2026-11-17, Yaw).

- **Branches.** `main` is what's live. Branch from `main` and open your PR against `main`.
- **Before you start,** check this repo's open PRs and build on them, so two sessions don't redo the same work.
- **Merge = deploy.** Merging a PR into `main` is the release: whatever deploys or installs this repo picks up `main`.
- **Who merges.** A Claude session merges its own PR into `main` once all of these hold: CI is green; a fresh reviewer (for example `/code-review`, given the diff and not the session's conclusions) has reviewed it and every finding is fixed or answered in the PR; the PR is not a draft; and it has no `needs-yaw` label. Then it reads the result back before saying it's live.
- **`needs-yaw`.** Label the PR `needs-yaw` and leave the merge to Yaw when it is a risky upgrade (database major versions, Authentik, anything that can't roll back; write the backup step into the PR), touches money, client data or anything sent to clients, or changes secrets or sign-in. Sessions never merge a PR with this label.
- **Automatic merges.** Tag-only image bumps (`auto-bump/*` branches) and Dependabot patches merge themselves once their checks pass.
- **Unfinished work** stays a draft PR, or ships behind a feature flag that is off by default.
- **Removing a change.** Revert it with a revert PR. Never force-push `main`.
- **Hotfix.** Same path, just first in line: a PR to `main`, merged as soon as CI is green.
- **No edits on servers.** Never edit files on hz-dr, hz-fa or the Mini's checkout. Every change, even one config line, goes through a PR. If an emergency forces a hand edit, open a PR for it within the hour.
- **Commits.** One commit per finished change, and the message says what changed and why. Never commit secrets, logs or backup copies.
- **Previews.** Apps build a preview only for a PR with the `preview` label. Idle previews sleep.
- **After deploy,** read the result back (service up, page loads, alert cleared) before saying it's live. What went live each day is listed in the 16:00 summary.
