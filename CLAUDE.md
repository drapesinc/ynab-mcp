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

These rules apply to every Claude session and person working in this repo.

- **Branches.** `main` is what's live. `pending` holds finished work waiting to go live. Branch from `pending`, and open your PR against `pending`, not `main`.
- **Before you start,** check this repo's open PRs and build on them, so two sessions don't redo the same work.
- **Merging into `pending`.** A Claude session may merge its own PR into `pending` once CI is green and it has re-read the diff. Merge only work that's ready to go live. Unfinished work stays in its own PR (mark it draft), or ships behind a feature flag that is off by default.
- **Removing a change.** Revert a rejected change on `pending` with a revert commit. Never force-push `pending` or `main`.
- **Going live.** One open PR per repo, "Pending changes → main", lists every change waiting to go live. Yaw merges it, about twice a day (after the 08:00 and 16:00 summaries). That merge is the deploy, so nothing else deploys. When `pending` has new green changes, post one line in Infra ops saying the release is ready.
- **Hotfix.** For a site that's down or a security fix, open the PR straight to `main` with the `hotfix` label. Once it merges, merge `main` back into `pending`.
- **Risky upgrades** (database major versions, Authentik, anything that can't roll back) get their own PR to `main`, with the backup step written in. They never go in `pending`. Two kinds of change skip `pending` and go straight to `main`: tag-only image bumps from the nightly auto-bump (`auto-bump/*` branches) and Dependabot patches. Both merge themselves once their checks pass.
- **No edits on servers.** Never edit files on hz-dr, hz-fa or the Mini's checkout. Every change, even one config line, goes through a PR. If an emergency forces a hand edit, open a PR for it within the hour.
- **Commits.** One commit per finished change, and the message says what changed and why. Never commit secrets, logs or backup copies.
- **Previews.** Apps run one preview built from `pending` that sleeps when idle. A per-PR preview is built only when the PR has the `preview` label. Infra repos have no preview. Their pending PR lists what each change will restart.
- **After deploy,** read the result back (service up, page loads, alert cleared) before saying it's live.
