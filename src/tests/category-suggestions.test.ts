/**
 * ynab_transactions_write: suggest_categories (history-based, read-only) and
 * apply_category_suggestions (guarded, dry_run defaults to true).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";
import { contentFingerprint } from "../utils/fingerprint.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const cat = (n: number) => idFor(CAD, "cat", n);
const txn = (n: number) => idFor(CAD, "txn", n);
const pay = (n: number) => idFor(CAD, "pay", n);

let extra = 0;
function addTxn(fields: Record<string, any>) {
  const t = {
    id: `hist-${++extra}`, date: "2026-08-01", amount: -10_000, memo: null, cleared: "cleared", approved: true,
    account_id: idFor(CAD, "acc", 1), account_name: "Chequing", payee_id: null, payee_name: null,
    category_id: null, category_name: null, transfer_account_id: null, deleted: false, subtransactions: [], ...fields,
  };
  h.fake.plan(CAD).transactions.push(t);
  return t;
}
/** Costco history: Groceries x2, Household x1. */
function costcoHistory() {
  const base = { payee_id: pay(4), payee_name: "Costco Wholesale" };
  addTxn({ ...base, date: "2026-07-01", category_id: cat(3), category_name: "Groceries" });
  addTxn({ ...base, date: "2026-07-08", category_id: cat(3), category_name: "Groceries" });
  addTxn({ ...base, date: "2026-07-15", category_id: cat(4), category_name: "Household" });
}

const suggest = (extra: Record<string, unknown> = {}) =>
  h.call("ynab_transactions_write", { action: "suggest_categories", ...extra });
const apply = (args: Record<string, unknown>) =>
  h.call("ynab_transactions_write", { action: "apply_category_suggestions", ...args });

describe("suggest_categories", () => {
  it("suggests the most common category for the same payee, read-only", async () => {
    costcoHistory();
    const r = await suggest();
    expect(r.isError).toBeUndefined();
    expect(r.json.source).toContain("history");
    expect(r.json.suggestions).toEqual([{
      transaction_id: txn(3), date: "2026-09-10", payee: "Costco Wholesale", amount: "-$45.00",
      suggested_category_id: cat(3), suggested_category: "Groceries",
      based_on: "2 of 3 past transactions for this payee",
      expected_content_fingerprint: contentFingerprint(h.fake.plan(CAD).transactions.find((t) => t.id === txn(3))),
    }]);
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("makes no suggestion without history for that payee", async () => {
    const r = await suggest();
    expect(r.json.suggestions).toEqual([]);
    expect(r.json.without_history).toBe(1);
  });

  it("ignores splits, transfers, deleted rows and hidden categories in the history", async () => {
    // Costco's only other history is a split (txn 4); add junk that must not count.
    addTxn({ payee_name: "Costco Wholesale", category_id: cat(6), category_name: "Retired" }); // hidden category
    addTxn({ payee_name: "Costco Wholesale", category_id: cat(3), category_name: "Groceries", deleted: true });
    addTxn({ payee_name: "Costco Wholesale", category_id: cat(3), category_name: "Groceries", transfer_account_id: idFor(CAD, "acc", 2) });
    const r = await suggest();
    expect(r.json.suggestions).toEqual([]);
  });

  it("breaks ties by the most recent use, and honours since_date and limit", async () => {
    const base = { payee_id: pay(4), payee_name: "costco wholesale" };
    addTxn({ ...base, date: "2026-06-01", category_id: cat(3), category_name: "Groceries" });
    addTxn({ ...base, date: "2026-07-01", category_id: cat(4), category_name: "Household" });
    addTxn({ payee_name: "Costco Wholesale", date: "2026-09-11", category_id: null });
    const r = await suggest();
    expect(r.json.suggestions.map((s: any) => [s.transaction_id, s.suggested_category])).toEqual([
      [expect.stringContaining("hist-"), "Household"],
      [txn(3), "Household"],
    ]);
    const recent = await suggest({ since_date: "2026-09-11" });
    expect(recent.json.suggestions).toHaveLength(1);
    const capped = await suggest({ limit: 1 });
    expect(capped.json.suggestions).toHaveLength(1);
  });
});

describe("apply_category_suggestions", () => {
  async function oneSuggestion() {
    costcoHistory();
    return (await suggest()).json.suggestions[0];
  }

  it("defaults to a dry run and writes nothing", async () => {
    const s = await oneSuggestion();
    const r = await apply({ suggestions: [{ transaction_id: s.transaction_id, category_id: s.suggested_category_id, expected_content_fingerprint: s.expected_content_fingerprint }] });
    expect(r.json.dry_run).toBe(true);
    expect(r.json.would_apply).toHaveLength(1);
    expect(r.json.applied_count).toBe(0);
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("writes one bulk PATCH only when dry_run is false", async () => {
    const s = await oneSuggestion();
    const r = await apply({
      dry_run: false,
      suggestions: [{ transaction_id: s.transaction_id, category_id: s.suggested_category_id, expected_content_fingerprint: s.expected_content_fingerprint }],
    });
    expect(h.fake.writes().map((w) => [w.method, w.path, w.body])).toEqual([
      ["PATCH", `/plans/${CAD}/transactions`, { transactions: [{ id: txn(3), category_id: cat(3) }] }],
    ]);
    expect(r.json.applied_count).toBe(1);
    expect(r.json.applied[0]).toMatchObject({ transaction_id: txn(3), category: "Groceries" });
  });

  it("skips a transaction that changed since it was suggested", async () => {
    const s = await oneSuggestion();
    h.fake.plan(CAD).transactions.find((t) => t.id === txn(3)).amount = -99_000; // edited in YNAB meanwhile
    const r = await apply({
      dry_run: false,
      suggestions: [{ transaction_id: s.transaction_id, category_id: s.suggested_category_id, expected_content_fingerprint: s.expected_content_fingerprint }],
    });
    expect(r.json.applied_count).toBe(0);
    expect(r.json.skipped[0].reason).toContain("fingerprint mismatch");
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("skips unknown categories, missing and deleted transactions, and duplicates", async () => {
    const s = await oneSuggestion();
    const good = { transaction_id: s.transaction_id, category_id: s.suggested_category_id, expected_content_fingerprint: s.expected_content_fingerprint };
    const r = await apply({
      dry_run: false,
      suggestions: [
        good,
        good,
        { ...good, transaction_id: txn(2), category_id: "nope" },
        { transaction_id: "missing", category_id: cat(3), expected_content_fingerprint: "x" },
        { transaction_id: txn(6), category_id: cat(3), expected_content_fingerprint: "x" },
      ],
    });
    expect(r.json.applied_count).toBe(1);
    expect(r.json.skipped.map((x: any) => x.reason)).toEqual([
      "duplicate suggestion for this transaction",
      "category 'nope' not found",
      expect.stringContaining("could not load transaction"),
      "transaction was deleted",
    ]);
  });

  it("requires suggestions", async () => {
    const r = await apply({});
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Error: 'suggestions' array is required for apply_category_suggestions action");
  });
});
