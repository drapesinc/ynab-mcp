import { z } from "zod";
// Import all tools
import * as ListPlansTool from "./tools/ListPlansTool.js";
import * as PlanSummaryTool from "./tools/PlanSummaryTool.js";
import * as CreateTransactionTool from "./tools/CreateTransactionTool.js";
import * as UpdateCategoryBudgetTool from "./tools/UpdateCategoryBudgetTool.js";
import * as UpdateTransactionTool from "./tools/UpdateTransactionTool.js";
import * as BulkApproveTransactionsTool from "./tools/BulkApproveTransactionsTool.js";
import * as ListPayeesTool from "./tools/ListPayeesTool.js";
import * as GetTransactionsTool from "./tools/GetTransactionsTool.js";
import * as DeleteTransactionTool from "./tools/DeleteTransactionTool.js";
import * as ListCategoriesTool from "./tools/ListCategoriesTool.js";
import * as ListAccountsTool from "./tools/ListAccountsTool.js";
import * as ListScheduledTransactionsTool from "./tools/ListScheduledTransactionsTool.js";
import * as ImportTransactionsTool from "./tools/ImportTransactionsTool.js";
import * as ListMonthsTool from "./tools/ListMonthsTool.js";
import * as MoveMoneyTool from "./tools/MoveMoneyTool.js";
import * as AutoAssignTool from "./tools/AutoAssignTool.js";
import * as SpendingByCategoryTool from "./tools/SpendingByCategoryTool.js";
import * as SpendingByPayeeTool from "./tools/SpendingByPayeeTool.js";
import * as CashFlowTool from "./tools/CashFlowTool.js";
import * as BalanceForecastTool from "./tools/BalanceForecastTool.js";
import * as DetectRecurringTool from "./tools/DetectRecurringTool.js";
import * as SuggestCategoriesTool from "./tools/SuggestCategoriesTool.js";
import * as ApplyCategorySuggestionsTool from "./tools/ApplyCategorySuggestionsTool.js";
import { getErrorMessage, toolError } from "./tools/errorUtils.js";
import { configuredPlanId, describeMissingPlan } from "./tools/planId.js";
const refineCreateTransaction = (schema) => schema
    .refine((data) => Boolean(data.accountId || data.accountName), {
    message: "Either accountId or accountName must be provided",
    path: ["accountId"],
})
    .refine((data) => Boolean(data.payeeId || data.payeeName), {
    message: "Either payeeId or payeeName must be provided",
    path: ["payeeId"],
});
export const tools = [
    { title: "List Plans", module: ListPlansTool, writes: false },
    { title: "Plan Summary", module: PlanSummaryTool, writes: false },
    { title: "Create Transaction", module: CreateTransactionTool, writes: true, refine: refineCreateTransaction },
    { title: "Update Category Budget", module: UpdateCategoryBudgetTool, writes: true, idempotent: true },
    { title: "Update Transaction", module: UpdateTransactionTool, writes: true, idempotent: true },
    { title: "Bulk Approve Transactions", module: BulkApproveTransactionsTool, writes: true, idempotent: true },
    { title: "List Payees", module: ListPayeesTool, writes: false },
    { title: "Get Transactions", module: GetTransactionsTool, writes: false },
    { title: "Delete Transaction", module: DeleteTransactionTool, writes: true, destructive: true },
    { title: "List Categories", module: ListCategoriesTool, writes: false },
    { title: "List Accounts", module: ListAccountsTool, writes: false },
    { title: "List Scheduled Transactions", module: ListScheduledTransactionsTool, writes: false },
    { title: "Import Transactions", module: ImportTransactionsTool, writes: true },
    { title: "List Months", module: ListMonthsTool, writes: false },
    { title: "Move Money", module: MoveMoneyTool, writes: true },
    { title: "Auto Assign", module: AutoAssignTool, writes: true },
    { title: "Spending By Category", module: SpendingByCategoryTool, writes: false },
    { title: "Spending By Payee", module: SpendingByPayeeTool, writes: false },
    { title: "Cash Flow", module: CashFlowTool, writes: false },
    { title: "Balance Forecast", module: BalanceForecastTool, writes: false },
    { title: "Detect Recurring", module: DetectRecurringTool, writes: false },
    { title: "Suggest Categories", module: SuggestCategoriesTool, writes: false, requiresAiCategorization: true },
    { title: "Apply Category Suggestions", module: ApplyCategorySuggestionsTool, writes: true, idempotent: true },
];
/** True when a `YNAB_READ_ONLY` value asks for read-only mode: "true" in any case, surrounding whitespace ignored. */
export function isReadOnly(value) {
    return value?.trim().toLowerCase() === "true";
}
function acceptsUndefined(schema) {
    return typeof schema === "object" && schema !== null &&
        "safeParse" in schema && typeof schema.safeParse === "function" &&
        "nullable" in schema && typeof schema.nullable === "function" &&
        schema.safeParse(undefined).success;
}
/**
 * `.nullable()` wraps the schema in an `anyOf`, which moves a `.describe()`d
 * property's description into the first `anyOf` branch instead of the
 * property itself - re-attach it so clients and model schema renderers still
 * see it.
 */
