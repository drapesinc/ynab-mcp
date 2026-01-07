/**
 * ynab_categories_read - Category query operations
 * Actions: list, get
 */

import { z } from "zod";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolveCategoryId } from "../utils/resolver.js";
import { formatAmount, formatGoalType, createResponse, createErrorResponse } from "../utils/formatter.js";

export const name = "ynab_categories_read";
export const description = `Category query operations for YNAB. Actions:
- list: List all categories grouped by category group
- get: Get category budget details for specific month`;

export const inputSchema = {
  action: z.enum(["list", "get"]).describe("Action to perform"),
  profile: z.string().optional().describe("Profile name (optional, uses default)"),
  budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
  category: z.string().optional().describe("Category name or ID (for 'get' action)"),
  month: z.string().optional().describe("Month in YYYY-MM-DD format (defaults to current month)"),
  include_hidden: z.boolean().optional().describe("Include hidden categories (default: false)")
};

interface ExecuteInput {
  action: string;
  profile?: string;
  budget?: string;
  category?: string;
  month?: string;
  include_hidden?: boolean;
}

export async function execute(input: ExecuteInput) {
  try {
    const { action, profile, budget, category, month, include_hidden = false } = input;

    const api = getApiClient(profile);
    const budgetId = resolveBudgetId(budget, profile);

    // Get budget currency
    const budgetResponse = await api.budgets.getBudgetById(budgetId);
    const currencyCode = budgetResponse.data.budget.currency_format?.iso_code || 'USD';

    const targetMonth = month || new Date().toISOString().slice(0, 7) + "-01";

    switch (action) {
      case "list": {
        const response = await api.categories.getCategories(budgetId);

        const groups = response.data.category_groups
          .filter(g => !g.deleted && !g.hidden)
          .map(group => {
            let categories = group.categories
              .filter(c => !c.deleted && (include_hidden || !c.hidden));

            return {
              name: group.name,
              hidden: group.hidden,
              categories: categories.map(c => ({
                id: c.id,
                name: c.name,
                budgeted: formatAmount(c.budgeted, currencyCode),
                activity: formatAmount(c.activity, currencyCode),
                balance: formatAmount(c.balance, currencyCode),
                goalType: formatGoalType(c.goal_type),
                hidden: c.hidden
              }))
            };
          })
          .filter(g => g.categories.length > 0);

        // Calculate totals
        let totalBudgeted = 0;
        let totalActivity = 0;
        let totalBalance = 0;

        for (const group of response.data.category_groups) {
          for (const cat of group.categories) {
            if (!cat.deleted) {
              totalBudgeted += cat.budgeted;
              totalActivity += cat.activity;
              totalBalance += cat.balance;
            }
          }
        }

        return createResponse({
          budget: budgetResponse.data.budget.name,
          currency: currencyCode,
          totals: {
            budgeted: formatAmount(totalBudgeted, currencyCode),
            activity: formatAmount(totalActivity, currencyCode),
            balance: formatAmount(totalBalance, currencyCode)
          },
          categoryGroups: groups
        });
      }

      case "get": {
        if (!category) {
          return createErrorResponse("'category' is required for 'get' action");
        }

        const categoryId = await resolveCategoryId(category, budget, profile);
        const response = await api.categories.getMonthCategoryById(budgetId, targetMonth, categoryId);
        const c = response.data.category;

        return createResponse({
          budget: budgetResponse.data.budget.name,
          month: targetMonth,
          currency: currencyCode,
          category: {
            id: c.id,
            name: c.name,
            budgeted: formatAmount(c.budgeted, currencyCode),
            activity: formatAmount(c.activity, currencyCode),
            balance: formatAmount(c.balance, currencyCode),
            goalType: formatGoalType(c.goal_type),
            goalTarget: c.goal_target ? formatAmount(c.goal_target, currencyCode) : null,
            goalPercentageComplete: c.goal_percentage_complete,
            goalMonthsToBudget: c.goal_months_to_budget,
            goalUnderFunded: c.goal_under_funded ? formatAmount(c.goal_under_funded, currencyCode) : null,
            goalOverallFunded: c.goal_overall_funded ? formatAmount(c.goal_overall_funded, currencyCode) : null,
            goalOverallLeft: c.goal_overall_left ? formatAmount(c.goal_overall_left, currencyCode) : null,
            note: c.note
          }
        });
      }

      default:
        return createErrorResponse(`Unknown action: ${action}. Use: list, get`);
    }
  } catch (error) {
    console.error("Error in ynab_categories_read:", error);
    return createErrorResponse(error instanceof Error ? error.message : String(error));
  }
}
