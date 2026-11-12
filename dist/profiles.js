/**
 * Fork addition (drapesinc/ynab-mcp): more than one YNAB login in one server.
 *
 * Upstream reads one token from YNAB_API_TOKEN. This file adds named profiles,
 * each with its own token, and an optional `profile` argument on every tool.
 * With no YNAB_PROFILES set, nothing changes: the server runs exactly as upstream.
 *
 *   YNAB_PROFILES=personal,ammish          names, comma separated
 *   YNAB_TOKEN_<NAME>=<token>              one token per profile
 *   YNAB_BUDGETS_<NAME>=cad:<id>,usd:<id>  optional plan aliases per profile
 *   YNAB_DEFAULT_PROFILE=personal          optional, else the first name
 *   YNAB_DEFAULT_BUDGET=cad                optional default alias for the default profile
 *
 * planId may be a plan ID or one of the profile's aliases. With no planId, a
 * tool uses the profile's default alias, then YNAB_PLAN_ID (default profile
 * only), then YNAB's "last-used" plan.
 */
import * as ynab from "ynab";
import { z } from "zod";
function parsePlans(value) {
    const plans = {};
    for (const pair of (value ?? "").split(",")) {
        const [alias, id] = pair.split(":").map((part) => part?.trim());
        if (alias && id)
            plans[alias.toLowerCase()] = id;
    }
    return plans;
}
/** Profiles from the environment, or null when YNAB_PROFILES is not set (upstream single-token mode). */
export function loadProfiles(env = process.env) {
    const names = (env.YNAB_PROFILES ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
    if (names.length === 0)
        return null;
    const defaultProfile = env.YNAB_DEFAULT_PROFILE?.trim().toLowerCase() || names[0];
    const list = [];
    for (const name of names) {
        const token = env[`YNAB_TOKEN_${name.toUpperCase()}`];
        if (!token) {
            console.error(`YNAB MCP: no YNAB_TOKEN_${name.toUpperCase()}, skipping profile ${name}`);
            continue;
        }
        const plans = parsePlans(env[`YNAB_BUDGETS_${name.toUpperCase()}`]);
        const wanted = name === defaultProfile ? env.YNAB_DEFAULT_BUDGET?.trim().toLowerCase() : undefined;
        const defaultPlan = (wanted && plans[wanted]) || Object.values(plans)[0] ||
            (name === defaultProfile ? env.YNAB_PLAN_ID || env.YNAB_BUDGET_ID : undefined) || undefined;
        list.push({ name, token, plans, defaultPlan });
    }
    if (list.length === 0)
        throw new Error("YNAB_PROFILES is set but no profile has a YNAB_TOKEN_<NAME>");
    if (!list.some((p) => p.name === defaultProfile)) {
        throw new Error(`YNAB_DEFAULT_PROFILE '${defaultProfile}' has no token. Profiles: ${list.map((p) => p.name).join(", ")}`);
    }
    return { list, defaultProfile };
}
/** Turns a plan alias into its ID, and fills in the profile's default plan when none was given. */
export function resolvePlan(profile, input) {
    const given = (typeof input.planId === "string" && input.planId) || (typeof input.budgetId === "string" && input.budgetId) || "";
    if (given)
        return profile.plans[given.toLowerCase()] ?? given;
    return profile.defaultPlan || "last-used";
}
/**
 * Wraps each tool so it takes an optional `profile` and runs with that
 * profile's token and plans. Tool names, descriptions and other arguments are
 * upstream's, unchanged.
 */
export function withProfiles(entries, profiles, makeApi = (token) => new ynab.API(token)) {
    const apis = new Map(profiles.list.map((p) => [p.name, makeApi(p.token)]));
    const byName = new Map(profiles.list.map((p) => [p.name, p]));
    const names = profiles.list.map((p) => p.name);
    return entries.map((entry) => {
        const { module } = entry;
        const takesPlan = "planId" in module.inputSchema;
        const profileArg = z.enum(names).optional()
            .describe(`YNAB login to use (default: ${profiles.defaultProfile}). One of: ${names.join(", ")}`);
        return {
            ...entry,
            module: {
                ...module,
                inputSchema: { ...module.inputSchema, profile: profileArg },
                execute: async (input) => {
                    const { profile: chosen, ...rest } = input ?? {};
                    const name = typeof chosen === "string" && chosen ? chosen : profiles.defaultProfile;
                    const profile = byName.get(name);
                    const args = takesPlan ? { ...rest, planId: resolvePlan(profile, rest), budgetId: undefined } : rest;
                    return module.execute(args, apis.get(name));
                },
            },
        };
    });
}