function nullCompatible(schema) {
    const nullable = schema.nullable();
    return schema.description ? nullable.describe(schema.description) : nullable;
}
function nullCompatibleInputSchema(inputSchema) {
    return Object.fromEntries(Object.entries(inputSchema).map(([key, schema]) => [
        key,
        acceptsUndefined(schema) ? nullCompatible(schema) : schema,
    ]));
}
/** Derives the MCP ToolAnnotations advertised for a tool from its registry entry. */
function buildAnnotations(tool) {
    return {
        title: tool.title,
        readOnlyHint: !tool.writes && !tool.changesServerState,
        destructiveHint: Boolean(tool.destructive),
        idempotentHint: Boolean(tool.idempotent),
        openWorldHint: true,
    };
}
function omitNullOptionalInputs(input, inputSchema) {
    return Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== null || !acceptsUndefined(inputSchema[key])));
}
/** A tool result that reports failure through the `{success: false}` text convention every tool follows. */
function isFailureResult(result) {
    if (result?.isError === true)
        return true;
    const text = result?.content?.[0]?.text;
    if (typeof text !== "string")
        return false;
    try {
        return JSON.parse(text)?.success === false;
    }
    catch {
        return false;
    }
}
function attachPlanExplanation(result, explanation) {
    const content = [...(result.content ?? [])];
    try {
        const detail = JSON.parse(content[0].text);
        content[0] = { ...content[0], text: JSON.stringify({ ...detail, plan_visibility_error: explanation }, null, 2) };
    }
    catch {
        content.push({ type: "text", text: explanation });
    }
    return { ...result, content, isError: true };
}
/** In-flight plan-visibility checks, shared by concurrent failures. */
const planChecks = new WeakMap();
/**
 * When a call that fell back to the configured plan fails, checks whether the
 * token can see that plan at all and, if not, says so instead of the bare
 * "Resource not found". Returns null when the plan is fine or the check fails.
 */
async function explainDefaultPlanFailure(module, input, api) {
    const given = input;
    const planId = configuredPlanId();
    if (!("planId" in module.inputSchema) || given?.planId || given?.budgetId || !planId)
        return null;
    const checks = planChecks.get(api) ?? new Map();
    planChecks.set(api, checks);
    let check = checks.get(planId);
    if (!check) {
        check = (async () => describeMissingPlan(planId, (await api.plans.getPlans()).data.plans))();
        checks.set(planId, check);
    }
    try {
        return await check;
    }
    catch {
        return null;
    }
    finally {
        if (checks.get(planId) === check)
            checks.delete(planId);
    }
}
/** Runs a tool's execute, guaranteeing a failure - thrown or `{success: false}` - comes back as `isError: true`. */
async function executeTool(module, input, api) {
    try {
        const result = await module.execute(input, api);
        if (!isFailureResult(result))
            return result;
        const explanation = await explainDefaultPlanFailure(module, input, api);
        return explanation ? attachPlanExplanation(result, explanation) : { ...result, isError: true };
    }
    catch (error) {
        return toolError((await explainDefaultPlanFailure(module, input, api)) ?? getErrorMessage(error));
    }
}
/** Register every tool, optionally omitting YNAB write tools, against a server instance. */
export function registerAll(server, api, options = {}) {
    const selected = tools.filter((tool) => !tool.requiresAiCategorization || SuggestCategoriesTool.isCategorySuggestionEnabled());
    return registerTools(server, api, selected, options);
}
/**
 * Register the given entries, dropping YNAB write tools in read-only mode.
 * The Worker also uses this for the tools only it can serve.
 */
export function registerTools(server, api, entries, options = {}) {
    const selected = entries.filter((tool) => !options.readOnly || !tool.writes);
    for (const tool of selected) {
        const { title, module } = tool;
        const wrapped = z.object(nullCompatibleInputSchema(module.inputSchema));
        const inputSchema = tool.refine ? tool.refine(wrapped) : wrapped;
        server.registerTool(module.name, {
            title,
            description: module.description,
            inputSchema,
            annotations: buildAnnotations(tool),
        }, async (input) => executeTool(module, omitNullOptionalInputs(input, module.inputSchema), api));
    }
    return selected.length;
}
