/**
 * ynab_transactions_read - Transaction query operations
 * Actions: list, search, unapproved
 */
import { z } from "zod";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolveAccountId, resolveCategoryId } from "../utils/resolver.js";
import { formatTransaction, dollarsToMilliunits, createResponse, createErrorResponse } from "../utils/formatter.js";
export const name = "ynab_transactions_read";
export const description = `Transaction query operations for YNAB. Actions:
- list: Filter transactions by date, account, category, payee, status, amount
- search: Fuzzy search by payee or memo
- unapproved: Get pending/unapproved transactions
- scheduled: List recurring/scheduled transactions`;
export const inputSchema = {
    action: z.enum(["list", "search", "unapproved", "scheduled"]).describe("Action to perform"),
    profile: z.string().optional().describe("Profile name (optional, uses default)"),
    budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
    account: z.string().optional().describe("Filter by account name or ID"),
    category: z.string().optional().describe("Filter by category name or ID"),
    since_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    until_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
    payee: z.string().optional().describe("Filter by payee name (partial match)"),
    memo: z.string().optional().describe("Search memo field (partial match)"),
    status: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Filter by cleared status"),
    type: z.enum(["unapproved", "uncategorized"]).optional().describe("Filter by transaction type"),
    min_amount: z.number().optional().describe("Minimum amount in dollars (negative for outflows)"),
    max_amount: z.number().optional().describe("Maximum amount in dollars"),
    limit: z.number().optional().describe("Maximum transactions to return (default: 50)")
};
export async function execute(input) {
    try {
        const { action, profile, budget, account, category, since_date, until_date, payee, memo, status, type, min_amount, max_amount, limit = 50 } = input;
        const api = getApiClient(profile);
        const budgetId = resolveBudgetId(budget, profile);
        // Get budget currency
        const budgetResponse = await api.budgets.getBudgetById(budgetId);
        const currencyCode = budgetResponse.data.budget.currency_format?.iso_code || 'USD';
        switch (action) {
            case "list":
            case "search": {
                let transactions;
                // Use account-specific endpoint if account filter provided
                if (account) {
                    const accountId = await resolveAccountId(account, budget, profile);
                    const response = await api.transactions.getTransactionsByAccount(budgetId, accountId, since_date);
                    transactions = response.data.transactions;
                }
                else {
                    const response = await api.transactions.getTransactions(budgetId, since_date);
                    transactions = response.data.transactions;
                }
                // Apply filters
                if (until_date) {
                    transactions = transactions.filter(t => t.date <= until_date);
                }
                if (category) {
                    const categoryId = await resolveCategoryId(category, budget, profile);
                    transactions = transactions.filter(t => t.category_id === categoryId);
                }
                if (payee) {
                    const payeeLower = payee.toLowerCase();
                    transactions = transactions.filter(t => t.payee_name?.toLowerCase().includes(payeeLower));
                }
                if (memo) {
                    const memoLower = memo.toLowerCase();
                    transactions = transactions.filter(t => t.memo?.toLowerCase().includes(memoLower));
                }
                if (status) {
                    transactions = transactions.filter(t => t.cleared === status);
                }
                if (type === "unapproved") {
                    transactions = transactions.filter(t => !t.approved);
                }
                else if (type === "uncategorized") {
                    transactions = transactions.filter(t => !t.category_id);
                }
                if (min_amount !== undefined) {
                    const minMilliunits = dollarsToMilliunits(min_amount);
                    transactions = transactions.filter(t => t.amount >= minMilliunits);
                }
                if (max_amount !== undefined) {
                    const maxMilliunits = dollarsToMilliunits(max_amount);
                    transactions = transactions.filter(t => t.amount <= maxMilliunits);
                }
                // Sort by date descending and limit
                transactions = transactions
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, limit);
                const formatted = transactions.map(t => formatTransaction({
                    ...t,
                    payee_name: t.payee_name ?? null,
                    category_name: t.category_name ?? null,
                    memo: t.memo ?? null
                }, currencyCode));
                return createResponse({
                    budget: budgetResponse.data.budget.name,
                    currency: currencyCode,
                    count: formatted.length,
                    transactions: formatted
                });
            }
            case "unapproved": {
                let transactions;
                if (account) {
                    const accountId = await resolveAccountId(account, budget, profile);
                    const response = await api.transactions.getTransactionsByAccount(budgetId, accountId);
                    transactions = response.data.transactions;
                }
                else {
                    const response = await api.transactions.getTransactions(budgetId);
                    transactions = response.data.transactions;
                }
                // Filter to unapproved only
                transactions = transactions
                    .filter(t => !t.approved)
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, limit);
                const formatted = transactions.map(t => formatTransaction({
                    ...t,
                    payee_name: t.payee_name ?? null,
                    category_name: t.category_name ?? null,
                    memo: t.memo ?? null
                }, currencyCode));
                return createResponse({
                    budget: budgetResponse.data.budget.name,
                    currency: currencyCode,
                    count: formatted.length,
                    note: "These transactions need approval",
                    transactions: formatted
                });
            }
            case "scheduled": {
                const response = await api.scheduledTransactions.getScheduledTransactions(budgetId);
                const scheduled = response.data.scheduled_transactions
                    .filter(t => !t.deleted)
                    .map(t => ({
                    id: t.id,
                    date_first: t.date_first,
                    date_next: t.date_next,
                    frequency: t.frequency,
                    amount: (t.amount / 1000).toFixed(2),
                    account: t.account_name,
                    payee: t.payee_name,
                    category: t.category_name,
                    memo: t.memo,
                    flag: t.flag_color
                }));
                return createResponse({
                    budget: budgetResponse.data.budget.name,
                    currency: currencyCode,
                    count: scheduled.length,
                    scheduled_transactions: scheduled
                });
            }
            default:
                return createErrorResponse(`Unknown action: ${action}. Use: list, search, unapproved, scheduled`);
        }
    }
    catch (error) {
        console.error("Error in ynab_transactions_read:", error);
        return createErrorResponse(error instanceof Error ? error.message : String(error));
    }
}
