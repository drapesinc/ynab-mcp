import { getErrorMessage, toolError } from "./errorUtils.js";
export const name = "ynab_list_plans";
export const description = "Lists all available plans from YNAB API";
export const inputSchema = {};
export async function execute(_input, api) {
    try {
        if (!process.env.YNAB_API_TOKEN) {
            return toolError("YNAB API Token is not set");
        }
        console.error("Listing plans");
        const plansResponse = await api.plans.getPlans();
        console.error(`Found ${plansResponse.data.plans.length} plans`);
        const plans = plansResponse.data.plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
        }));
        return {
            content: [{ type: "text", text: JSON.stringify(plans, null, 2) }]
        };
    }
    catch (error) {
        console.error("Error listing plans:", error);
        return toolError(getErrorMessage(error));
    }
}
