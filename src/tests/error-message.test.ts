/**
 * getErrorMessage: YNAB API errors (plain objects thrown by the SDK) show
 * YNAB's own message instead of "[object Object]".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type Harness } from "./helpers/harness.js";
import { getErrorMessage } from "../utils/formatter.js";

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });

describe("getErrorMessage", () => {
  it("handles Error, string, YNAB error bodies and unknown values", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("plain")).toBe("plain");
    expect(getErrorMessage({ error: { id: "404.2", name: "resource_not_found", detail: "Resource not found" } }))
      .toBe("Resource not found (404.2 resource_not_found)");
    expect(getErrorMessage({ message: "just a message" })).toBe("just a message");
    expect(getErrorMessage({ foo: 1 })).toBe('{"foo":1}');
    expect(getErrorMessage(undefined)).toBe("undefined");
  });
});

describe("YNAB API errors through the tools", () => {
  it("shows the YNAB detail for a failed read", async () => {
    h.fake.failNext("GET", /\/accounts$/, 429, "Too many requests");
    const r = await h.call("ynab_accounts", { action: "list" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Error: Too many requests (429 bad_request)");
  });

  it("shows the YNAB detail for a failed category write", async () => {
    h.fake.failNext("PATCH", /\/categories\//, 400, "budgeted is invalid");
    const r = await h.call("ynab_categories_write", { action: "update", category: "Groceries", amount: 5 });
    expect(r.text).toBe("Error: budgeted is invalid (400 bad_request)");
  });
});
