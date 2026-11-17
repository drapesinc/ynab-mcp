import { describe, expect, it, vi } from "vitest";
import { loadProfiles, resolvePlan, withProfiles } from "../profiles.js";
import type { ToolEntry } from "../registry.js";
import { z } from "zod";

const env = {
  YNAB_PROFILES: "personal, Ammish",
  YNAB_TOKEN_PERSONAL: "tok-p",
  YNAB_TOKEN_AMMISH: "tok-a",
  YNAB_BUDGETS_PERSONAL: "cad:plan-cad,usd:plan-usd",
  YNAB_DEFAULT_BUDGET: "usd",
};

describe("loadProfiles", () => {
  it("is null without YNAB_PROFILES, so the server stays on upstream's single token", () => {
    expect(loadProfiles({ YNAB_API_TOKEN: "x" })).toBeNull();
  });

  it("reads tokens, aliases and defaults", () => {
    const p = loadProfiles(env)!;
    expect(p.defaultProfile).toBe("personal");
    expect(p.list.map((x) => x.name)).toEqual(["personal", "ammish"]);
    expect(p.list[0]).toMatchObject({ token: "tok-p", defaultPlan: "plan-usd", plans: { cad: "plan-cad" } });
    expect(p.list[1]).toMatchObject({ token: "tok-a", defaultPlan: undefined });
  });

  it("skips a profile with no token and fails when the default has none", () => {
    expect(loadProfiles({ ...env, YNAB_TOKEN_AMMISH: "" })!.list.map((x) => x.name)).toEqual(["personal"]);
    expect(() => loadProfiles({ ...env, YNAB_DEFAULT_PROFILE: "ghost" })).toThrow(/ghost/);
  });
});

describe("resolvePlan", () => {
  const [personal, ammish] = loadProfiles(env)!.list;
  it("maps aliases, passes IDs through and falls back to the default, then last-used", () => {
    expect(resolvePlan(personal, { planId: "CAD" })).toBe("plan-cad");
    expect(resolvePlan(personal, { budgetId: "raw-id" })).toBe("raw-id");
    expect(resolvePlan(personal, {})).toBe("plan-usd");
    expect(resolvePlan(ammish, {})).toBe("last-used");
  });
});

describe("withProfiles", () => {
  const execute = vi.fn(async (input: unknown, api: unknown) => ({ input, api }));
  const entry: ToolEntry = {
    title: "T",
    writes: false,
    module: { name: "ynab_t", description: "d", inputSchema: { planId: z.string().optional() }, execute },
  };
  const [wrapped] = withProfiles([entry], loadProfiles(env)!, (token) => ({ token }) as any);

  it("keeps the tool name and adds an optional profile argument", () => {
    expect(wrapped.module.name).toBe("ynab_t");
    const profile = wrapped.module.inputSchema.profile as z.ZodTypeAny;
    expect(profile.safeParse(undefined).success).toBe(true);
    expect(profile.safeParse("ammish").success).toBe(true);
    expect(profile.safeParse("nobody").success).toBe(false);
  });

  it("runs with the chosen profile's token and plan", async () => {
    expect(await wrapped.module.execute({ planId: "cad" }, null as any))
      .toEqual({ input: { planId: "plan-cad", budgetId: undefined }, api: { token: "tok-p" } });
    expect(await wrapped.module.execute({ profile: "ammish" }, null as any))
      .toEqual({ input: { planId: "last-used", budgetId: undefined }, api: { token: "tok-a" } });
  });
});
