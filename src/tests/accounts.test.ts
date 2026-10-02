/**
 * Characterization: ynab_accounts (read) and ynab_accounts_write
 * (create, reconcile).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, TOKENS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const chequing = idFor(CAD, "acc", 1);
const visa = idFor(CAD, "acc", 2);

describe("ynab_accounts", () => {
  it("list hides closed accounts by default and formats amounts in the budget currency", async () => {
    const r = await h.call("ynab_accounts", { action: "list" });
    expect(r.json.count).toBe(3);
    expect(r.json.accounts.map((a: any) => a.name)).toEqual(["Chequing", "Visa Infinite", "House Asset"]);
    expect(r.json.accounts[1]).toEqual({
      id: visa,
      name: "Visa Infinite",
      type: "Credit Card",
      balance: "-$250.50",
      clearedBalance: "-$200.50",
      unclearedBalance: "-$50.00",
      onBudget: true,
      closed: false,
      deleted: false,
    });
  });

  it("list applies include_closed, type and on_budget filters", async () => {
    const all = await h.call("ynab_accounts", { action: "list", include_closed: true });
    expect(all.json.count).toBe(4);
    const cards = await h.call("ynab_accounts", { action: "list", type: "creditCard" });
    expect(cards.json.accounts.map((a: any) => a.name)).toEqual(["Visa Infinite"]);
    const tracking = await h.call("ynab_accounts", { action: "list", on_budget: false });
    expect(tracking.json.accounts.map((a: any) => a.name)).toEqual(["House Asset"]);
  });

  it("get resolves an account by partial name", async () => {
    const r = await h.call("ynab_accounts", { action: "get", account: "visa" });
    // note / lastReconciledAt are null in YNAB, so they drop out of the JSON.
    expect(r.json).toEqual({
      id: visa,
      name: "Visa Infinite",
      type: "Credit Card",
      balance: "-$250.50",
      clearedBalance: "-$200.50",
      unclearedBalance: "-$50.00",
      onBudget: true,
      closed: false,
    });
    expect(h.fake.requests.at(-1)!.path).toBe(`/plans/${CAD}/accounts/${visa}`);
  });

  it("get requires an account", async () => {
    const r = await h.call("ynab_accounts", { action: "get" });
    expect(r.text).toBe("Error: 'account' parameter required for 'get' action");
  });

  it("get reports an unknown account with the available names", async () => {
    const r = await h.call("ynab_accounts", { action: "get", account: "Brokerage" });
    expect(r.text).toBe("Error: Account 'Brokerage' not found. Available: Chequing, Visa Infinite, Old Savings, House Asset");
  });

  it("balances totals assets and liabilities of open accounts", async () => {
    const r = await h.call("ynab_accounts", { action: "balances" });
    expect(r.json).toMatchObject({
      budget: "Personal CAD",
      currency: "CAD",
      totalAssets: "$301,500.00",
      totalLiabilities: "$250.50",
      netWorth: "$301,249.50",
    });
    expect(r.json.accounts).toHaveLength(3);
  });

  it("rejects an account type outside the enum at the schema level", async () => {
    await expect(h.call("ynab_accounts", { action: "list", type: "brokerage" })).rejects.toThrow(/Invalid arguments for tool ynab_accounts/);
    expect(h.fake.requests).toHaveLength(0);
  });
});

describe("ynab_accounts_write create", () => {
  it("creates an account with the starting balance in milliunits", async () => {
    const r = await h.call("ynab_accounts_write", {
      action: "create", budget: "usd", name: "New Savings", type: "savings", balance: 123.45,
    });
    expect(h.fake.writes()).toEqual([{
      method: "POST",
      path: `/plans/${PLANS.usd}/accounts`,
      query: {},
      token: TOKENS.personal,
      body: { account: { name: "New Savings", type: "savings", balance: 123450 } },
    }]);
    expect(r.json).toMatchObject({
      success: true,
      message: "Account created",
      account: { name: "New Savings", type: "Savings", balance: "$123.45", onBudget: true },
    });
  });

  it("defaults the starting balance to zero", async () => {
    await h.call("ynab_accounts_write", { action: "create", name: "Cash Jar", type: "cash" });
    expect(h.fake.writes()[0].body).toEqual({ account: { name: "Cash Jar", type: "cash", balance: 0 } });
  });

  it("rejects the account types the YNAB API cannot create, listing the 6 allowed ones", async () => {
    for (const type of ["lineOfCredit", "mortgage", "autoLoan", "studentLoan", "personalLoan", "medicalDebt", "otherDebt"]) {
      const r = await h.call("ynab_accounts_write", { action: "create", name: "Loan", type });
      expect(r.isError).toBe(true);
      expect(r.text).toBe(
        `Error: Account type '${type}' cannot be created through the YNAB API. Allowed types for 'create': checking, savings, cash, creditCard, otherAsset, otherLiability`
      );
    }
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("creates each of the 6 allowed types", async () => {
    for (const type of ["checking", "savings", "cash", "creditCard", "otherAsset", "otherLiability"]) {
      const r = await h.call("ynab_accounts_write", { action: "create", name: `A-${type}`, type });
      expect(r.isError).toBeUndefined();
    }
    expect(h.fake.writes()).toHaveLength(6);
  });

  it("requires name and type, and writes nothing without them", async () => {
    const noName = await h.call("ynab_accounts_write", { action: "create", type: "cash" });
    expect(noName.text).toBe("Error: 'name' is required for 'create' action");
    const noType = await h.call("ynab_accounts_write", { action: "create", name: "X" });
    expect(noType.text).toBe("Error: 'type' is required for 'create' action");
    expect(h.fake.writes()).toHaveLength(0);
  });
});

describe("ynab_accounts_write reconcile", () => {
  it("creates a reconciled adjustment for the gap to the cleared balance", async () => {
    // Visa cleared balance is -200.50; the statement says -210.00.
    const r = await h.call("ynab_accounts_write", { action: "reconcile", account: "Visa", balance: -210 });
    const writes = h.fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "POST", path: `/plans/${CAD}/transactions`, token: TOKENS.personal });
    expect(writes[0].body).toEqual({
      transaction: {
        account_id: visa,
        amount: -9500,
        date: "2026-09-15",
        payee_name: "Reconciliation Balance Adjustment",
        memo: "Adjustment to reconcile balance to -$210.00",
        cleared: "reconciled",
        approved: true,
      },
    });
    expect(r.json).toEqual({
      success: true,
      message: "Account reconciled with adjustment of -$9.50",
      account: {
        name: "Visa Infinite",
        previousClearedBalance: "-$200.50",
        reconciledBalance: "-$210.00",
        adjustment: "-$9.50",
      },
      note: "All cleared transactions should now be marked as reconciled in YNAB",
    });
  });

  it("writes nothing when the cleared balance already matches", async () => {
    const r = await h.call("ynab_accounts_write", { action: "reconcile", account: chequing, balance: 1500 });
    expect(h.fake.writes()).toHaveLength(0);
    expect(r.json.message).toBe("Account reconciled - balance matched");
    expect(r.json.account.adjustment).toBeNull();
  });

  it("routes reconcile to the named profile", async () => {
    await h.call("ynab_accounts_write", { action: "reconcile", profile: "kokuros", account: "Chequing", balance: 1400 });
    const [w] = h.fake.writes();
    expect(w.token).toBe(TOKENS.kokuros);
    expect(w.path).toBe(`/plans/${PLANS.kokuros}/transactions`);
    expect(w.body.transaction.amount).toBe(-100000);
  });

  it("requires account and balance", async () => {
    const noAccount = await h.call("ynab_accounts_write", { action: "reconcile", balance: 1 });
    expect(noAccount.text).toBe("Error: 'account' is required for 'reconcile' action");
    const noBalance = await h.call("ynab_accounts_write", { action: "reconcile", account: "Visa" });
    expect(noBalance.text).toBe("Error: 'balance' is required for 'reconcile' action (the confirmed balance in dollars)");
    expect(h.fake.writes()).toHaveLength(0);
  });
});
