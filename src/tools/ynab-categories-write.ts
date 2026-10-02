/**
 * ynab_categories_write - Category mutation operations
 * Actions: create, create_group, update, move, auto_assign
 */

import { z } from "zod";
import * as ynab from "ynab";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { resolveCategoryId } from "../utils/resolver.js";
import { formatAmount, dollarsToMilliunits, createResponse, createErrorResponse, getErrorMessage } from "../utils/formatter.js";

export const name = "ynab_categories_write";
export const description = `Category mutation operations for YNAB. Actions:
- create: Create a new category in an existing group
- create_group: Create a new category group
- update: Set budgeted amount for a category in a specific month
- move: Move funds between categories
- auto_assign: Fill underfunded goals from Ready to Assign, biggest gap first. Never exceeds max_total or Ready to Assign. Preview only unless dry_run is explicitly false (it moves money)`;

export const inputSchema = {
  action: z.enum(["create", "create_group", "update", "move", "auto_assign"]).describe("Action to perform"),
  profile: z.string().optional().describe("Profile name (optional, uses default)"),
  budget: z.string().optional().describe("Budget alias or ID (optional, uses default)"),
  category: z.string().optional().describe("Category name or ID (for 'update' action)"),
  from_category: z.string().optional().describe("Source category name or ID (for 'move' action)"),
  to_category: z.string().optional().describe("Target category name or ID (for 'move' action)"),
  amount: z.number().optional().describe("Amount in dollars"),
  month: z.string().optional().describe("Month in YYYY-MM-DD format (defaults to current month)"),
  name: z.string().optional().describe("Name for new category or category group (for 'create' and 'create_group' actions)"),
  group: z.string().optional().describe("Category group name or ID to add the new category to (for 'create' action)"),
  goal_target: z.number().optional().describe("Goal target amount in dollars (for 'create' action)"),
  goal_target_date: z.string().optional().describe("Goal target date in YYYY-MM-DD format (for 'create' action)"),
  dry_run: z.boolean().optional().describe("For 'auto_assign': preview only (default true). Set false to actually assign."),
  max_total: z.number().optional().describe("For 'auto_assign': maximum total to assign, in dollars")
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
  name?: string;
  group?: string;
  goal_target?: number;
  goal_target_date?: string;
  dry_run?: boolean;
  max_total?: number;
}

