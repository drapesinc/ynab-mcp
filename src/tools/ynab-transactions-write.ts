/**
 * ynab_transactions_write - Transaction mutation operations
 * Actions: create, update, delete, approve, adjust
 */

import { z } from "zod";
import * as ynab from "ynab";
import { getApiClient, resolveBudgetId, getDefaultAccount } from "../utils/profile-manager.js";
import { resolveAccountId, resolveCategoryId, resolvePayeeId } from "../utils/resolver.js";
import { formatTransaction, dollarsToMilliunits, formatDate, createResponse, createErrorResponse } from "../utils/formatter.js";

export const name = "ynab_transactions_write";
export const description = `Transaction mutation operations for YNAB. Actions:
- create: Create transaction (with optional split support)
- update: Update existing transaction
- delete: Delete transaction
- approve: Approve or unapprove transaction
- adjust: Create balance adjustment for tracking accounts`;

export const inputSchema = {
  action: z.enum(["create", "update", "delete", "approve", "adjust"]).describe("Action to perform"),
  profile: z.string().optional().describe("Profile name (optional, uses default)"),
  budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
  account: z.string().optional().describe("Account name or ID"),
  transaction_id: z.string().optional().describe("Transaction ID (for update, delete, approve)"),
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
  })).optional().describe("Split transaction categories")
};

interface ExecuteInput {
  action: string;
  profile?: string;
  budget?: string;
  account?: string;
  transaction_id?: string;
  amount?: number;
  payee?: string;
  category?: string;
  memo?: string;
  date?: string;
  cleared?: string;
  approved?: boolean;
  splits?: Array<{ amount: number; category: string; memo?: string }>;
}

export async function execute(input: ExecuteInput) {
  try {
    const {
      action, profile, budget, account, transaction_id,
      amount, payee, category, memo, date, cleared, approved, splits
    } = input;

    const api = getApiClient(profile);
    const budgetId = resolveBudgetId(budget, profile);

    // Get budget currency
    const budgetResponse = await api.budgets.getBudgetById(budgetId);
    const currencyCode = budgetResponse.data.budget.currency_format?.iso_code || 'USD';

    switch (action) {
      case "create": {
        // Resolve account - use default if not specified
        let accountId: string;
        if (account) {
          accountId = await resolveAccountId(account, budget, profile);
        } else {
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
        const transaction: ynab.NewTransaction = {
          account_id: accountId,
          amount: dollarsToMilliunits(amount),
          date: formatDate(date || new Date()),
          cleared: (cleared as ynab.TransactionClearedStatus) || ynab.TransactionClearedStatus.Uncleared,
          approved: true,
        };

        // Resolve payee
        if (payee) {
          const payeeId = await resolvePayeeId(payee, budget, profile);
          if (payeeId.includes('-')) {
            transaction.payee_id = payeeId;
          } else {
            transaction.payee_name = payee;
          }
        }

        // Handle splits or single category
        if (splits && splits.length > 0) {
          const subtransactions: ynab.SaveSubTransaction[] = [];
          for (const split of splits) {
            const catId = await resolveCategoryId(split.category, budget, profile);
            subtransactions.push({
              amount: dollarsToMilliunits(split.amount),
              category_id: catId,
              memo: split.memo
            });
          }
          transaction.subtransactions = subtransactions;
        } else if (category) {
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

        // Build update
        const update: ynab.SaveTransactionWithOptionalFields = {
          account_id: existing.account_id,
          amount: amount !== undefined ? dollarsToMilliunits(amount) : existing.amount,
          date: date ? formatDate(date) : existing.date,
          cleared: (cleared as ynab.TransactionClearedStatus) || existing.cleared as ynab.TransactionClearedStatus,
          approved: approved !== undefined ? approved : existing.approved,
        };

        if (account) {
          update.account_id = await resolveAccountId(account, budget, profile);
        }

        if (payee) {
          const payeeId = await resolvePayeeId(payee, budget, profile);
          if (payeeId.includes('-')) {
            update.payee_id = payeeId;
          } else {
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

        // Get existing transaction
        const existingResponse = await api.transactions.getTransactionById(budgetId, transaction_id);
        const existing = existingResponse.data.transaction;

        const update: ynab.SaveTransactionWithOptionalFields = {
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

        const transaction: ynab.NewTransaction = {
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

      default:
        return createErrorResponse(`Unknown action: ${action}. Use: create, update, delete, approve, adjust`);
    }
  } catch (error) {
    console.error("Error in ynab_transactions_write:", error);
    return createErrorResponse(error instanceof Error ? error.message : String(error));
  }
}
