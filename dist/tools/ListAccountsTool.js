import { resolvePlanId } from "./planId.js";
import { z } from "zod";
import { getErrorMessage } from "./errorUtils.js";
import { getDecimalDigits, toDollars } from "./money.js";
export const name = "ynab_list_accounts";
export const description = "Lists all accounts in a plan. Useful for finding account IDs when creating transactions.";
export const inputSchema = {
    planId: z.string().optional().describe("The plan ID (optional, defaults to YNAB_PLAN_ID; budgetId is a deprecated alias)"),
    budgetId: z.string().optional().describe("Deprecated alias of planId (still accepted)"),
    includeClosedAccounts: z.boolean().optional().describe("Include closed accounts in the list (default: false)"),
};
export async function execute(input, api) {
    try {
        const budgetId = resolvePlanId(input);
        const includeClosedAccounts = input.includeClosedAccounts ?? false;
        console.error(`Listing accounts for budget ${budgetId}`);
        const [response, decimalDigits] = await Promise.all([
            api.accounts.getAccounts(budgetId),
            getDecimalDigits(api, budgetId),
        ]);
        // Filter and format accounts
        const accounts = response.data.accounts
            .filter((account) => !account.deleted && (includeClosedAccounts || !account.closed))
            .map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type,
            on_budget: account.on_budget,
            closed: account.closed,
            balance: toDollars(account.balance, decimalDigits),
            cleared_balance: toDollars(account.cleared_balance, decimalDigits),
            uncleared_balance: toDollars(account.uncleared_balance, decimalDigits),
            transfer_payee_id: account.transfer_payee_id,
        }));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        accounts,
                        account_count: accounts.length,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        console.error("Error listing accounts:", error);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: getErrorMessage(error),
                    }, null, 2),
                }],
        };
    }
}
