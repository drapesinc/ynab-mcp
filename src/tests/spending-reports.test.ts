/**
 * ynab_transactions_read: spending_by_category, spending_by_payee, cash_flow.
 * Splits count by leg, transfers and deleted rows are left out.
 * "Today" is 2026-09-15 (FIXED_NOW).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const cat = (n: number) => idFor(CAD, "cat", n);

function addTxn(fields: Record<string, any>) {
  h.fake.plan(CAD).transactions.push({
    id: `extra-${h.fake.plan(CAD).transactions.length}`, date: "2026-09-02", amount: 0, memo: null, cleared: "cleared",
    approved: true, account_id: idFor(CAD, "acc", 1), account_name: "Chequing", payee_id: null, payee_name: null,
    category_id: null, category_name: null, transfer_account_id: null, deleted: false, subtransactions: [], ...fields,
  });
}

describe("spending_by_category", () => {
  it("defaults to this month, counts split legs and skips deleted legs", async () => {
    const r = await h.call("ynab_transactions_read", { action: "spending_by_category" });
    expect(r.isError).toBeUndefined();
    expect(r.json.since_date).toBe("2026-09-01");
    expect(r.json.totalSpent).toBe("$2,153.53");
    expect(r.json.categories.map((c: any) => [c.name, c.spent, c.transactions])).toEqual([
      ["Rent", "$1,200.00", 1],
      ["Groceries", "$558.53", 2], // Loblaws 82.45 + split leg 476.08
      ["Household", "$350.00", 1], // split leg only
      ["Uncategorized", "$45.00", 1],
    ]);
    expect(r.json.categories.map((c: any) => c.name)).not.toContain("Split");
    expect(r.json.categories.map((c: any) => c.name)).not.toContain("Phone"); // deleted leg
  });

  it("leaves out transfers and Ready to Assign inflows, and nets refunds", async () => {
    addTxn({ amount: -200_000, payee_name: "Transfer : Visa Infinite", transfer_account_id: idFor(CAD, "acc", 2) });
    addTxn({ amount: 500_000, payee_name: "Employer", category_id: cat(99), category_name: "Inflow: Ready to Assign" });
    addTxn({ amount: 20_450, payee_name: "Loblaws", category_id: cat(3), category_name: "Groceries" }); // refund
    const r = await h.call("ynab_transactions_read", { action: "spending_by_category" });
    expect(r.json.totalSpent).toBe("$2,133.08");
    expect(r.json.categories.find((c: any) => c.name === "Groceries").spent).toBe("$538.08");
    expect(r.json.categories.map((c: any) => c.name)).not.toContain("Inflow: Ready to Assign");
  });

  it("honours since_date, until_date and limit", async () => {
    const r = await h.call("ynab_transactions_read", {
      action: "spending_by_category", since_date: "2026-09-01", until_date: "2026-09-09", limit: 1,
    });
    // Only Rent (09-01) and Loblaws (09-05) fall in range.
    expect(r.json.totalSpent).toBe("$1,282.45");
    expect(r.json.rowCount).toBe(2);
    expect(r.json.shown).toBe(1);
    expect(r.json.categories).toEqual([{ name: "Rent", spent: "$1,200.00", transactions: 1, percentOfTotal: 93.6 }]);
    expect(h.fake.writes()).toHaveLength(0);
  });
});

describe("spending_by_payee", () => {
  it("groups by payee, using the parent payee for split legs", async () => {
    const r = await h.call("ynab_transactions_read", { action: "spending_by_payee" });
    expect(r.json.payees.map((p: any) => [p.name, p.spent])).toEqual([
      ["Landlord Inc", "$1,200.00"],
      ["Costco Wholesale", "$871.08"], // 45.00 + legs 350.00 + 476.08
      ["Loblaws", "$82.45"],
    ]);
  });

  it("leaves out transfers", async () => {
    addTxn({ amount: -300_000, payee_name: "Transfer : Visa Infinite", transfer_account_id: idFor(CAD, "acc", 2) });
    const r = await h.call("ynab_transactions_read", { action: "spending_by_payee" });
    expect(r.json.payees.map((p: any) => p.name)).not.toContain("Transfer : Visa Infinite");
  });
});

describe("cash_flow", () => {
  it("reports inflow, outflow and net per month for the last N months", async () => {
    const r = await h.call("ynab_transactions_read", { action: "cash_flow", months: 2 });
    expect(r.json.since_date).toBe("2026-08-01");
    expect(r.json.months).toEqual([
      { month: "2026-08", inflow: "$3,000.00", outflow: "$0.00", net: "$3,000.00" },
      { month: "2026-09", inflow: "$0.00", outflow: "$2,153.53", net: "-$2,153.53" },
    ]);
    expect(r.json.totals).toEqual({ inflow: "$3,000.00", outflow: "$2,153.53", net: "$846.47" });
  });

  it("defaults to 6 months and leaves out transfers", async () => {
    addTxn({ amount: -100_000, transfer_account_id: idFor(CAD, "acc", 2) });
    const r = await h.call("ynab_transactions_read", { action: "cash_flow" });
    expect(r.json.since_date).toBe("2026-04-01");
    expect(r.json.totals.outflow).toBe("$2,153.53");
  });

  it("validates months", async () => {
    const r = await h.call("ynab_transactions_read", { action: "cash_flow", months: 0 });
    expect(r.text).toBe("Error: 'months' must be a whole number between 1 and 60 for 'cash_flow' action");
  });
});
