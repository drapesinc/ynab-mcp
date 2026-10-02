/**
 * ynab_transactions_read - Transaction query operations
 * Actions: list, search, unapproved, scheduled, spending_by_category, spending_by_payee, cash_flow
 */
import { z } from "zod";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolveAccountId, resolveCategoryId } from "../utils/resolver.js";
import { toEntries, isInflowCategory } from "../utils/spending.js";
import { formatAmount, formatTransaction, dollarsToMilliunits, createResponse, createErrorResponse, getErrorMessage } from "../utils/formatter.js";
export const name = "ynab_transactions_read";
export const description = `Transaction query operations for YNAB. Actions:
- list: Filter transactions by date, month, account, category, payee, status, amount
- search: Fuzzy search by payee or memo
- unapproved: Get pending/unapproved transactions
- scheduled: List recurring/scheduled transactions
- spending_by_category: Net spending per category (since_date/until_date, default this month; limit = top N rows)
- spending_by_payee: Net spending per payee (same options)
- cash_flow: Inflow, outflow and net per month (months, default 6, or since_date/until_date)
Spending reports count split transactions by leg and leave transfers between accounts out.`;
export const inputSchema = {
    action: z.enum(["list", "search", "unapproved", "scheduled", "spending_by_category", "spending_by_payee", "cash_flow"]).describe("Action to perform"),
    profile: z.string().optional().describe("Profile name (optional, uses default)"),
    budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
    account: z.string().optional().describe("Filter by account name or ID"),
    category: z.string().optional().describe("Filter by category name or ID"),
    month: z.string().optional().describe("Get transactions for a specific month (YYYY-MM-DD format, e.g. 2026-03-01). When provided, fetches via month-specific endpoint."),
    since_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    until_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
    payee: z.string().optional().describe("Filter by payee name (partial match)"),
    memo: z.string().optional().describe("Search memo field (partial match)"),
    status: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Filter by cleared status"),
    type: z.enum(["unapproved", "uncategorized"]).optional().describe("Filter by transaction type"),
    min_amount: z.number().optional().describe("Minimum amount in dollars (negative for outflows)"),
    max_amount: z.number().optional().describe("Maximum amount in dollars"),
    limit: z.number().optional().describe("Maximum transactions to return (default: 50); for spending reports, the maximum rows (top spenders first)"),
    months: z.number().optional().describe("Number of months to cover, ending with the current month (for 'cash_flow'; default 6)")
};
/** First day of the month `monthsBack` months ago (YYYY-MM-01), by the server's UTC clock. */
function monthsAgoStart(monthsBack) {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
    return d.toISOString().slice(0, 10);
}
function currentMonthStart() {
    return monthsAgoStart(0);
}
export async function execute(input) {
    try {
        const { action, profile, budget, account, category, month, since_date, until_date, payee, memo, status, type, min_amount, max_amount, limit = 50, months } = input;
        const api = getApiClient(profile);
        const budgetId = resolveBudgetId(budget, profile);
        // Get budget currency
        const planResponse = await api.plans.getPlanById(budgetId);
        const currencyCode = planResponse.data.plan.currency_format?.iso_code || 'USD';
        switch (action) {
            case "list":
            case "search": {
                let transactions;
                // Use month-specific endpoint if month filter provided
                if (month) {
                    const response = await api.transactions.getTransactionsByMonth(budgetId, month);
                    transactions = response.data.transactions;
                }
                else if (account) {
                    // Use account-specific endpoint if account filter provided
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
                    budget: planResponse.data.plan.name,
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
                    budget: planResponse.data.plan.name,
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
                    budget: planResponse.data.plan.name,
                    currency: currencyCode,
                    count: scheduled.length,
                    scheduled_transactions: scheduled
                });
            }
            case "spending_by_category":
            case "spending_by_payee": {
                const from = since_date ?? currentMonthStart();
                const response = await api.transactions.getTransactions(budgetId, from);
                const entries = toEntries(response.data.transactions)
                    .filter(e => e.date >= from && (!until_date || e.date <= until_date))
                    .filter(e => !isInflowCategory(e.category));
                const key = action === "spending_by_category" ? "category" : "payee";
                const totals = new Map();
                for (const e of entries) {
                    const row = totals.get(e[key]) ?? { spent: 0, count: 0 };
                    row.spent += -e.amount; // outflow positive, refunds reduce it
                    row.count += 1;
                    totals.set(e[key], row);
                }
                const all = [...totals.entries()]
                    .filter(([, v]) => v.spent > 0)
                    .sort((a, b) => b[1].spent - a[1].spent || a[0].localeCompare(b[0]));
                const totalSpent = all.reduce((sum, [, v]) => sum + v.spent, 0);
                const shown = all.slice(0, limit);
                return createResponse({
                    budget: planResponse.data.plan.name,
                    currency: currencyCode,
                    since_date: from,
                    until_date: until_date ?? null,
                    totalSpent: formatAmount(totalSpent, currencyCode),
                    rowCount: all.length,
                    shown: shown.length,
                    [action === "spending_by_category" ? "categories" : "payees"]: shown.map(([name, v]) => ({
                        name,
                        spent: formatAmount(v.spent, currencyCode),
                        transactions: v.count,
                        percentOfTotal: totalSpent > 0 ? Math.round((v.spent / totalSpent) * 1000) / 10 : 0
                    })),
                    note: "Net spending (outflows minus refunds). Splits counted by leg; transfers and Ready to Assign inflows left out."
                });
            }
            case "cash_flow": {
                if (months !== undefined && (!Number.isInteger(months) || months < 1 || months > 60)) {
                    return createErrorResponse("'months' must be a whole number between 1 and 60 for 'cash_flow' action");
                }
                const from = since_date ?? monthsAgoStart((months ?? 6) - 1);
                const response = await api.transactions.getTransactions(budgetId, from);
                const entries = toEntries(response.data.transactions)
                    .filter(e => e.date >= from && (!until_date || e.date <= until_date));
                const byMonth = new Map();
                for (const e of entries) {
                    const m = e.date.slice(0, 7);
                    const row = byMonth.get(m) ?? { inflow: 0, outflow: 0 };
                    if (e.amount >= 0)
                        row.inflow += e.amount;
                    else
                        row.outflow += -e.amount;
                    byMonth.set(m, row);
                }
                const rows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
                const inflow = rows.reduce((sum, [, v]) => sum + v.inflow, 0);
                const outflow = rows.reduce((sum, [, v]) => sum + v.outflow, 0);
                return createResponse({
                    budget: planResponse.data.plan.name,
                    currency: currencyCode,
                    since_date: from,
                    until_date: until_date ?? null,
                    totals: {
                        inflow: formatAmount(inflow, currencyCode),
                        outflow: formatAmount(outflow, currencyCode),
                        net: formatAmount(inflow - outflow, currencyCode)
                    },
                    months: rows.map(([m, v]) => ({
                        month: m,
                        inflow: formatAmount(v.inflow, currencyCode),
                        outflow: formatAmount(v.outflow, currencyCode),
                        net: formatAmount(v.inflow - v.outflow, currencyCode)
                    })),
                    note: "Splits counted by leg; transfers between accounts left out."
                });
            }
            default:
                return createErrorResponse(`Unknown action: ${action}. Use: list, search, unapproved, scheduled, spending_by_category, spending_by_payee, cash_flow`);
        }
    }
    catch (error) {
        console.error("Error in ynab_transactions_read:", error);
        return createErrorResponse(getErrorMessage(error));
    }
}