export async function execute(input: ExecuteInput) {
  try {
    const { action, profile, budget, category, from_category, to_category, amount, month, name: categoryName, group, goal_target, goal_target_date, dry_run, max_total } = input;

    const api = getApiClient(profile);
    const budgetId = resolveBudgetId(budget, profile);

    // Get budget currency
    const planResponse = await api.plans.getPlanById(budgetId);
    const currencyCode = planResponse.data.plan.currency_format?.iso_code || 'USD';

    const targetMonth = month || new Date().toISOString().slice(0, 7) + "-01";

    switch (action) {
      case "create": {
        if (!categoryName) {
          return createErrorResponse("'name' is required for 'create' action");
        }
        if (!group) {
          return createErrorResponse("'group' is required for 'create' action (category group name or ID)");
        }

        // Resolve group to ID - check if it's already an ID
        let groupId = group;
        if (!group.includes('-') || group.length < 30) {
          // It's a name, need to find it
          const categoriesResponse = await api.categories.getCategories(budgetId);
          const matchedGroup = categoriesResponse.data.category_groups.find(
            g => g.name.toLowerCase() === group.toLowerCase()
          );
          if (!matchedGroup) {
            return createErrorResponse(`Category group '${group}' not found`);
          }
          groupId = matchedGroup.id;
        }

        const newCategory: ynab.NewCategory = {
          name: categoryName,
          category_group_id: groupId,
        };

        if (goal_target !== undefined) {
          newCategory.goal_target = dollarsToMilliunits(goal_target);
        }

        if (goal_target_date) {
          newCategory.goal_target_date = goal_target_date;
        }

        const response = await api.categories.createCategory(budgetId, { category: newCategory });
        const created = response.data.category;

        return createResponse({
          success: true,
          message: "Category created",
          category: {
            id: created.id,
            name: created.name,
            budgeted: formatAmount(created.budgeted, currencyCode),
            activity: formatAmount(created.activity, currencyCode),
            balance: formatAmount(created.balance, currencyCode)
          }
        });
      }

      case "create_group": {
        if (!categoryName) {
          return createErrorResponse("'name' is required for 'create_group' action");
        }

        const response = await api.categories.createCategoryGroup(budgetId, {
          category_group: { name: categoryName }
        });
        const created = response.data.category_group;

        return createResponse({
          success: true,
          message: "Category group created",
          category_group: {
            id: created.id,
            name: created.name,
            hidden: created.hidden,
            deleted: created.deleted
          }
        });
      }

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

        // Write one side at a time so a failure on the second write can say
        // exactly which category was already changed.
        const updatedFrom = await api.categories.updateMonthCategory(budgetId, targetMonth, fromCategoryId, {
          category: { budgeted: fromCurrent - milliunits }
        });
        let updatedTo;
        try {
          updatedTo = await api.categories.updateMonthCategory(budgetId, targetMonth, toCategoryId, {
            category: { budgeted: toCurrent + milliunits }
          });
        } catch (error) {
          return createErrorResponse(
            `Partial failure: '${from_category}' was reduced by ${formatAmount(milliunits, currencyCode)} ` +
            `(budgeted now ${formatAmount(updatedFrom.data.category.budgeted, currencyCode)}) but '${to_category}' was NOT increased: ` +
            `${getErrorMessage(error)}. Budgeted for '${from_category}' was ${formatAmount(fromCurrent, currencyCode)} before; ` +
            `restore it or assign ${formatAmount(milliunits, currencyCode)} to '${to_category}' to finish the move.`
          );
        }

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

      case "auto_assign": {
        // Moves money, so it only writes when dry_run is explicitly false.
        const isDryRun = dry_run !== false;
        if (max_total !== undefined && max_total <= 0) {
          return createErrorResponse("'max_total' must be a positive number for 'auto_assign' action");
        }

        const monthResponse = await api.months.getPlanMonth(budgetId, targetMonth);
        const readyToAssign = monthResponse.data.month.to_be_budgeted;
        const cap = Math.min(
          Math.max(readyToAssign, 0),
          max_total !== undefined ? dollarsToMilliunits(max_total) : Infinity
        );

        const underfunded = monthResponse.data.month.categories
          .filter(c => !c.deleted && !c.hidden && (c.goal_under_funded ?? 0) > 0)
          .sort((a, b) => (b.goal_under_funded ?? 0) - (a.goal_under_funded ?? 0));

        let remaining = cap;
        const plan: Array<{ id: string; name: string; budgeted: number; gap: number; assign: number }> = [];
        for (const c of underfunded) {
          if (remaining <= 0) break;
          const gap = c.goal_under_funded ?? 0;
          const assign = Math.min(gap, remaining);
          plan.push({ id: c.id, name: c.name, budgeted: c.budgeted, gap, assign });
          remaining -= assign;
        }
        const totalAssigned = plan.reduce((sum, p) => sum + p.assign, 0);

        const summary = (p: typeof plan[number]) => ({
          name: p.name,
          gap: formatAmount(p.gap, currencyCode),
          assigned: formatAmount(p.assign, currencyCode),
          previousBudgeted: formatAmount(p.budgeted, currencyCode),
          newBudgeted: formatAmount(p.budgeted + p.assign, currencyCode),
        });

        if (isDryRun) {
          return createResponse({
            success: true,
            dry_run: true,
            message: plan.length === 0
              ? "Nothing to assign"
              : `Would assign ${formatAmount(totalAssigned, currencyCode)} across ${plan.length} categories. Nothing was written; pass dry_run: false to apply.`,
            month: targetMonth,
            readyToAssign: formatAmount(readyToAssign, currencyCode),
            maxTotal: max_total !== undefined ? formatAmount(dollarsToMilliunits(max_total), currencyCode) : null,
            totalAssigned: formatAmount(totalAssigned, currencyCode),
            readyToAssignAfter: formatAmount(readyToAssign - totalAssigned, currencyCode),
            assignments: plan.map(summary)
          });
        }

        const applied: typeof plan = [];
        for (const p of plan) {
          try {
            await api.categories.updateMonthCategory(budgetId, targetMonth, p.id, {
              category: { budgeted: p.budgeted + p.assign }
            });
            applied.push(p);
          } catch (error) {
            const done = applied.map(a => `'${a.name}' (+${formatAmount(a.assign, currencyCode)})`).join(", ") || "none";
            return createErrorResponse(
              `Partial failure while assigning '${p.name}': ${getErrorMessage(error)}. ` +
              `Already assigned: ${done}. Not attempted or failed: ${plan.slice(applied.length).map(x => `'${x.name}'`).join(", ")}.`
            );
          }
        }

        const appliedTotal = applied.reduce((sum, p) => sum + p.assign, 0);
        return createResponse({
          success: true,
          dry_run: false,
          message: applied.length === 0
            ? "Nothing to assign"
            : `Assigned ${formatAmount(appliedTotal, currencyCode)} across ${applied.length} categories`,
          month: targetMonth,
          readyToAssign: formatAmount(readyToAssign, currencyCode),
          totalAssigned: formatAmount(appliedTotal, currencyCode),
          readyToAssignAfter: formatAmount(readyToAssign - appliedTotal, currencyCode),
          assignments: applied.map(summary)
        });
      }

      default:
        return createErrorResponse(`Unknown action: ${action}. Use: create, create_group, update, move, auto_assign`);
    }
  } catch (error) {
    console.error("Error in ynab_categories_write:", error);
    return createErrorResponse(getErrorMessage(error));
  }
}
