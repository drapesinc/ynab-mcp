/**
 * Characterization: ynab_categories_read (list, get) and
 * ynab_categories_write (create, create_group, update, move).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startServer, PLANS, TOKENS, type Harness } from "./helpers/harness.js";
import { idFor } from "./helpers/fake-ynab.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });
beforeEach(() => h.reset());

const CAD = PLANS.cad;
const cat = (n: number) => idFor(CAD, "cat", n);
const grp = (n: number) => idFor(CAD, "grp", n);

describe("ynab_categories_read", () => {
  it("list groups visible categories and totals every non-deleted category", async () => {
    const r = await h.call("ynab_categories_read", { action: "list" });
    expect(r.json.totals).toEqual({ budgeted: "$1,980.00", activity: "-$1,722.34", balance: "$257.66" });
    expect(r.json.categoryGroups.map((g: any) => [g.name, g.categories.map((c: any) => c.name)])).toEqual([
      ["Bills", ["Rent", "Phone"]],
      ["Everyday", ["Groceries", "Household"]],
    ]);
    expect(r.json.categoryGroups[0].categories[0]).toEqual({
      id: cat(1), name: "Rent", budgeted: "$1,200.00", activity: "-$1,200.00", balance: "$0.00",
      goalType: "Monthly Funding", hidden: false,
    });
  });

  it("list shows hidden categories in visible groups with include_hidden", async () => {
    const r = await h.call("ynab_categories_read", { action: "list", include_hidden: true });
    const everyday = r.json.categoryGroups.find((g: any) => g.name === "Everyday");
    expect(everyday.categories.map((c: any) => c.name)).toEqual(["Groceries", "Household", "Old Hobby"]);
    expect(r.json.categoryGroups.map((g: any) => g.name)).not.toContain("Hidden Categories");
  });

  it("get reads the category for the current month by default", async () => {
    const r = await h.call("ynab_categories_read", { action: "get", category: "Rent" });
    expect(h.fake.requests.at(-1)!.path).toBe(`/plans/${CAD}/months/2026-09-01/categories/${cat(1)}`);
    expect(r.json).toMatchObject({
      budget: "Personal CAD",
      month: "2026-09-01",
      currency: "CAD",
      category: { id: cat(1), name: "Rent", budgeted: "$1,200.00", goalType: "Monthly Funding", goalTarget: "$1,200.00" },
    });
  });

  it("get honours an explicit month and needs a category", async () => {
    await h.call("ynab_categories_read", { action: "get", category: "Bills: Phone", month: "2026-08-01" });
    expect(h.fake.requests.at(-1)!.path).toBe(`/plans/${CAD}/months/2026-08-01/categories/${cat(2)}`);
    const r = await h.call("ynab_categories_read", { action: "get" });
    expect(r.text).toBe("Error: 'category' is required for 'get' action");
  });

  it("reports an unknown category", async () => {
    const r = await h.call("ynab_categories_read", { action: "get", category: "Vacation" });
    expect(r.text).toBe("Error: Category 'Vacation' not found");
  });
});

describe("ynab_categories_write", () => {
  it("create looks up the group by name and posts the category with goal fields", async () => {
    const r = await h.call("ynab_categories_write", {
      action: "create", name: "Pet Food", group: "everyday", goal_target: 50, goal_target_date: "2026-12-01",
    });
    expect(h.fake.writes()).toEqual([{
      method: "POST", path: `/plans/${CAD}/categories`, query: {}, token: TOKENS.personal,
      body: { category: { name: "Pet Food", category_group_id: grp(2), goal_target: 50000, goal_target_date: "2026-12-01" } },
    }]);
    expect(r.json).toMatchObject({
      success: true, message: "Category created",
      category: { name: "Pet Food", budgeted: "$0.00", activity: "$0.00", balance: "$0.00" },
    });
  });

  it("create validates name and group, and reports a missing group", async () => {
    expect((await h.call("ynab_categories_write", { action: "create", group: "Bills" })).text)
      .toBe("Error: 'name' is required for 'create' action");
    expect((await h.call("ynab_categories_write", { action: "create", name: "X" })).text)
      .toBe("Error: 'group' is required for 'create' action (category group name or ID)");
    expect((await h.call("ynab_categories_write", { action: "create", name: "X", group: "Nope" })).text)
      .toBe("Error: Category group 'Nope' not found");
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("create_group posts the group name", async () => {
    const r = await h.call("ynab_categories_write", { action: "create_group", name: "Kids" });
    expect(h.fake.writes()[0]).toMatchObject({ method: "POST", path: `/plans/${CAD}/category_groups`, body: { category_group: { name: "Kids" } } });
    expect(r.json).toMatchObject({ success: true, message: "Category group created", category_group: { name: "Kids", hidden: false, deleted: false } });
  });

  it("update sets the budgeted amount for the month", async () => {
    const r = await h.call("ynab_categories_write", { action: "update", category: "Groceries", amount: 650 });
    expect(h.fake.writes()).toEqual([{
      method: "PATCH", path: `/plans/${CAD}/months/2026-09-01/categories/${cat(3)}`, query: {}, token: TOKENS.personal,
      body: { category: { budgeted: 650000 } },
    }]);
    expect(r.json).toEqual({
      success: true,
      message: "Category budget updated for 2026-09-01",
      category: { id: cat(3), name: "Groceries", budgeted: "$650.00", activity: "-$412.34", balance: "$237.66" },
    });
  });

  it("update requires category and amount", async () => {
    expect((await h.call("ynab_categories_write", { action: "update", amount: 1 })).text)
      .toBe("Error: 'category' is required for 'update' action");
    expect((await h.call("ynab_categories_write", { action: "update", category: "Rent" })).text)
      .toBe("Error: 'amount' is required for 'update' action");
  });

  it("move shifts budgeted money between two categories", async () => {
    const r = await h.call("ynab_categories_write", {
      action: "move", from_category: "Groceries", to_category: "Household", amount: 25, month: "2026-09-01",
    });
    const writes = h.fake.writes();
    expect(writes.map((w) => [w.method, w.path, w.body])).toEqual([
      ["PATCH", `/plans/${CAD}/months/2026-09-01/categories/${cat(3)}`, { category: { budgeted: 575000 } }],
      ["PATCH", `/plans/${CAD}/months/2026-09-01/categories/${cat(4)}`, { category: { budgeted: 125000 } }],
    ]);
    expect(r.json).toMatchObject({
      success: true,
      message: "Moved $25.00 from 'Groceries' to 'Household'",
      from: { name: "Groceries", previousBudgeted: "$600.00", newBudgeted: "$575.00" },
      to: { name: "Household", previousBudgeted: "$100.00", newBudgeted: "$125.00" },
    });
  });

  it("move refuses more than the source has budgeted, and non-positive amounts", async () => {
    const r = await h.call("ynab_categories_write", { action: "move", from_category: "Phone", to_category: "Rent", amount: 100 });
    expect(r.text).toBe("Error: Insufficient funds in 'Phone'. Available: $80.00, Requested: $100.00");
    const neg = await h.call("ynab_categories_write", { action: "move", from_category: "Phone", to_category: "Rent", amount: -1 });
    expect(neg.text).toBe("Error: 'amount' must be a positive number for 'move' action");
    expect(h.fake.writes()).toHaveLength(0);
  });

  it("routes category writes to the chosen profile", async () => {
    await h.call("ynab_categories_write", { action: "update", profile: "kokuros", category: "Rent", amount: 1 });
    const [w] = h.fake.writes();
    expect(w.token).toBe(TOKENS.kokuros);
    expect(w.path).toBe(`/plans/${PLANS.kokuros}/months/2026-09-01/categories/${idFor(PLANS.kokuros, "cat", 1)}`);
  });
});
