/**
 * Port of upstream 4cb1051 ("mark tool errors"): a failed tool call must come
 * back with `isError: true`, so a failed write never reads as a success.
 * The error text itself ("Error: ...") is unchanged.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

describe("failed calls set isError: true on every tool", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["ynab_budgets", { action: "get", profile: "nope" }, "Error: Profile 'nope' not found. Available: personal, kokuros"],
    ["ynab_accounts", { action: "get" }, "Error: 'account' parameter required for 'get' action"],
    ["ynab_accounts_write", { action: "reconcile", account: "Visa" }, "Error: 'balance' is required for 'reconcile' action (the confirmed balance in dollars)"],
    ["ynab_transactions_read", { action: "list", budget: "eur" }, "Error: Budget 'eur' not found for profile 'personal'. Available: cad, ghs, usd"],
    ["ynab_transactions_write", { action: "create", account: "Chequing" }, "Error: 'amount' is required for create action"],
    ["ynab_categories_read", { action: "get", category: "Vacation" }, "Error: Category 'Vacation' not found"],
    ["ynab_categories_write", { action: "move", from_category: "Phone", to_category: "Rent", amount: 100 }, "Error: Insufficient funds in 'Phone'. Available: $80.00, Requested: $100.00"],
    ["ynab_payees", { action: "update", payee: "Nowhere", new_name: "X" }, "Error: Payee 'Nowhere' not found"],
  ];

  for (const [tool, args, text] of cases) {
    it(`${tool}: ${text}`, async () => {
      const r = await h.call(tool, args);
      expect(r.text).toBe(text);
      expect(r.isError).toBe(true);
    });
  }
});

describe("YNAB API failures on writes set isError: true", () => {
  it("transactions create", async () => {
    h.fake.failNext("POST", /\/transactions$/, 400);
    const r = await h.call("ynab_transactions_write", { action: "create", account: "Chequing", amount: -1 });
    expect(r.text.startsWith("Error: ")).toBe(true);
    expect(r.isError).toBe(true);
  });

  it("transactions adjust", async () => {
    h.fake.failNext("POST", /\/transactions$/, 409);
    const r = await h.call("ynab_transactions_write", { action: "adjust", account: "House Asset", amount: 1 });
    expect(r.isError).toBe(true);
  });

  it("transactions delete of an unknown id", async () => {
    const r = await h.call("ynab_transactions_write", { action: "delete", transaction_id: idFor(PLANS.cad, "txn", 999) });
    expect(r.isError).toBe(true);
  });

  it("accounts reconcile", async () => {
    h.fake.failNext("POST", /\/transactions$/, 500);
    const r = await h.call("ynab_accounts_write", { action: "reconcile", account: "Visa", balance: -210 });
    expect(r.isError).toBe(true);
  });

  it("accounts create", async () => {
    h.fake.failNext("POST", /\/accounts$/, 400);
    const r = await h.call("ynab_accounts_write", { action: "create", name: "X", type: "cash" });
    expect(r.isError).toBe(true);
  });

  it("categories update", async () => {
    h.fake.failNext("PATCH", /\/categories\//, 400);
    const r = await h.call("ynab_categories_write", { action: "update", category: "Rent", amount: 1 });
    expect(r.isError).toBe(true);
  });

  it("payees update", async () => {
    h.fake.failNext("PATCH", /\/payees\//, 400);
    const r = await h.call("ynab_payees", { action: "update", payee: "Loblaws", new_name: "X" });
    expect(r.isError).toBe(true);
  });
});

describe("API failures on reads set isError: true", () => {
  it("accounts list", async () => {
    h.fake.failNext("GET", /\/accounts$/, 500);
    const r = await h.call("ynab_accounts", { action: "list" });
    expect(r.isError).toBe(true);
  });
});

describe("successful calls do not set isError", () => {
  it("reads", async () => {
    expect((await h.call("ynab_budgets", { action: "profiles" })).isError).toBeUndefined();
    expect((await h.call("ynab_accounts", { action: "list" })).isError).toBeUndefined();
    expect((await h.call("ynab_transactions_read", { action: "unapproved" })).isError).toBeUndefined();
  });

  it("writes, including no-op adjust and reconcile", async () => {
    expect((await h.call("ynab_transactions_write", { action: "create", account: "Chequing", amount: -1 })).isError).toBeUndefined();
    expect((await h.call("ynab_transactions_write", { action: "adjust", account: "Chequing", amount: 1500 })).isError).toBeUndefined();
    expect((await h.call("ynab_accounts_write", { action: "reconcile", account: "Chequing", balance: 1500 })).isError).toBeUndefined();
  });
});
