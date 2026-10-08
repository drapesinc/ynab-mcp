/**
 * Characterization: ynab_transactions_read (list, search, unapproved, scheduled).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, TOKENS, type Harness, expectInvalid } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const txn = (n: number) => idFor(CAD, "txn", n);
const visa = idFor(CAD, "acc", 2);
const ids = (r: any) => r.json.transactions.map((t: any) => t.id);

describe("ynab_transactions_read list", () => {
  it("returns formatted rows, newest first, from the plan-wide endpoint", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list" });
    expect(h.fake.requests.map((q) => q.path)).toEqual([`/plans/${CAD}`, `/plans/${CAD}/transactions`]);
    expect(r.json.budget).toBe("Personal CAD");
    expect(r.json.currency).toBe("CAD");
    // The fork passes through whatever the API returns, including deleted rows.
    expect(ids(r)).toEqual([txn(4), txn(3), txn(2), txn(1), txn(5), txn(6)]);
    expect(r.json.count).toBe(6);
  });

  it("formats an ordinary transaction with exactly these fields", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list" });
    const byId = Object.fromEntries(r.json.transactions.map((t: any) => [t.id, t]));
    expect(byId[txn(2)]).toEqual({
      id: txn(2),
      date: "2026-09-05",
      amount: "-$82.45",
      payee: "Loblaws",
      category: "Groceries",
      memo: "",
      status: "Cleared",
      account: "Visa Infinite",
      flag_name: "Check",
    });
    expect(byId[txn(3)]).toEqual({
      id: txn(3),
      date: "2026-09-10",
      amount: "-$45.00",
      payee: "Costco Wholesale",
      category: "Uncategorized",
      memo: "bulk run",
      status: "Uncleared, Unapproved",
      account: "Chequing",
      flag_name: null,
    });
    expect(byId[txn(1)].status).toBe("Reconciled");
  });

  it("shows a split's parent row with the 'Split' category", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list" });
    const split = r.json.transactions.find((t: any) => t.id === txn(4));
    expect(split).toMatchObject({ amount: "-$826.08", category: "Split", payee: "Costco Wholesale", memo: "Costco haul" });
  });

  it("uses the account endpoint (with since_date) when an account is given", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list", account: "Visa", since_date: "2026-09-01" });
    const last = h.fake.requests.at(-1)!;
    expect(last.path).toBe(`/plans/${CAD}/accounts/${visa}/transactions`);
    expect(last.query).toEqual({ since_date: "2026-09-01" });
    expect(ids(r)).toEqual([txn(2)]);
  });

  it("uses the month endpoint when a month is given", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list", month: "2026-08-01" });
    expect(h.fake.requests.at(-1)!.path).toBe(`/plans/${CAD}/months/2026-08-01/transactions`);
    expect(ids(r)).toEqual([txn(5), txn(6)]);
  });

  it("sends since_date to the plan-wide endpoint and filters until_date locally", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list", since_date: "2026-09-05", until_date: "2026-09-10" });
    expect(h.fake.requests.at(-1)!.query).toEqual({ since_date: "2026-09-05" });
    expect(ids(r)).toEqual([txn(3), txn(2)]);
  });

  it("filters by payee, memo, status, type and amount range", async () => {
    expect(ids(await h.call("ynab_transactions_read", { action: "list", payee: "costco" }))).toEqual([txn(4), txn(3)]);
    expect(ids(await h.call("ynab_transactions_read", { action: "list", memo: "RENT" }))).toEqual([txn(1)]);
    expect(ids(await h.call("ynab_transactions_read", { action: "list", status: "uncleared" }))).toEqual([txn(3)]);
    expect(ids(await h.call("ynab_transactions_read", { action: "list", type: "unapproved" }))).toEqual([txn(4), txn(3)]);
    expect(ids(await h.call("ynab_transactions_read", { action: "list", type: "uncategorized" }))).toEqual([txn(3), txn(6)]);
    expect(ids(await h.call("ynab_transactions_read", { action: "list", min_amount: -100, max_amount: -40 }))).toEqual([txn(3), txn(2)]);
  });

  it("filters by category name", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list", category: "Everyday: Groceries" });
    expect(ids(r)).toContain(txn(2));
    expect(ids(r)).not.toContain(txn(1));
  });

  it("applies limit after sorting", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list", limit: 2 });
    expect(ids(r)).toEqual([txn(4), txn(3)]);
    expect(r.json.count).toBe(2);
  });

  it("search behaves like list", async () => {
    const r = await h.call("ynab_transactions_read", { action: "search", payee: "loblaws" });
    expect(ids(r)).toEqual([txn(2)]);
  });

  it("reads the chosen profile's budget", async () => {
    const r = await h.call("ynab_transactions_read", { action: "list", profile: "kokuros", limit: 1 });
    expect(r.json.budget).toBe("Kokuros Micromarkets");
    expect(r.json.transactions[0].id).toBe(idFor(PLANS.kokuros, "txn", 4));
    expect(h.fake.requests.every((q) => q.token === TOKENS.kokuros)).toBe(true);
  });

  it("rejects an invalid status at the schema level", async () => {
    await expectInvalid(h.call("ynab_transactions_read", { action: "list", status: "pending" }), /Invalid arguments/);
  });
});

describe("ynab_transactions_read unapproved", () => {
  it("returns only unapproved rows with a note", async () => {
    const r = await h.call("ynab_transactions_read", { action: "unapproved" });
    expect(ids(r)).toEqual([txn(4), txn(3)]);
    expect(r.json.note).toBe("These transactions need approval");
    expect(Object.keys(r.json)).toEqual(["budget", "currency", "count", "note", "transactions"]);
  });

  it("uses the account endpoint when an account is given", async () => {
    const r = await h.call("ynab_transactions_read", { action: "unapproved", account: "Chequing" });
    expect(h.fake.requests.at(-1)!.path).toBe(`/plans/${CAD}/accounts/${idFor(CAD, "acc", 1)}/transactions`);
    expect(ids(r)).toEqual([txn(4), txn(3)]);
  });
});

describe("ynab_transactions_read scheduled", () => {
  it("lists non-deleted scheduled transactions", async () => {
    const r = await h.call("ynab_transactions_read", { action: "scheduled" });
    expect(r.json).toEqual({
      budget: "Personal CAD",
      currency: "CAD",
      count: 1,
      scheduled_transactions: [{
        id: idFor(CAD, "sch", 1),
        date_first: "2026-01-01",
        date_next: "2026-10-01",
        frequency: "monthly",
        amount: "-1200.00",
        account: "Chequing",
        payee: "Landlord Inc",
        category: "Rent",
        memo: "rent",
      }],
    });
  });
});
