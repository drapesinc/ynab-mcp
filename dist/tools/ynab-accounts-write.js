/**
 * ynab_accounts_write - Account mutation operations
 * Actions: create, reconcile
 */
import { z } from "zod";
import * as ynab from "ynab";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolveAccountId } from "../utils/resolver.js";
import { formatAmount, formatAccountType, dollarsToMilliunits, createResponse, createErrorResponse } from "../utils/formatter.js";
export const name = "ynab_accounts_write";
export const description = `Account mutation operations for YNAB. Actions:
- create: Create a new account
- reconcile: Mark account as reconciled (creates adjustment if needed)`;
export const inputSchema = {
    action: z.enum(["create", "reconcile"]).describe("Action to perform"),
    profile: z.string().optional().describe("Profile name (optional, uses default)"),
    budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
    account: z.string().optional().describe("Account name or ID (for 'reconcile' action)"),
    name: z.string().optional().describe("Account name (for 'create' action)"),
    type: z.enum(["checking", "savings", "cash", "creditCard", "lineOfCredit", "otherAsset", "otherLiability", "mortgage", "autoLoan", "studentLoan", "personalLoan", "medicalDebt", "otherDebt"]).optional().describe("Account type (for 'create' action)"),
    balance: z.number().optional().describe("Starting balance in dollars (for 'create') or target balance (for 'reconcile')"),
    note: z.string().optional().describe("Account note")
};
export async function execute(input) {
    try {
        const { action, profile, budget, account, name: accountName, type, balance, note } = input;
        const api = getApiClient(profile);
        const budgetId = resolveBudgetId(budget, profile);
        // Get budget currency
        const budgetResponse = await api.budgets.getBudgetById(budgetId);
        const currencyCode = budgetResponse.data.budget.currency_format?.iso_code || 'USD';
        switch (action) {
            case "create": {
                if (!accountName) {
                    return createErrorResponse("'name' is required for 'create' action");
                }
                if (!type) {
                    return createErrorResponse("'type' is required for 'create' action");
                }
                const newAccount = {
                    name: accountName,
                    type: type,
                    balance: balance !== undefined ? dollarsToMilliunits(balance) : 0,
                };
                const response = await api.accounts.createAccount(budgetId, { account: newAccount });
                const created = response.data.account;
                return createResponse({
                    success: true,
                    message: "Account created",
                    account: {
                        id: created.id,
                        name: created.name,
                        type: formatAccountType(created.type),
                        balance: formatAmount(created.balance, currencyCode),
                        onBudget: created.on_budget
                    }
                });
            }
            case "reconcile": {
                if (!account) {
                    return createErrorResponse("'account' is required for 'reconcile' action");
                }
                if (balance === undefined) {
                    return createErrorResponse("'balance' is required for 'reconcile' action (the confirmed balance in dollars)");
                }
                const accountId = await resolveAccountId(account, budget, profile);
                // Get current account info
                const accountResponse = await api.accounts.getAccountById(budgetId, accountId);
                const accountData = accountResponse.data.account;
                const clearedBalance = accountData.cleared_balance;
                const targetBalance = dollarsToMilliunits(balance);
                const difference = targetBalance - clearedBalance;
                // If there's a difference, create an adjustment transaction
                if (difference !== 0) {
                    const adjustment = {
                        account_id: accountId,
                        amount: difference,
                        date: new Date().toISOString().split('T')[0],
                        payee_name: "Reconciliation Balance Adjustment",
                        memo: `Adjustment to reconcile balance to ${formatAmount(targetBalance, currencyCode)}`,
                        cleared: ynab.TransactionClearedStatus.Reconciled,
                        approved: true,
                    };
                    await api.transactions.createTransaction(budgetId, { transaction: adjustment });
                }
                return createResponse({
                    success: true,
                    message: difference === 0
                        ? "Account reconciled - balance matched"
                        : `Account reconciled with adjustment of ${formatAmount(difference, currencyCode)}`,
                    account: {
                        name: accountData.name,
                        previousClearedBalance: formatAmount(clearedBalance, currencyCode),
                        reconciledBalance: formatAmount(targetBalance, currencyCode),
                        adjustment: difference !== 0 ? formatAmount(difference, currencyCode) : null
                    },
                    note: "All cleared transactions should now be marked as reconciled in YNAB"
                });
            }
            default:
                return createErrorResponse(`Unknown action: ${action}. Use: create, reconcile`);
        }
    }
    catch (error) {
        console.error("Error in ynab_accounts_write:", error);
        return createErrorResponse(error instanceof Error ? error.message : String(error));
    }
}
