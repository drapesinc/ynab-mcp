/**
 * ynab_transactions_write - Transaction mutation operations
 * Actions: create, update, delete, approve, adjust, create_scheduled, update_scheduled, delete_scheduled, suggest_categories, apply_category_suggestions
 */
import { z } from "zod";
import * as ynab from "ynab";
import { getApiClient, resolveBudgetId, getDefaultAccount } from "../utils/profile-manager.js";
import { resolveAccountId, resolveCategoryId, resolvePayeeId } from "../utils/resolver.js";
import { contentFingerprint } from "../utils/fingerprint.js";
import { isInflowCategory } from "../utils/spending.js";
import { formatAmount, formatTransaction, dollarsToMilliunits, formatDate, createResponse, createErrorResponse, getErrorMessage } from "../utils/formatter.js";
export const name = "ynab_transactions_write";
export const description = `Transaction mutation operations for YNAB. Actions:
- create: Create transaction (with optional split support)
- update: Update existing transaction
- delete: Delete transaction
- approve: Approve or unapprove transaction
- bulk_approve: Approve multiple transactions at once
- adjust: Create balance adjustment for tracking accounts
- import: Trigger import from linked financial institutions
- create_scheduled: Create a scheduled/recurring transaction
- update_scheduled: Update an existing scheduled transaction
- delete_scheduled: Delete a scheduled transaction
- suggest_categories: Suggest categories for uncategorized transactions from your own history (most common category for the same payee). Read-only; no data leaves YNAB. Options: since_date, limit
- apply_category_suggestions: Apply suggestions (suggestions[{transaction_id, category_id, expected_content_fingerprint}]). Preview only unless dry_run is explicitly false; skips any transaction that changed since it was suggested`;
export const inputSchema = {
    action: z.enum(["create", "update", "delete", "approve", "bulk_approve", "adjust", "import", "create_scheduled", "update_scheduled", "delete_scheduled", "suggest_categories", "apply_category_suggestions"]).describe("Action to perform"),
    profile: z.string().optional().describe("Profile name (optional, uses default)"),
    budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
    account: z.string().optional().describe("Account name or ID"),
    transaction_id: z.string().optional().describe("Transaction ID (for update, delete, approve) or scheduled transaction ID (for update_scheduled, delete_scheduled)"),
    amount: z.number().optional().describe("Amount in dollars (negative = outflow, positive = inflow)"),
    payee: z.string().optional().describe("Payee name or ID"),
    category: z.string().optional().describe("Category name or ID"),
    memo: z.string().optional().describe("Transaction memo"),
    date: z.string().optional().describe("Transaction date (YYYY-MM-DD, defaults to today)"),
    cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
    approved: z.boolean().optional().describe("Approval status (for approve action)"),
    splits: z.array(z.object({
        amount: z.number().describe("Split amount in dollars"),
        category: z.string().describe("Category name or ID"),
        memo: z.string().optional().describe("Split memo")
    })).optional().describe("Split transaction categories"),
    transaction_ids: z.array(z.string()).optional().describe("Array of transaction IDs (for bulk_approve)"),
    frequency: z.enum(["never", "daily", "weekly", "everyOtherWeek", "twiceAMonth", "every4Weeks", "monthly", "everyOtherMonth", "every3Months", "every4Months", "twiceAYear", "yearly", "everyOtherYear"]).optional().describe("Frequency for scheduled transactions"),
    since_date: z.string().optional().describe("For 'suggest_categories': only suggest for transactions on or after this date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("For 'suggest_categories': maximum suggestions to return (default: 50)"),
    suggestions: z.array(z.object({
        transaction_id: z.string().describe("Transaction ID"),
        category_id: z.string().describe("Category ID to apply"),
        expected_content_fingerprint: z.string().describe("Fingerprint returned by suggest_categories; the suggestion is skipped if the transaction changed since")
    })).optional().describe("Suggestions to apply (for 'apply_category_suggestions')"),
    dry_run: z.boolean().optional().describe("For 'apply_category_suggestions': preview only (default true). Set false to write.")
};
export async function execute(input) {
    try {
        const { action, profile, budget, account, transaction_id, amount, payee, category, memo, date, cleared, approved, splits, transaction_ids, frequency, since_date, limit = 50, suggestions, dry_run } = input;
        const api = getApiClient(profile);
        const budgetId = resolveBudgetId(budget, profile);
        // Get budget currency
        const planResponse = await api.plans.getPlanById(budgetId);
        const currencyCode = planResponse.data.plan.currency_format?.iso_code || 'USD';
        switch (action) {
            case "create": {
                // Resolve account - use default if not specified
                let accountId;
                if (account) {
                    accountId = await resolveAccountId(account, budget, profile);
                }
                else {
                    const budgetAlias = budget?.toLowerCase() || '';
                    const defaultAccount = getDefaultAccount(budgetAlias, profile);
                    if (!defaultAccount) {
                        return createErrorResponse("No account specified and no default account configured");
                    }
                    accountId = await resolveAccountId(defaultAccount, budget, profile);
                }
                if (amount === undefined) {
                    return createErrorResponse("'amount' is required for create action");
                }
                // Build transaction
                const transaction = {
                    account_id: accountId,
                    amount: dollarsToMilliunits(amount),
                    date: formatDate(date || new Date()),
                    cleared: cleared || ynab.TransactionClearedStatus.Uncleared,
                    approved: true,
                };
                // Resolve payee
                if (payee) {
                    const payeeId = await resolvePayeeId(payee, budget, profile);
                    if (payeeId.includes('-')) {
                        transaction.payee_id = payeeId;
                    }
                    else {
                        transaction.payee_name = payee;
                    }
                }
                // Handle splits or single category
                if (splits && splits.length > 0) {
                    const subtransactions = [];
                    for (const split of splits) {
                        const catId = await resolveCategoryId(split.category, budget, profile);
                        subtransactions.push({
                            amount: dollarsToMilliunits(split.amount),
                            category_id: catId,
                            memo: split.memo
                        });
                    }
                    transaction.subtransactions = subtransactions;
                }
                else if (category) {
                    transaction.category_id = await resolveCategoryId(category, budget, profile);
                }
                if (memo) {
                    transaction.memo = memo;
                }
                const response = await api.transactions.createTransaction(budgetId, { transaction });
                const created = response.data.transaction;
                if (!created) {
                    return createErrorResponse("Transaction created but no data returned");
                }
                return createResponse({
                    success: true,
                    message: "Transaction created",
                    transaction: formatTransaction({
                        ...created,
                        payee_name: created.payee_name ?? null,
                        category_name: created.category_name ?? null,
                        memo: created.memo ?? null
                    }, currencyCode)
                });
            }
            case "update": {
                if (!transaction_id) {
                    return createErrorResponse("'transaction_id' is required for update action");
                }
                // Get existing transaction
                const existingResponse = await api.transactions.getTransactionById(budgetId, transaction_id);
                const existing = existingResponse.data.transaction;
                // Build update using ExistingTransaction type (SDK v4)
                const update = {
                    account_id: existing.account_id,
                    amount: amount !== undefined ? dollarsToMilliunits(amount) : existing.amount,
                    date: date ? formatDate(date) : existing.date,
                    cleared: cleared || existing.cleared,
                    approved: approved !== undefined ? approved : existing.approved,
                };
                if (account) {
                    update.account_id = await resolveAccountId(account, budget, profile);
                }
                if (payee) {
                    const payeeId = await resolvePayeeId(payee, budget, profile);
                    if (payeeId.includes('-')) {
                        update.payee_id = payeeId;
                    }
                    else {
                        update.payee_name = payee;
                    }
                }
                if (category) {
                    update.category_id = await resolveCategoryId(category, budget, profile);
                }
                if (memo !== undefined) {
                    update.memo = memo;
                }
                const response = await api.transactions.updateTransaction(budgetId, transaction_id, { transaction: update });
                const updated = response.data.transaction;
                if (!updated) {
                    return createErrorResponse("Transaction updated but no data returned");
                }
                return createResponse({
                    success: true,
                    message: "Transaction updated",
                    transaction: formatTransaction({
                        ...updated,
                        payee_name: updated.payee_name ?? null,
                        category_name: updated.category_name ?? null,
                        memo: updated.memo ?? null
                    }, currencyCode)
                });
            }
            case "delete": {
                if (!transaction_id) {
                    return createErrorResponse("'transaction_id' is required for delete action");
                }
                await api.transactions.deleteTransaction(budgetId, transaction_id);
                return createResponse({
                    success: true,
                    message: "Transaction deleted",
                    transaction_id
                });
            }
            case "approve": {
                if (!transaction_id) {
                    return createErrorResponse("'transaction_id' is required for approve action");
                }
                const update = {
                    approved: approved !== undefined ? approved : true,
                };
                const response = await api.transactions.updateTransaction(budgetId, transaction_id, { transaction: update });
                const updated = response.data.transaction;
                if (!updated) {
                    return createErrorResponse("Transaction approved but no data returned");
                }
                return createResponse({
                    success: true,
                    message: `Transaction ${approved === false ? 'unapproved' : 'approved'}`,
                    transaction: formatTransaction({
                        ...updated,
                        payee_name: updated.payee_name ?? null,
                        category_name: updated.category_name ?? null,
                        memo: updated.memo ?? null
                    }, currencyCode)
                });
            }
            case "adjust": {
                // Balance adjustment for tracking accounts
                if (!account) {
                    return createErrorResponse("'account' is required for adjust action");
                }
                if (amount === undefined) {
                    return createErrorResponse("'amount' is required for adjust action (the target balance in dollars)");
                }
                const accountId = await resolveAccountId(account, budget, profile);
                // Get current account balance
                const accountResponse = await api.accounts.getAccountById(budgetId, accountId);
                const currentBalance = accountResponse.data.account.balance;
                const targetBalance = dollarsToMilliunits(amount);
                const adjustmentAmount = targetBalance - currentBalance;
                if (adjustmentAmount === 0) {
                    return createResponse({
                        success: true,
                        message: "No adjustment needed - balance already matches target",
                        currentBalance: currentBalance / 1000,
                        targetBalance: amount
                    });
                }
                const transaction = {
                    account_id: accountId,
                    amount: adjustmentAmount,
                    date: formatDate(date || new Date()),
                    payee_name: "Balance Adjustment",
                    memo: memo || `Adjustment to ${amount}`,
                    cleared: ynab.TransactionClearedStatus.Cleared,
                    approved: true,
                };
                const response = await api.transactions.createTransaction(budgetId, { transaction });
                const created = response.data.transaction;
                if (!created) {
                    return createErrorResponse("Adjustment created but no data returned");
                }
                return createResponse({
                    success: true,
                    message: "Balance adjustment created",
                    previousBalance: currentBalance / 1000,
                    newBalance: amount,
                    adjustment: adjustmentAmount / 1000,
                    transaction: formatTransaction({
                        ...created,
                        payee_name: created.payee_name ?? null,
                        category_name: created.category_name ?? null,
                        memo: created.memo ?? null
                    }, currencyCode)
                });
            }
            case "bulk_approve": {
                if (!transaction_ids || transaction_ids.length === 0) {
                    return createErrorResponse("'transaction_ids' array is required for bulk_approve action");
                }
                const transactions = transaction_ids.map(id => ({
                    id,
                    approved: true
                }));
                const response = await api.transactions.updateTransactions(budgetId, { transactions });
                if (!response.data.transactions) {
                    return createErrorResponse("Failed to update transactions - no data returned");
                }
                const updated = response.data.transactions.map(t => ({
                    id: t.id,
                    date: t.date,
                    amount: (t.amount / 1000).toFixed(2),
                    payee: t.payee_name,
                    approved: t.approved
                }));
                return createResponse({
                    success: true,
                    message: `Approved ${updated.length} transaction(s)`,
                    approved_count: updated.length,
                    transactions: updated
                });
            }
            case "import": {
                const response = await api.transactions.importTransactions(budgetId);
                return createResponse({
                    success: true,
                    transaction_ids: response.data.transaction_ids,
                    imported_count: response.data.transaction_ids.length,
                    message: response.data.transaction_ids.length > 0
                        ? `Imported ${response.data.transaction_ids.length} transaction(s) from linked accounts`
                        : "No new transactions to import"
                });
            }
            case "create_scheduled": {
                if (!account) {
                    return createErrorResponse("'account' is required for create_scheduled action");
                }
                if (!date) {
                    return createErrorResponse("'date' is required for create_scheduled action (first occurrence, YYYY-MM-DD)");
                }
                const accountId = await resolveAccountId(account, budget, profile);
                const scheduledTx = {
                    account_id: accountId,
                    date: formatDate(date),
                    amount: amount !== undefined ? dollarsToMilliunits(amount) : undefined,
                    frequency: frequency || undefined,
                    memo: memo || undefined,
                };
                if (payee) {
                    const payeeId = await resolvePayeeId(payee, budget, profile);
                    if (payeeId.includes('-')) {
                        scheduledTx.payee_id = payeeId;
                    }
                    else {
                        scheduledTx.payee_name = payee;
                    }
                }
                if (category) {
                    scheduledTx.category_id = await resolveCategoryId(category, budget, profile);
                }
                const response = await api.scheduledTransactions.createScheduledTransaction(budgetId, { scheduled_transaction: scheduledTx });
                const created = response.data.scheduled_transaction;
                return createResponse({
                    success: true,
                    message: "Scheduled transaction created",
                    scheduled_transaction: {
                        id: created.id,
                        date_first: created.date_first,
                        date_next: created.date_next,
                        frequency: created.frequency,
                        amount: (created.amount / 1000).toFixed(2),
                        account: created.account_name,
                        payee: created.payee_name,
                        category: created.category_name,
                        memo: created.memo,
                        flag: created.flag_color
                    }
                });
            }
            case "update_scheduled": {
                if (!transaction_id) {
                    return createErrorResponse("'transaction_id' (scheduled transaction ID) is required for update_scheduled action");
                }
                // Get existing scheduled transaction to preserve required fields
                const existingSchedResponse = await api.scheduledTransactions.getScheduledTransactionById(budgetId, transaction_id);
                const existingSched = existingSchedResponse.data.scheduled_transaction;
                const scheduledUpdate = {
                    account_id: account ? await resolveAccountId(account, budget, profile) : existingSched.account_id,
                    date: date ? formatDate(date) : existingSched.date_next,
                };
                if (amount !== undefined) {
                    scheduledUpdate.amount = dollarsToMilliunits(amount);
                }
                if (frequency) {
                    scheduledUpdate.frequency = frequency;
                }
                if (memo !== undefined) {
                    scheduledUpdate.memo = memo || undefined;
                }
                if (payee) {
                    const payeeId = await resolvePayeeId(payee, budget, profile);
                    if (payeeId.includes('-')) {
                        scheduledUpdate.payee_id = payeeId;
                    }
                    else {
                        scheduledUpdate.payee_name = payee;
                    }
                }
                if (category) {
                    scheduledUpdate.category_id = await resolveCategoryId(category, budget, profile);
                }
                const response = await api.scheduledTransactions.updateScheduledTransaction(budgetId, transaction_id, { scheduled_transaction: scheduledUpdate });
                const updated = response.data.scheduled_transaction;
                return createResponse({
                    success: true,
                    message: "Scheduled transaction updated",
                    scheduled_transaction: {
                        id: updated.id,
                        date_first: updated.date_first,
                        date_next: updated.date_next,
                        frequency: updated.frequency,
                        amount: (updated.amount / 1000).toFixed(2),
                        account: updated.account_name,
                        payee: updated.payee_name,
                        category: updated.category_name,
                        memo: updated.memo,
                        flag: updated.flag_color
                    }
                });
            }
            case "delete_scheduled": {
                if (!transaction_id) {
                    return createErrorResponse("'transaction_id' (scheduled transaction ID) is required for delete_scheduled action");
                }
                await api.scheduledTransactions.deleteScheduledTransaction(budgetId, transaction_id);
                return createResponse({
                    success: true,
                    message: "Scheduled transaction deleted",
                    transaction_id
                });
            }
            case "suggest_categories": {
                // History-based only: the most common category used for the same payee.
                const [txResponse, catResponse] = await Promise.all([
                    api.transactions.getTransactions(budgetId),
                    api.categories.getCategories(budgetId)
                ]);
                const usable = new Map(); // category id -> name
                for (const g of catResponse.data.category_groups) {
                    if (g.deleted || g.hidden)
                        continue;
                    for (const c of g.categories) {
                        if (!c.deleted && !c.hidden)
                            usable.set(c.id, c.name);
                    }
                }
                const live = txResponse.data.transactions.filter(t => !t.deleted && !t.transfer_account_id);
                const payeeKey = (t) => t.payee_name?.trim().toLowerCase() ?? "";
                const history = new Map();
                for (const t of live) {
                    const key = payeeKey(t);
                    const isSplit = (t.subtransactions ?? []).some(sub => !sub.deleted);
                    if (!key || !t.category_id || isSplit || !usable.has(t.category_id))
                        continue;
                    if (isInflowCategory(t.category_name ?? ""))
                        continue;
                    const byCat = history.get(key) ?? new Map();
                    const entry = byCat.get(t.category_id) ?? { count: 0, lastDate: "" };
                    entry.count += 1;
                    if (t.date > entry.lastDate)
                        entry.lastDate = t.date;
                    byCat.set(t.category_id, entry);
                    history.set(key, byCat);
                }
                const candidates = live
                    .filter(t => !t.category_id && payeeKey(t) && !(t.subtransactions ?? []).some(sub => !sub.deleted))
                    .filter(t => !since_date || t.date >= since_date)
                    .sort((a, b) => b.date.localeCompare(a.date));
                const results = [];
                let unmatched = 0;
                for (const t of candidates) {
                    const byCat = history.get(payeeKey(t));
                    if (!byCat) {
                        unmatched++;
                        continue;
                    }
                    const ranked = [...byCat.entries()].sort((a, b) => b[1].count - a[1].count || b[1].lastDate.localeCompare(a[1].lastDate) || a[0].localeCompare(b[0]));
                    const [categoryId, top] = ranked[0];
                    const total = ranked.reduce((sum, [, v]) => sum + v.count, 0);
                    results.push({
                        transaction_id: t.id,
                        date: t.date,
                        payee: t.payee_name,
                        amount: formatAmount(t.amount, currencyCode),
                        suggested_category_id: categoryId,
                        suggested_category: usable.get(categoryId),
                        based_on: `${top.count} of ${total} past transactions for this payee`,
                        expected_content_fingerprint: contentFingerprint(t)
                    });
                }
                return createResponse({
                    budget: planResponse.data.plan.name,
                    currency: currencyCode,
                    source: "history (most common category for the same payee)",
                    uncategorized_checked: candidates.length,
                    suggestion_count: Math.min(results.length, limit),
                    without_history: unmatched,
                    suggestions: results.slice(0, limit),
                    note: "Nothing was changed. Review, then pass the suggestions you accept to apply_category_suggestions."
                });
            }
            case "apply_category_suggestions": {
                if (!suggestions || suggestions.length === 0) {
                    return createErrorResponse("'suggestions' array is required for apply_category_suggestions action");
                }
                if (suggestions.length > 100) {
                    return createErrorResponse("apply_category_suggestions accepts at most 100 suggestions per call");
                }
                // Writes only when dry_run is explicitly false.
                const isDryRun = dry_run !== false;
                const catResponse = await api.categories.getCategories(budgetId);
                const usable = new Map();
                for (const g of catResponse.data.category_groups) {
                    for (const c of g.categories)
                        if (!c.deleted)
                            usable.set(c.id, c.name);
                }
                const ok = [];
                const skipped = [];
                const seen = new Set();
                for (const sug of suggestions) {
                    if (seen.has(sug.transaction_id)) {
                        skipped.push({ transaction_id: sug.transaction_id, reason: "duplicate suggestion for this transaction" });
                        continue;
                    }
                    seen.add(sug.transaction_id);
                    const categoryName = usable.get(sug.category_id);
                    if (!categoryName) {
                        skipped.push({ transaction_id: sug.transaction_id, reason: `category '${sug.category_id}' not found` });
                        continue;
                    }
                    let t;
                    try {
                        t = (await api.transactions.getTransactionById(budgetId, sug.transaction_id)).data.transaction;
                    }
                    catch (error) {
                        skipped.push({ transaction_id: sug.transaction_id, reason: `could not load transaction: ${getErrorMessage(error)}` });
                        continue;
                    }
                    if (t.deleted) {
                        skipped.push({ transaction_id: sug.transaction_id, reason: "transaction was deleted" });
                    }
                    else if (contentFingerprint(t) !== sug.expected_content_fingerprint) {
                        skipped.push({ transaction_id: sug.transaction_id, reason: "transaction changed since it was suggested (fingerprint mismatch); run suggest_categories again" });
                    }
                    else if (t.category_id || (t.subtransactions ?? []).some(sub => !sub.deleted)) {
                        skipped.push({ transaction_id: sug.transaction_id, reason: "transaction is already categorized or split" });
                    }
                    else {
                        ok.push({
                            transaction_id: t.id, category_id: sug.category_id, category: categoryName,
                            payee: t.payee_name, date: t.date, amount: formatAmount(t.amount, currencyCode)
                        });
                    }
                }
                if (!isDryRun && ok.length > 0) {
                    await api.transactions.updateTransactions(budgetId, {
                        transactions: ok.map(o => ({ id: o.transaction_id, category_id: o.category_id }))
                    });
                }
                return createResponse({
                    success: true,
                    dry_run: isDryRun,
                    message: isDryRun
                        ? `Would categorize ${ok.length} transaction(s), skip ${skipped.length}. Nothing was written; pass dry_run: false to apply.`
                        : `Categorized ${ok.length} transaction(s), skipped ${skipped.length}`,
                    applied_count: isDryRun ? 0 : ok.length,
                    [isDryRun ? "would_apply" : "applied"]: ok,
                    skipped
                });
            }
            default:
                return createErrorResponse(`Unknown action: ${action}. Use: create, update, delete, approve, bulk_approve, adjust, import, create_scheduled, update_scheduled, delete_scheduled, suggest_categories, apply_category_suggestions`);
        }
    }
    catch (error) {
        console.error("Error in ynab_transactions_write:", error);
        return createErrorResponse(getErrorMessage(error));
    }
}
