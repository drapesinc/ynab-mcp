# Upstream port proposal

**Status 2026-10-02: all six items approved by Yaw and implemented** (see CHANGELOG `[Unreleased]`). Decisions: #1 keep 13 types, error lists the 6 allowed; #3 auto_assign defaults to dry run; #5 history-based suggestions only, no third-party AI.

(Original proposal below.)

Ported 2026-10-01: `isError: true` on failures (upstream 4cb1051) and split-transaction legs (c70658f). The items below would change the fork's tool schemas or need a decision.

1. **ynab SDK 4.0.0 → 4.5.0.** The API can only create 6 account types (checking, savings, cash, creditCard, otherAsset, otherLiability), so the `type` enum on `ynab_accounts_write` `create` would shrink from 13 to 6, dropping lineOfCredit, mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt. The `ynab_accounts` read filter keeps all 13. **Question for Yaw: remove those 7 from `create`, or keep them and return an error that lists the 6 allowed types?**
2. **Move money.** The fork already has `ynab_categories_write` `move`. Port only upstream's partial-failure report (says which category was changed if the second write fails). No schema change.
3. **Auto-assign.** New `ynab_categories_write` action `auto_assign` plus two new optional params: `dry_run` (boolean) and `max_total` (dollars). Fills underfunded goals from Ready to Assign, biggest gap first.
4. **Spending reports.** New `ynab_transactions_read` actions `spending_by_category`, `spending_by_payee`, `cash_flow`. They reuse `since_date`, `until_date`, `limit`; one new optional param `months` (number) for `cash_flow`. Splits counted by leg, transfers left out.
5. **Category suggestions (preview + guarded apply).** New actions `suggest_categories` and `apply_category_suggestions` (on `ynab_transactions_write`, or a new 9th tool), with `suggestions[{transaction_id, category_id, expected_content_fingerprint}]` and `dry_run`. Upstream's AI mode sends payee and memo text to TypeSafe, a third party (opt-in env `YNAB_AI_CATEGORIZATION` + `TYPESAFE_API_KEY`). Suggest: history-based suggestions only, no TypeSafe.
6. **Error detail (no schema change).** YNAB API errors reach the caller as `Error: [object Object]` because the SDK throws a plain object. Port upstream's `getErrorMessage` so YNAB's own message shows. Pinned today in `src/tests/transactions-write.test.ts`.

## Round 2 — upstream to 17a6085 (merged 2026-10-03, not yet ported)

The 2026-10-03 sync merged upstream with "ours" for all code: upstream's per-tool files, Cloudflare
Worker, registry and npm-publish workflows were left out, because the fork keeps its 8 consolidated
`ynab_*` tools. Only upstream's dev-dependency security bump (vitest 4.1.11, inspector 0.16.8) was
taken. Two upstream features from 2026-10-02 are not in the fork yet:

7. **Update a transaction into a split** (upstream 978db93). The fork's `create` already takes
   `splits`; `update` does not. Port: accept `splits` on `ynab_transactions_write` `update`, and
   refuse to re-split a transaction that is already split (YNAB does not support it).
8. **Similar-payee history for category suggestions** (upstream 7799276). When a payee has no
   history, fall back to payees whose normalised name is a prefix of the other (shorter at least 6
   chars), e.g. "Better Bl" uses "Better Blend". Report `match` and `matched_payee_names`. Upstream
   also sends this to TypeSafe; port the history part only, per decision #5.

## Round 3 — upstream to a75f9e5 (merged 2026-10-29, not yet ported)

The 2026-10-29 sync again merged upstream with "ours" for all code, docs and CI. Upstream's
per-tool files, registry, Cloudflare Worker (now with an auto-budget service and D1 migrations),
VISION.md and agent skill were left out. Only upstream's dev-only vitest bump (4.1.12, for
GHSA-qxg6-89mg-rqv8 / GHSA-xp26-3454-mjgp) and non-breaking `npm audit fix` lockfile updates were
taken. Upstream features from 0.4.2 to 0.7.1 that the fork does not have yet:

9. **Read-only mode** (upstream 076dd4f). `YNAB_READ_ONLY=true` registers only read tools. The
   fork has no such switch. Port: skip the write tools (`*_write`) when it is set.
10. **Currency precision** (upstream 3febb96). Amounts use the plan's `decimal_digits` instead of
    a fixed 2, and round half away from zero for inflows and outflows alike. The fork uses
    `toFixed(2)`. Matters only for 3-decimal currencies (KWD, BHD, JOD, OMR, TND); CAD, USD and
    GHS are unaffected. Low priority.
11. **Transaction search filters and totals** (upstream 988ba7c). Filters and inflow/outflow totals
    on the transaction list. Port onto `ynab_transactions_read` `list`.
12. **Monthly breakdown on spending reports** (upstream ca0d35a). `monthly: true` and `months`
    (default 6, at most 24) on `spending_by_category` / `spending_by_payee`.
13. **Budget vs actuals** (upstream effdb41). Per-category budgeted, activity, variance and
    percent used for a month, with group subtotals. Port onto `ynab_budgets` month summary.
14. **Balance forecast** (upstream fae47b4). Projects account balances over N days from scheduled
    transactions (low point, ending balance). New action on `ynab_accounts` or `ynab_transactions_read`.
15. **Detect recurring** (upstream 12b90ef). Finds subscriptions and bills from a year of history
    (cadence, yearly cost, next date, stopped?, already scheduled?). New `ynab_transactions_read` action.
16. **Personal-prior category suggestions** (upstream fd61d42). A local naive-Bayes model over
    payee tokens, account and amount bucket, trained per request on the plan's own history. No
    third party for that part; upstream sends the remainder to a model. History/prior part only,
    per decision #5.

**Not taken, needs a decision:** upstream moved to `zod` 4 (GHSA-mrhx-c7xc-m3w5, high). The fork
is on `zod` 3.25 (also pulled in by `@modelcontextprotocol/inspector`), so `npm audit` still
reports it. Moving to zod 4 changes every tool schema and needs its own PR.
