/**
 * Port of upstream c70658f ("expose the categories behind a split
 * transaction"). YNAB shows a split's parent row with the category "Split"
 * and keeps the real categories on its subtransactions. Without them a split
 * reads as one large uncategorized charge. Each formatted split now carries
 * `subtransactions` (non-deleted legs, amounts in the budget currency);
 * ordinary transactions do not get the field at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const splitId = idFor(CAD, "txn", 4);
const find = (r: any, id: string) => r.json.transactions.find((t: any) => t.id === id);

const EXPECTED_LEGS = [
  { amount: "-$350.00", category: "Household", memo: "printer" },
  { amount: "-$476.08", category: "Groceries", memo: "" },
];

describe("split transactions show their sub-categories", () => {
  it("list carries the non-deleted legs on the split row", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list" });
    const split = find(r, splitId);
    expect(split.category).toBe("Split");
    expect(split.subtransactions).toEqual(EXPECTED_LEGS);
  });

  it("search and unapproved carry them too", async () => {
    const search = await h.call("ynab_transactions_read", { action: "search", memo: "costco haul" });
    expect(find(search, splitId).subtransactions).toEqual(EXPECTED_LEGS);
    const unapproved = await h.call("ynab_transactions_read", { action: "unapproved" });
    expect(find(unapproved, splitId).subtransactions).toEqual(EXPECTED_LEGS);
  });

  it("ordinary transactions have no subtransactions field", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list" });
    for (const t of r.json.transactions) {
      if (t.id !== splitId) expect(Object.keys(t)).not.toContain("subtransactions");
    }
  });

  it("omits the field when every leg is deleted", async () => {
    for (const leg of h.fake.plan(CAD).transactions[3].subtransactions) leg.deleted = true;
    const r = await h.call("ynab_transactions_read", { action: "list" });
    expect(Object.keys(find(r, splitId))).not.toContain("subtransactions");
  });

  it("shows a leg's own payee and falls back to 'Uncategorized' for a leg with no category", async () => {
    const legs = h.fake.plan(CAD).transactions[3].subtransactions;
    legs[0].payee_name = "Transfer : Visa Infinite";
    legs[1].category_name = null;
    const r = await h.call("ynab_transactions_read", { action: "list" });
    expect(find(r, splitId).subtransactions).toEqual([
      { amount: "-$350.00", category: "Household", memo: "printer", payee: "Transfer : Visa Infinite" },
      { amount: "-$476.08", category: "Uncategorized", memo: "" },
    ]);
  });

  it("formats leg amounts in the budget's currency", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list", budget: "ghs" });
    const legs = find(r, idFor(PLANS.ghs, "txn", 4)).subtransactions;
    const ghs = (n: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(n);
    expect(legs.map((l: any) => l.amount)).toEqual([ghs(-350), ghs(-476.08)]);
  });

  it("a split created through ynab_transactions_write shows its legs in the response", async () => {
    const r = await h.call("ynab_transactions_write", {
      action: "create", account: "Chequing", amount: -100, payee: "Costco Wholesale",
      splits: [
        { amount: -60, category: "Groceries", memo: "food" },
        { amount: -40, category: "Household" },
      ],
    });
    expect(r.json.transaction.category).toBe("Split");
    expect(r.json.transaction.subtransactions).toEqual([
      { amount: "-$60.00", category: "Groceries", memo: "food" },
      { amount: "-$40.00", category: "Household", memo: "" },
    ]);
  });
});
