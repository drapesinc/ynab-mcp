import { resolvePlanId } from "./planId.js";
import { z } from "zod";
import { getErrorMessage } from "./errorUtils.js";
import { getDecimalDigits, toDollars } from "./money.js";
export const name = "ynab_bulk_approve_transactions";
export const description = "Approves (or, with approved: false, un-approves) one or more transactions in a single API call.";
export const inputSchema = {
    planId: z.string().optional().describe("The plan ID (optional, defaults to YNAB_PLAN_ID; budgetId is a deprecated alias)"),
    budgetId: z.string().optional().describe("Deprecated alias of planId (still accepted)"),
    transactionIds: z.array(z.string()).min(1).max(500).describe("Array of transaction IDs to approve"),
    approved: z.boolean().optional().default(true).describe("Whether the transactions should be marked as approved (default true); false un-approves them"),
};
export async function execute(input, api) {
    try {
        const budgetId = resolvePlanId(input);
        if (!input.transactionIds || input.transactionIds.length === 0) {
            throw new Error("No transaction IDs provided");
        }
        const approved = input.approved ?? true;
        const transactions = input.transactionIds.map((id) => ({
            id,
            approved,
        }));
        const [response, decimalDigits] = await Promise.all([
            api.transactions.updateTransactions(budgetId, { transactions }),
            getDecimalDigits(api, budgetId),
        ]);
        if (!response.data.transactions) {
            throw new Error("Failed to update transactions - no transaction data returned");
        }
        const updatedTransactions = response.data.transactions.map((txn) => ({
            id: txn.id,
            date: txn.date,
            amount: toDollars(txn.amount, decimalDigits),
            payee_name: txn.payee_name,
            approved: txn.approved,
        }));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        ...(approved
                            ? { approved_count: updatedTransactions.length }
                            : { unapproved_count: updatedTransactions.length }),
                        transactions: updatedTransactions,
                        message: `Successfully ${approved ? "approved" : "un-approved"} ${updatedTransactions.length} transaction(s)`,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        console.error("Error bulk approving transactions:", error);
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
