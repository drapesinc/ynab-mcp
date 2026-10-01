/**
 * Characterization: ynab_payees (list, get, update) and ynab_budgets
 * (get, months; list/profiles are covered in profile-routing.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, TOKENS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const pay = (n: number) => idFor(CAD, "pay", n);

describe("ynab_payees", () => {
  it("list drops deleted payees and supports search and limit", async () => {
    const all = await h.call("ynab_payees", { action: "list" });
    expect(all.json.budget).toBe("Personal CAD");
    expect(all.json.count).toBe(4);
    expect(all.json.payees[2]).toEqual({ id: pay(3), name: "Transfer : Visa Infinite", transferAccountId: idFor(CAD, "acc", 2) });

    const search = await h.call("ynab_payees", { action: "list", search: "LAND" });
    expect(search.json.payees).toEqual([{ id: pay(2), name: "Landlord Inc", transferAccountId: null }]);

    const limited = await h.call("ynab_payees", { action: "list", limit: 1 });
    expect(limited.json.count).toBe(1);
  });

  it("get returns the payee and its recent transactions", async () => {
    const r = await h.call("ynab_payees", { action: "get", payee: "loblaws" });
    expect(h.fake.requests.at(-1)!.path).toBe(`/plans/${CAD}/payees/${pay(1)}/transactions`);
    expect(r.json).toEqual({
      payee: { id: pay(1), name: "Loblaws", transferAccountId: null },
      recentTransactions: [{ date: "2026-09-05", amount: -82.45, account: "Visa Infinite", category: "Groceries" }],
      totalTransactions: 1,
    });
  });

  it("get reports a payee that does not exist", async () => {
    const r = await h.call("ynab_payees", { action: "get", payee: "Nowhere" });
    expect(r.text).toBe("Error: Payee 'Nowhere' not found");
    expect((await h.call("ynab_payees", { action: "get" })).text).toBe("Error: 'payee' is required for 'get' action");
  });

  it("update renames a payee", async () => {
    const r = await h.call("ynab_payees", { action: "update", payee: "Loblaws", new_name: "Loblaws Kitchener" });
    expect(h.fake.writes()).toEqual([{
      method: "PATCH", path: `/plans/${CAD}/payees/${pay(1)}`, query: {}, token: TOKENS.personal,
      body: { payee: { name: "Loblaws Kitchener" } },
    }]);
    expect(r.json).toEqual({
      success: true,
      message: "Payee renamed from 'Loblaws' to 'Loblaws Kitchener'",
      payee: { id: pay(1), name: "Loblaws Kitchener" },
    });
  });

  it("update requires payee and new_name and writes nothing for an unknown payee", async () => {
    expect((await h.call("ynab_payees", { action: "update", new_name: "X" })).text).toBe("Error: 'payee' is required for 'update' action");
    expect((await h.call("ynab_payees", { action: "update", payee: "Loblaws" })).text).toBe("Error: 'new_name' is required for 'update' action");
    expect((await h.call("ynab_payees", { action: "update", payee: "Nowhere", new_name: "X" })).text).toBe("Error: Payee 'Nowhere' not found");
    expect(h.fake.writes()).toHaveLength(0);
  });
});

describe("ynab_budgets", () => {
  it("get summarises the current month and open accounts", async () => {
    const r = await h.call("ynab_budgets", { action: "get" });
    expect(h.fake.requests.map((q) => q.path)).toEqual([
      `/plans/${CAD}`, `/plans/${CAD}/months/2026-09-01`, `/plans/${CAD}/accounts`,
    ]);
    expect(r.json).toEqual({
      name: "Personal CAD",
      toBeBudgeted: "$125.00",
      activity: "-$1,722.34",
      budgeted: "$1,980.00",
      accounts: [
        { name: "Chequing", balance: "$1,500.00", type: "Checking" },
        { name: "Visa Infinite", balance: "-$250.50", type: "Credit Card" },
        { name: "House Asset", balance: "$300,000.00", type: "Other Asset" },
      ],
      month: "2026-09-01",
      currency: "CAD",
      categoryGroups: 6,
    });
  });

  it("get formats a GHS budget in cedis", async () => {
    const r = await h.call("ynab_budgets", { action: "get", budget: "ghs", month: "2026-08-01" });
    expect(r.json.currency).toBe("GHS");
    expect(r.json.month).toBe("2026-08-01");
    expect(r.json.accounts[0].balance).toBe("GH₵1,500.00");
  });

  it("months lists every month with plain-number amounts", async () => {
    const r = await h.call("ynab_budgets", { action: "months", profile: "kokuros" });
    expect(h.fake.requests.every((q) => q.token === TOKENS.kokuros)).toBe(true);
    expect(r.json).toEqual({
      budget: "Kokuros Micromarkets",
      currency: "CAD",
      count: 2,
      months: [
        { month: "2026-09-01", income: "3000.00", budgeted: "1980.00", activity: "-1722.34", to_be_budgeted: "125.00", age_of_money: 42 },
        { month: "2026-08-01", note: "busy", income: "2900.00", budgeted: "2100.00", activity: "-2050.00", to_be_budgeted: "0.00", age_of_money: 40 },
      ],
    });
  });

  it("rejects an unknown action at the schema level", async () => {
    await expect(h.call("ynab_budgets", { action: "delete" })).rejects.toThrow(/Invalid arguments for tool ynab_budgets/);
  });
});
