/**
 * ynab_accounts - Account read operations
 * Actions: list, get, balances
 */

import { z } from "zod";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolveAccountId } from "../utils/resolver.js";
import { formatAmount, formatAccountType, createResponse, createErrorResponse } from "../utils/formatter.js";

export const name = "ynab_accounts";
export const description = `Account read operations for YNAB. Actions:
- list: List accounts with optional filters (type, on_budget, closed)
- get: Get single account details
- balances: Quick balance summary for all/filtered accounts`;

export const inputSchema = {
  action: z.enum(["list", "get", "balances"]).describe("Action to perform"),
  profile: z.string().optional().describe("Profile name (optional, uses default)"),
  budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
  account: z.string().optional().describe("Account name or ID (for 'get' action)"),
  type: z.enum(["checking", "savings", "cash", "creditCard", "lineOfCredit", "otherAsset", "otherLiability", "mortgage", "autoLoan", "studentLoan", "personalLoan", "medicalDebt", "otherDebt"]).optional().describe("Filter by account type"),
  on_budget: z.boolean().optional().describe("Filter: true for budget accounts, false for tracking"),
  include_closed: z.boolean().optional().describe("Include closed accounts (default: false)")
};

interface ExecuteInput {
  action: string;
  profile?: string;
  budget?: string;
  account?: string;
  type?: string;
  on_budget?: boolean;
  include_closed?: boolean;
}

export async function execute(input: ExecuteInput) {
  try {
    const { action, profile, budget, account, type, on_budget, include_closed = false } = input;
    const api = getApiClient(profile);
    const budgetId = resolveBudgetId(budget, profile);

    // Get budget currency for formatting
    const budgetResponse = await api.budgets.getBudgetById(budgetId);
    const currencyCode = budgetResponse.data.budget.currency_format?.iso_code || 'USD';

    switch (action) {
      case "list": {
        const response = await api.accounts.getAccounts(budgetId);
        let accounts = response.data.accounts;

        // Apply filters
        if (!include_closed) {
          accounts = accounts.filter(a => !a.closed);
        }
        if (type) {
          accounts = accounts.filter(a => a.type === type);
        }
        if (on_budget !== undefined) {
          accounts = accounts.filter(a => a.on_budget === on_budget);
        }

        const formatted = accounts.map(a => ({
          id: a.id,
          name: a.name,
          type: formatAccountType(a.type),
          balance: formatAmount(a.balance, currencyCode),
          clearedBalance: formatAmount(a.cleared_balance, currencyCode),
          unclearedBalance: formatAmount(a.uncleared_balance, currencyCode),
          onBudget: a.on_budget,
          closed: a.closed,
          deleted: a.deleted
        }));

        return createResponse({
          budget: budgetResponse.data.budget.name,
          currency: currencyCode,
          count: formatted.length,
          accounts: formatted
        });
      }

      case "get": {
        if (!account) {
          return createErrorResponse("'account' parameter required for 'get' action");
        }

        const accountId = await resolveAccountId(account, budget, profile);
        const response = await api.accounts.getAccountById(budgetId, accountId);
        const a = response.data.account;

        return createResponse({
          id: a.id,
          name: a.name,
          type: formatAccountType(a.type),
          balance: formatAmount(a.balance, currencyCode),
          clearedBalance: formatAmount(a.cleared_balance, currencyCode),
          unclearedBalance: formatAmount(a.uncleared_balance, currencyCode),
          onBudget: a.on_budget,
          closed: a.closed,
          note: a.note,
          lastReconciledAt: a.last_reconciled_at
        });
      }

      case "balances": {
        const response = await api.accounts.getAccounts(budgetId);
        let accounts = response.data.accounts.filter(a => !a.closed && !a.deleted);

        // Apply filters
        if (type) {
          accounts = accounts.filter(a => a.type === type);
        }
        if (on_budget !== undefined) {
          accounts = accounts.filter(a => a.on_budget === on_budget);
        }

        // Calculate totals
        let totalAssets = 0;
        let totalLiabilities = 0;

        const balances = accounts.map(a => {
          if (a.balance >= 0) {
            totalAssets += a.balance;
          } else {
            totalLiabilities += Math.abs(a.balance);
          }

          return {
            name: a.name,
            balance: formatAmount(a.balance, currencyCode),
            type: formatAccountType(a.type),
            onBudget: a.on_budget
          };
        });

        return createResponse({
          budget: budgetResponse.data.budget.name,
          currency: currencyCode,
          netWorth: formatAmount(totalAssets - totalLiabilities, currencyCode),
          totalAssets: formatAmount(totalAssets, currencyCode),
          totalLiabilities: formatAmount(totalLiabilities, currencyCode),
          accounts: balances
        });
      }

      default:
        return createErrorResponse(`Unknown action: ${action}. Use: list, get, balances`);
    }
  } catch (error) {
    console.error("Error in ynab_accounts:", error);
    return createErrorResponse(error instanceof Error ? error.message : String(error));
  }
}
