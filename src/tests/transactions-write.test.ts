/**
 * Characterization: ynab_transactions_write — every action, including
 * `adjust` (balance adjustment for tracking accounts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, TOKENS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const acc = (n: number) => idFor(CAD, "acc", n);
const cat = (n: number) => idFor(CAD, "cat", n);
const pay = (n: number) => idFor(CAD, "pay", n);
const txn = (n: number) => idFor(CAD, "txn", n);

describe("create", () => {
  it("resolves names to ids and posts milliunits, dated today, uncleared and approved", async () => {
    const r = await h.call("ynab_transactions_write", {
      action: "create", account: "Chequing", amount: -12.34, payee: "Loblaws", category: "Groceries", memo: "milk",
    });
    const writes = h.fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "POST", path: `/plans/${CAD}/transactions`, token: TOKENS.personal });
    expect(writes[0].body).toEqual({
      transaction: {
        account_id: acc(1),
        amount: -12340,
        date: "2026-09-15",
        cleared: "uncleared",
        approved: true,
        payee_id: pay(1),
        category_id: cat(3),
        memo: "milk",
      },
    });
    expect(r.json.success).toBe(true);
    expect(r.json.message).toBe("Transaction created");
    expect(r.json.transaction).toEqual({
      id: expect.any(String),
      date: "2026-09-15",
      amount: "-$12.34",
      payee: "Loblaws",
      category: "Groceries",
      memo: "milk",
      status: "Uncleared",
      account: "Chequing",
      flag_name: null,
    });
  });

  it("sends an unknown payee by name so YNAB creates it, and honours cleared/date", async () => {
    await h.call("ynab_transactions_write", {
      action: "create", account: "Visa", amount: 20, payee: "Brand New Shop", cleared: "cleared", date: "2026-09-01",
    });
    expect(h.fake.writes()[0].body.transaction).toEqual({
      account_id: acc(2), amount: 20000, date: "2026-09-01", cleared: "cleared", approved: true, payee_name: "Brand New Shop",
    });
  });

  it("builds subtransactions from splits", async () => {
    const r = await h.call("ynab_transactions_write", {
      action: "create", account: "Chequing", amount: -100, payee: "Costco Wholesale",
      splits: [
        { amount: -60, category: "Groceries", memo: "food" },
        { amount: -40, category: "Everyday: Household" },
      ],
    });
    expect(h.fake.writes()[0].body.transaction.subtransactions).toEqual([
      { amount: -60000, category_id: cat(3), memo: "food" },
      { amount: -40000, category_id: cat(4) },
    ]);
    expect(h.fake.writes()[0].body.transaction.category_id).toBeUndefined();
    expect(r.json.transaction.category).toBe("Split");
  });

  it("falls back to the budget's default account when the budget alias is given", async () => {
    await h.call("ynab_transactions_write", { action: "create", budget: "cad", amount: -5 });
    expect(h.fake.writes()[0].body.transaction.account_id).toBe(acc(1)); // YNAB_DEFAULT_ACCOUNT_CAD=Chequing

    h.reset();
    await h.call("ynab_transactions_write", { action: "create", profile: "kokuros", budget: "kokuros", amount: -5 });
    const [w] = h.fake.writes();
    expect(w.token).toBe(TOKENS.kokuros);
    expect(w.body.transaction.account_id).toBe(idFor(PLANS.kokuros, "acc", 2)); // YNAB_DEFAULT_ACCOUNT_KOKUROS=Visa Infinite
  });

  it("does not use a default account when no budget alias is given", async () => {
    const r = await h.call("ynab_transactions_write", { action: "create", amount: -5 });
    expect(r.text).toBe("Error: No account specified and no default account configured");
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("requires an amount", async () => {
    const r = await h.call("ynab_transactions_write", { action: "create", account: "Chequing" });
    expect(r.text).toBe("Error: 'amount' is required for create action");
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("reports a YNAB API failure as error text", async () => {
    h.fake.failNext("POST", /\/transactions$/, 400, "account_id is invalid");
    const r = await h.call("ynab_transactions_write", { action: "create", account: "Chequing", amount: -1 });
    // The SDK throws YNAB's error body as a plain object; getErrorMessage
    // surfaces YNAB's own detail instead of "[object Object]".
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Error: account_id is invalid (400 bad_request)");
  });
});

describe("update", () => {
  it("reads the transaction, merges the changes and PUTs it back", async () => {
    const r = await h.call("ynab_transactions_write", {
      action: "update", transaction_id: txn(2), amount: -90, memo: "updated", category: "Household",
    });
    expect(h.fake.requests.filter((q) => q.path.endsWith(`/transactions/${txn(2)}`)).map((q) => q.method)).toEqual(["GET", "PUT"]);
    expect(h.fake.writes()[0].body).toEqual({
      transaction: {
        account_id: acc(2), amount: -90000, date: "2026-09-05", cleared: "cleared", approved: true,
        category_id: cat(4), memo: "updated",
      },
    });
    expect(r.json).toMatchObject({ success: true, message: "Transaction updated" });
    expect(r.json.transaction).toMatchObject({ amount: "-$90.00", category: "Household", memo: "updated" });
  });

  it("requires transaction_id", async () => {
    const r = await h.call("ynab_transactions_write", { action: "update", amount: 1 });
    expect(r.text).toBe("Error: 'transaction_id' is required for update action");
  });
});

describe("delete, approve, bulk_approve, import", () => {
  it("delete sends DELETE and echoes the id", async () => {
    const r = await h.call("ynab_transactions_write", { action: "delete", transaction_id: txn(3) });
    expect(h.fake.writes()).toEqual([{ method: "DELETE", path: `/plans/${CAD}/transactions/${txn(3)}`, query: {}, token: TOKENS.personal, body: undefined }]);
    expect(r.json).toEqual({ success: true, message: "Transaction deleted", transaction_id: txn(3) });
  });

  it("approve PUTs only the approval flag", async () => {
    const r = await h.call("ynab_transactions_write", { action: "approve", transaction_id: txn(3) });
    expect(h.fake.writes()[0]).toMatchObject({ method: "PUT", body: { transaction: { approved: true } } });
    expect(r.json.message).toBe("Transaction approved");

    h.reset();
    const un = await h.call("ynab_transactions_write", { action: "approve", transaction_id: txn(2), approved: false });
    expect(h.fake.writes()[0].body).toEqual({ transaction: { approved: false } });
    expect(un.json.message).toBe("Transaction unapproved");
  });

  it("bulk_approve PATCHes every id", async () => {
    const r = await h.call("ynab_transactions_write", { action: "bulk_approve", transaction_ids: [txn(3), txn(4)] });
    expect(h.fake.writes()[0]).toMatchObject({
      method: "PATCH",
      path: `/plans/${CAD}/transactions`,
      body: { transactions: [{ id: txn(3), approved: true }, { id: txn(4), approved: true }] },
    });
    expect(r.json).toEqual({
      success: true,
      message: "Approved 2 transaction(s)",
      approved_count: 2,
      transactions: [
        { id: txn(3), date: "2026-09-10", amount: "-45.00", payee: "Costco Wholesale", approved: true },
        { id: txn(4), date: "2026-09-12", amount: "-826.08", payee: "Costco Wholesale", approved: true },
      ],
    });
  });

  it("bulk_approve requires ids", async () => {
    const r = await h.call("ynab_transactions_write", { action: "bulk_approve", transaction_ids: [] });
    expect(r.text).toBe("Error: 'transaction_ids' array is required for bulk_approve action");
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("import triggers a linked-account import", async () => {
    const r = await h.call("ynab_transactions_write", { action: "import" });
    expect(h.fake.writes()[0]).toMatchObject({ method: "POST", path: `/plans/${CAD}/transactions/import` });
    expect(r.json).toEqual({
      success: true,
      transaction_ids: ["imported-1", "imported-2"],
      imported_count: 2,
      message: "Imported 2 transaction(s) from linked accounts",
    });
  });
});

describe("adjust", () => {
  it("posts the difference to the target balance as a cleared 'Balance Adjustment'", async () => {
    // House Asset (tracking) is at 300,000.00
    const r = await h.call("ynab_transactions_write", { action: "adjust", account: "House Asset", amount: 305000 });
    expect(h.fake.writes()).toHaveLength(1);
    expect(h.fake.writes()[0].body).toEqual({
      transaction: {
        account_id: acc(4),
        amount: 5000000,
        date: "2026-09-15",
        payee_name: "Balance Adjustment",
        memo: "Adjustment to 305000",
        cleared: "cleared",
        approved: true,
      },
    });
    expect(r.json).toMatchObject({
      success: true,
      message: "Balance adjustment created",
      previousBalance: 300000,
      newBalance: 305000,
      adjustment: 5000,
    });
    expect(r.json.transaction).toMatchObject({ amount: "$5,000.00", payee: "Balance Adjustment", account: "House Asset" });
  });

  it("uses the given memo and date, and handles a decrease", async () => {
    await h.call("ynab_transactions_write", {
      action: "adjust", account: "Chequing", amount: 1234.56, memo: "statement 2026-09", date: "2026-09-30",
    });
    expect(h.fake.writes()[0].body.transaction).toMatchObject({
      amount: -265440, memo: "statement 2026-09", date: "2026-09-30",
    });
  });

  it("writes nothing when the balance already matches", async () => {
    const r = await h.call("ynab_transactions_write", { action: "adjust", account: "Chequing", amount: 1500 });
    expect(h.fake.writes()).toHaveLength(0);
    expect(r.json).toEqual({
      success: true,
      message: "No adjustment needed - balance already matches target",
      currentBalance: 1500,
      targetBalance: 1500,
    });
  });

  it("routes to the chosen profile", async () => {
    await h.call("ynab_transactions_write", { action: "adjust", profile: "kokuros", account: "House Asset", amount: 0 });
    const [w] = h.fake.writes();
    expect(w.token).toBe(TOKENS.kokuros);
    expect(w.path).toBe(`/plans/${PLANS.kokuros}/transactions`);
    expect(w.body.transaction.amount).toBe(-300000000);
  });

  it("requires account and amount", async () => {
    expect((await h.call("ynab_transactions_write", { action: "adjust", amount: 1 })).text)
      .toBe("Error: 'account' is required for adjust action");
    expect((await h.call("ynab_transactions_write", { action: "adjust", account: "Chequing" })).text)
      .toBe("Error: 'amount' is required for adjust action (the target balance in dollars)");
    expect(h.fake.writes()).toHaveLength(0);
  });
});

describe("scheduled transactions", () => {
  it("create_scheduled resolves names and posts the schedule", async () => {
    const r = await h.call("ynab_transactions_write", {
      action: "create_scheduled", account: "Chequing", date: "2026-10-15", amount: -50,
      payee: "Landlord Inc", category: "Rent", frequency: "monthly", memo: "parking",
    });
    expect(h.fake.writes()[0]).toMatchObject({ method: "POST", path: `/plans/${CAD}/scheduled_transactions` });
    expect(h.fake.writes()[0].body).toEqual({
      scheduled_transaction: {
        account_id: acc(1), date: "2026-10-15", amount: -50000, frequency: "monthly", memo: "parking",
        payee_id: pay(2), category_id: cat(1),
      },
    });
    expect(r.json).toMatchObject({
      success: true,
      message: "Scheduled transaction created",
      scheduled_transaction: { frequency: "monthly", amount: "-50.00", account: "Chequing", payee: "Landlord Inc", category: "Rent", memo: "parking" },
    });
  });

  it("create_scheduled requires account and date", async () => {
    expect((await h.call("ynab_transactions_write", { action: "create_scheduled", date: "2026-10-01" })).text)
      .toBe("Error: 'account' is required for create_scheduled action");
    expect((await h.call("ynab_transactions_write", { action: "create_scheduled", account: "Chequing" })).text)
      .toBe("Error: 'date' is required for create_scheduled action (first occurrence, YYYY-MM-DD)");
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("update_scheduled keeps account and next date unless overridden", async () => {
    const sch = idFor(CAD, "sch", 1);
    const r = await h.call("ynab_transactions_write", { action: "update_scheduled", transaction_id: sch, amount: -1250 });
    expect(h.fake.writes()[0]).toMatchObject({ method: "PUT", path: `/plans/${CAD}/scheduled_transactions/${sch}` });
    expect(h.fake.writes()[0].body).toEqual({
      scheduled_transaction: { account_id: acc(1), date: "2026-10-01", amount: -1250000 },
    });
    expect(r.json).toMatchObject({ success: true, message: "Scheduled transaction updated" });
  });

  it("delete_scheduled sends DELETE", async () => {
    const sch = idFor(CAD, "sch", 1);
    const r = await h.call("ynab_transactions_write", { action: "delete_scheduled", transaction_id: sch });
    expect(h.fake.writes()).toEqual([{ method: "DELETE", path: `/plans/${CAD}/scheduled_transactions/${sch}`, query: {}, token: TOKENS.personal, body: undefined }]);
    expect(r.json).toEqual({ success: true, message: "Scheduled transaction deleted", transaction_id: sch });
  });
});

describe("argument validation", () => {
  it("rejects an unknown action and bad enums at the schema level, before any API call", async () => {
    await expect(h.call("ynab_transactions_write", { action: "transfer" })).rejects.toThrow(/Invalid arguments for tool ynab_transactions_write/);
    await expect(h.call("ynab_transactions_write", { action: "create_scheduled", frequency: "fortnightly" })).rejects.toThrow(/Invalid arguments/);
    await expect(h.call("ynab_transactions_write", { action: "create", amount: "12" })).rejects.toThrow(/Invalid arguments/);
    expect(h.fake.requests).toHaveLength(0);
  });
});
