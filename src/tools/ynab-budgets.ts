/**
 * ynab_budgets - Budget operations
 * Actions: list, get, profiles
 */

import { z } from "zod";
import { getApiClient, resolveBudgetId, getAllProfiles, getProfileInfo } from "../utils/profile-manager.js";
import { formatBudgetSummary, createResponse, createErrorResponse } from "../utils/formatter.js";

export const name = "ynab_budgets";
export const description = `Budget operations for YNAB. Actions:
- list: List all budgets for profile
- get: Get budget details with optional month summary
- months: List all budget months with summaries
- profiles: List configured profiles and their budgets`;

export const inputSchema = {
  action: z.enum(["list", "get", "months", "profiles"]).describe("Action to perform"),
  profile: z.string().optional().describe("Profile name (optional, uses default)"),
  budget: z.string().optional().describe("Budget alias or ID (for 'get' action)"),
  month: z.string().optional().describe("Month in YYYY-MM-DD format (for 'get' action, defaults to current month)")
};

interface ExecuteInput {
  action: string;
  profile?: string;
  budget?: string;
  month?: string;
}

export async function execute(input: ExecuteInput) {
  try {
    const { action, profile, budget, month } = input;

    switch (action) {
      case "profiles": {
        const profiles = getAllProfiles();
        return createResponse({
          profiles,
          note: "Use profile name in other tools to switch between accounts"
        });
      }

      case "list": {
        const api = getApiClient(profile);
        const response = await api.budgets.getBudgets();

        const budgets = response.data.budgets.map(b => ({
          id: b.id,
          name: b.name,
          lastModified: b.last_modified_on,
          currency: b.currency_format?.iso_code || 'USD'
        }));

        // Add profile info
        const profileInfo = getProfileInfo(profile);
        return createResponse({
          profile: profileInfo.name,
          budgets,
          aliases: profileInfo.budgets
        });
      }

      case "get": {
        const api = getApiClient(profile);
        const budgetId = resolveBudgetId(budget, profile);

        // Get budget details
        const budgetResponse = await api.budgets.getBudgetById(budgetId);
        const budgetData = budgetResponse.data.budget;
        const currencyCode = budgetData.currency_format?.iso_code || 'USD';

        // Get month summary if requested or current month
        const targetMonth = month || new Date().toISOString().slice(0, 7) + "-01";
        const monthResponse = await api.months.getBudgetMonth(budgetId, targetMonth);
        const monthData = monthResponse.data.month;

        // Get accounts
        const accountsResponse = await api.accounts.getAccounts(budgetId);
        const accounts = accountsResponse.data.accounts;

        const summary = formatBudgetSummary(
          budgetData,
          monthData,
          accounts,
          currencyCode
        );

        return createResponse({
          ...summary,
          month: targetMonth,
          currency: currencyCode,
          categoryGroups: monthData.categories?.length || 0
        });
      }

      case "months": {
        const api = getApiClient(profile);
        const budgetId = resolveBudgetId(budget, profile);

        const response = await api.months.getBudgetMonths(budgetId);
        const budgetResponse = await api.budgets.getBudgetById(budgetId);
        const currencyCode = budgetResponse.data.budget.currency_format?.iso_code || 'USD';

        const months = response.data.months.map(m => ({
          month: m.month,
          note: m.note,
          income: (m.income / 1000).toFixed(2),
          budgeted: (m.budgeted / 1000).toFixed(2),
          activity: (m.activity / 1000).toFixed(2),
          to_be_budgeted: (m.to_be_budgeted / 1000).toFixed(2),
          age_of_money: m.age_of_money
        }));

        return createResponse({
          budget: budgetResponse.data.budget.name,
          currency: currencyCode,
          count: months.length,
          months
        });
      }

      default:
        return createErrorResponse(`Unknown action: ${action}. Use: list, get, months, profiles`);
    }
  } catch (error) {
    console.error("Error in ynab_budgets:", error);
    return createErrorResponse(error instanceof Error ? error.message : String(error));
  }
}
