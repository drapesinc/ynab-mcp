/**
 * ynab_categories_write - Category mutation operations
 * Actions: update, move
 */

import { z } from "zod";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolveCategoryId } from "../utils/resolver.js";
import { formatAmount, dollarsToMilliunits, createResponse, createErrorResponse } from "../utils/formatter.js";

export const name = "ynab_categories_write";
export const description = `Category mutation operations for YNAB. Actions:
- update: Set budgeted amount for a category in a specific month
- move: Move funds between categories`;

export const inputSchema = {
  action: z.enum(["update", "move"]).describe("Action to perform"),
  profile: z.string().optional().describe("Profile name (optional, uses default)"),
  budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
  category: z.string().optional().describe("Category name or ID (for 'update' action)"),
  from_category: z.string().optional().describe("Source category name or ID (for 'move' action)"),
  to_category: z.string().optional().describe("Target category name or ID (for 'move' action)"),
  amount: z.number().optional().describe("Amount in dollars"),
  month: z.string().optional().describe("Month in YYYY-MM-DD format (defaults to current month)")
};

interface ExecuteInput {
  action: string;
  profile?: string;
  budget?: string;
  category?: string;
  from_category?: string;
  to_category?: string;
  amount?: number;
  month?: string;
}

export async function execute(input: ExecuteInput) {
  try {
    const { action, profile, budget, category, from_category, to_category, amount, month } = input;

    const api = getApiClient(profile);
    const budgetId = resolveBudgetId(budget, profile);

    // Get budget currency
    const budgetResponse = await api.budgets.getBudgetById(budgetId);
    const currencyCode = budgetResponse.data.budget.currency_format?.iso_code || 'USD';

    const targetMonth = month || new Date().toISOString().slice(0, 7) + "-01";

    switch (action) {
      case "update": {
        if (!category) {
          return createErrorResponse("'category' is required for 'update' action");
        }
        if (amount === undefined) {
          return createErrorResponse("'amount' is required for 'update' action");
        }

        const categoryId = await resolveCategoryId(category, budget, profile);

        const response = await api.categories.updateMonthCategory(budgetId, targetMonth, categoryId, {
          category: {
            budgeted: dollarsToMilliunits(amount)
          }
        });

        const c = response.data.category;

        return createResponse({
          success: true,
          message: `Category budget updated for ${targetMonth}`,
          category: {
            id: c.id,
            name: c.name,
            budgeted: formatAmount(c.budgeted, currencyCode),
            activity: formatAmount(c.activity, currencyCode),
            balance: formatAmount(c.balance, currencyCode)
          }
        });
      }

      case "move": {
        if (!from_category) {
          return createErrorResponse("'from_category' is required for 'move' action");
        }
        if (!to_category) {
          return createErrorResponse("'to_category' is required for 'move' action");
        }
        if (amount === undefined || amount <= 0) {
          return createErrorResponse("'amount' must be a positive number for 'move' action");
        }

        const fromCategoryId = await resolveCategoryId(from_category, budget, profile);
        const toCategoryId = await resolveCategoryId(to_category, budget, profile);
        const milliunits = dollarsToMilliunits(amount);

        // Get current values
        const [fromResponse, toResponse] = await Promise.all([
          api.categories.getMonthCategoryById(budgetId, targetMonth, fromCategoryId),
          api.categories.getMonthCategoryById(budgetId, targetMonth, toCategoryId)
        ]);

        const fromCurrent = fromResponse.data.category.budgeted;
        const toCurrent = toResponse.data.category.budgeted;

        // Check if from category has enough
        if (fromCurrent < milliunits) {
          return createErrorResponse(
            `Insufficient funds in '${from_category}'. Available: ${formatAmount(fromCurrent, currencyCode)}, Requested: ${formatAmount(milliunits, currencyCode)}`
          );
        }

        // Update both categories
        const [updatedFrom, updatedTo] = await Promise.all([
          api.categories.updateMonthCategory(budgetId, targetMonth, fromCategoryId, {
            category: { budgeted: fromCurrent - milliunits }
          }),
          api.categories.updateMonthCategory(budgetId, targetMonth, toCategoryId, {
            category: { budgeted: toCurrent + milliunits }
          })
        ]);

        return createResponse({
          success: true,
          message: `Moved ${formatAmount(milliunits, currencyCode)} from '${from_category}' to '${to_category}'`,
          month: targetMonth,
          from: {
            name: updatedFrom.data.category.name,
            previousBudgeted: formatAmount(fromCurrent, currencyCode),
            newBudgeted: formatAmount(updatedFrom.data.category.budgeted, currencyCode),
            balance: formatAmount(updatedFrom.data.category.balance, currencyCode)
          },
          to: {
            name: updatedTo.data.category.name,
            previousBudgeted: formatAmount(toCurrent, currencyCode),
            newBudgeted: formatAmount(updatedTo.data.category.budgeted, currencyCode),
            balance: formatAmount(updatedTo.data.category.balance, currencyCode)
          }
        });
      }

      default:
        return createErrorResponse(`Unknown action: ${action}. Use: update, move`);
    }
  } catch (error) {
    console.error("Error in ynab_categories_write:", error);
    return createErrorResponse(error instanceof Error ? error.message : String(error));
  }
}
