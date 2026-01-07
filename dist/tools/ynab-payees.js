/**
 * ynab_payees - Payee operations
 * Actions: list, get, update
 */
import { z } from "zod";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolvePayeeId } from "../utils/resolver.js";
import { createResponse, createErrorResponse } from "../utils/formatter.js";
export const name = "ynab_payees";
export const description = `Payee operations for YNAB. Actions:
- list: List all payees
- get: Get payee details
- update: Rename a payee`;
export const inputSchema = {
    action: z.enum(["list", "get", "update"]).describe("Action to perform"),
    profile: z.string().optional().describe("Profile name (optional, uses default)"),
    budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
    payee: z.string().optional().describe("Payee name or ID (for 'get' and 'update' actions)"),
    new_name: z.string().optional().describe("New payee name (for 'update' action)"),
    search: z.string().optional().describe("Search term to filter payees (for 'list' action)"),
    limit: z.number().optional().describe("Maximum payees to return (default: 100)")
};
export async function execute(input) {
    try {
        const { action, profile, budget, payee, new_name, search, limit = 100 } = input;
        const api = getApiClient(profile);
        const budgetId = resolveBudgetId(budget, profile);
        // Get budget name for response
        const budgetResponse = await api.budgets.getBudgetById(budgetId);
        switch (action) {
            case "list": {
                const response = await api.payees.getPayees(budgetId);
                let payees = response.data.payees.filter(p => !p.deleted);
                // Apply search filter
                if (search) {
                    const searchLower = search.toLowerCase();
                    payees = payees.filter(p => p.name.toLowerCase().includes(searchLower));
                }
                // Limit results
                payees = payees.slice(0, limit);
                const formatted = payees.map(p => ({
                    id: p.id,
                    name: p.name,
                    transferAccountId: p.transfer_account_id || null
                }));
                return createResponse({
                    budget: budgetResponse.data.budget.name,
                    count: formatted.length,
                    payees: formatted
                });
            }
            case "get": {
                if (!payee) {
                    return createErrorResponse("'payee' is required for 'get' action");
                }
                // Resolve payee to get ID
                const payeeId = await resolvePayeeId(payee, budget, profile);
                // If it's not a UUID, the payee doesn't exist
                if (!payeeId.includes('-')) {
                    return createErrorResponse(`Payee '${payee}' not found`);
                }
                const response = await api.payees.getPayeeById(budgetId, payeeId);
                const p = response.data.payee;
                // Get recent transactions for this payee
                const transactionsResponse = await api.transactions.getTransactionsByPayee(budgetId, payeeId);
                const recentTransactions = transactionsResponse.data.transactions
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, 5);
                return createResponse({
                    payee: {
                        id: p.id,
                        name: p.name,
                        transferAccountId: p.transfer_account_id || null
                    },
                    recentTransactions: recentTransactions.map(t => ({
                        date: t.date,
                        amount: t.amount / 1000,
                        account: t.account_name,
                        category: t.category_name,
                        memo: t.memo
                    })),
                    totalTransactions: transactionsResponse.data.transactions.length
                });
            }
            case "update": {
                if (!payee) {
                    return createErrorResponse("'payee' is required for 'update' action");
                }
                if (!new_name) {
                    return createErrorResponse("'new_name' is required for 'update' action");
                }
                // Resolve payee to get ID
                const payeeId = await resolvePayeeId(payee, budget, profile);
                if (!payeeId.includes('-')) {
                    return createErrorResponse(`Payee '${payee}' not found`);
                }
                const response = await api.payees.updatePayee(budgetId, payeeId, {
                    payee: { name: new_name }
                });
                const updated = response.data.payee;
                return createResponse({
                    success: true,
                    message: `Payee renamed from '${payee}' to '${new_name}'`,
                    payee: {
                        id: updated.id,
                        name: updated.name
                    }
                });
            }
            default:
                return createErrorResponse(`Unknown action: ${action}. Use: list, get, update`);
        }
    }
    catch (error) {
        console.error("Error in ynab_payees:", error);
        return createErrorResponse(error instanceof Error ? error.message : String(error));
    }
}
