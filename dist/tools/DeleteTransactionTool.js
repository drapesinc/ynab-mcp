import { resolvePlanId } from "./planId.js";
import { z } from "zod";
import { getErrorMessage } from "./errorUtils.js";
export const name = "ynab_delete_transaction";
export const description = "Deletes a transaction from the plan. This action cannot be undone.";
export const inputSchema = {
    planId: z.string().optional().describe("The plan ID (optional, defaults to YNAB_PLAN_ID; budgetId is a deprecated alias)"),
    budgetId: z.string().optional().describe("Deprecated alias of planId (still accepted)"),
    transactionId: z.string().describe("The ID of the transaction to delete"),
};
export async function execute(input, api) {
    try {
        const budgetId = resolvePlanId(input);
        const response = await api.transactions.deleteTransaction(budgetId, input.transactionId);
        if (!response.data.transaction) {
            throw new Error("Failed to delete transaction - no transaction data returned");
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        transactionId: response.data.transaction.id,
                        message: "Transaction deleted successfully",
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        console.error("Error deleting transaction:", error);
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
