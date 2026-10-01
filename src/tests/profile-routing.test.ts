/**
 * Characterization: per-call budget-profile selection.
 *
 * This is the fork's core difference from upstream (one global token). Each
 * call picks its own profile (token) and budget (alias or id). The fake only
 * lets a token see its own budgets, so a call routed to the wrong profile
 * fails instead of passing silently.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, TOKENS, TEST_ENV, type Harness } from "./helpers/harness.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const planOf = (path: string) => path.match(/^\/plans\/([^/]+)/)?.[1];

describe("profile and budget selection", () => {
  it("runs with only the dummy test configuration (no real YNAB_* variables)", () => {
    const ynabKeys = Object.keys(process.env).filter((k) => k.startsWith("YNAB_")).sort();
    expect(ynabKeys).toEqual(Object.keys(TEST_ENV).sort());
    expect(process.env.YNAB_TOKEN_PERSONAL).toBe(TOKENS.personal);
  });

  it("lists configured profiles without calling YNAB", async () => {
    const r = await h.call("ynab_budgets", { action: "profiles" });
    expect(r.json).toEqual({
      profiles: [
        { name: "personal", isDefault: true, budgetCount: 3, budgets: ["cad", "ghs", "usd"] },
        { name: "kokuros", isDefault: false, budgetCount: 1, budgets: ["kokuros"] },
      ],
      note: "Use profile name in other tools to switch between accounts",
    });
    expect(h.fake.requests).toHaveLength(0);
  });

  it("uses the default profile and its first budget alias when neither is given", async () => {
    const r = await h.call("ynab_accounts", { action: "list" });
    expect(r.json.budget).toBe("Personal CAD");
    expect(h.fake.requests.length).toBeGreaterThan(0);
    for (const req of h.fake.requests) {
      expect(req.token).toBe(TOKENS.personal);
      expect(planOf(req.path)).toBe(PLANS.cad);
    }
  });

  it("resolves a budget alias within the profile (case-insensitive)", async () => {
    const r = await h.call("ynab_accounts", { action: "list", budget: "GHS" });
    expect(r.json.budget).toBe("Personal GHS");
    expect(r.json.currency).toBe("GHS");
    expect(new Set(h.fake.requests.map((q) => planOf(q.path)))).toEqual(new Set([PLANS.ghs]));
  });

  it("switches token and default budget when another profile is named", async () => {
    const r = await h.call("ynab_accounts", { action: "list", profile: "Kokuros" });
    expect(r.json.budget).toBe("Kokuros Micromarkets");
    for (const req of h.fake.requests) {
      expect(req.token).toBe(TOKENS.kokuros);
      expect(planOf(req.path)).toBe(PLANS.kokuros);
    }
  });

  it("passes a raw budget id straight through", async () => {
    const r = await h.call("ynab_accounts", { action: "list", budget: PLANS.usd });
    expect(r.json.budget).toBe("Personal USD");
    expect(planOf(h.fake.requests[0].path)).toBe(PLANS.usd);
  });

  it("keeps routing correct for concurrent calls on different profiles", async () => {
    const [a, b, c] = await Promise.all([
      h.call("ynab_accounts", { action: "balances", profile: "kokuros" }),
      h.call("ynab_accounts", { action: "balances", budget: "usd" }),
      h.call("ynab_transactions_read", { action: "list", profile: "kokuros", limit: 1 }),
    ]);
    expect(a.json.budget).toBe("Kokuros Micromarkets");
    expect(b.json.budget).toBe("Personal USD");
    expect(c.json.budget).toBe("Kokuros Micromarkets");
    for (const req of h.fake.requests) {
      const plan = planOf(req.path);
      expect(req.token).toBe(plan === PLANS.kokuros ? TOKENS.kokuros : TOKENS.personal);
    }
  });

  it("routes writes to the chosen profile too", async () => {
    const r = await h.call("ynab_transactions_write", {
      action: "create", profile: "kokuros", account: "Chequing", amount: -12.5, payee: "Loblaws",
    });
    expect(r.json.success).toBe(true);
    const [write] = h.fake.writes();
    expect(write.method).toBe("POST");
    expect(write.token).toBe(TOKENS.kokuros);
    expect(planOf(write.path)).toBe(PLANS.kokuros);
  });

  it("rejects an unknown profile before calling YNAB", async () => {
    const r = await h.call("ynab_accounts", { action: "list", profile: "nope" });
    expect(r.text).toBe("Error: Profile 'nope' not found. Available: personal, kokuros");
    expect(h.fake.requests).toHaveLength(0);
  });

  it("rejects a budget alias from another profile before calling YNAB", async () => {
    const r = await h.call("ynab_accounts", { action: "list", profile: "kokuros", budget: "cad" });
    expect(r.text).toBe("Error: Budget 'cad' not found for profile 'kokuros'. Available: kokuros");
    expect(h.fake.requests).toHaveLength(0);
  });

  it("lists budgets with the profile's own token", async () => {
    const r = await h.call("ynab_budgets", { action: "list", profile: "kokuros" });
    expect(r.json).toEqual({
      profile: "kokuros",
      budgets: [{
        id: PLANS.kokuros, name: "Kokuros Micromarkets", lastModified: "2026-09-29T12:00:00.000Z", currency: "CAD",
      }],
      aliases: [{ alias: "kokuros", id: PLANS.kokuros }],
    });
    expect(h.fake.requests).toEqual([
      { method: "GET", path: "/plans", query: {}, token: TOKENS.kokuros, body: undefined },
    ]);
  });
});
