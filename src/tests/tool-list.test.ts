/**
 * Characterization: the advertised tool list.
 *
 * Yaw's skills call these 8 tools by name, including the `adjust` and
 * `reconcile` actions. The full list (names, titles, descriptions, input
 * schemas) must match the committed baseline captured from the live server
 * on 2026-10-01 (e387dd3). A rename or a lost parameter fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer, type Harness } from "./helpers/harness.js";

const baseline = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/tool-list.baseline.json", import.meta.url)), "utf8"),
);

let h: Harness;
beforeAll(async () => { h = await startServer(); });
afterAll(async () => { await h.close(); });

async function listNormalized() {
  const { tools } = await h.client.listTools();
  return tools
    .map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("tool list", () => {
  it("exposes exactly the 8 consolidated ynab_* tools", async () => {
    const names = (await listNormalized()).map((t) => t.name);
    expect(names).toEqual([
      "ynab_accounts",
      "ynab_accounts_write",
      "ynab_budgets",
      "ynab_categories_read",
      "ynab_categories_write",
      "ynab_payees",
      "ynab_transactions_read",
      "ynab_transactions_write",
    ]);
  });

  it("matches the committed baseline exactly (names, descriptions, input schemas)", async () => {
    expect(h.client.getServerVersion()).toEqual(baseline.serverInfo);
    expect(await listNormalized()).toEqual(baseline.tools);
  });

  it("keeps the actions Yaw's skills depend on", async () => {
    const tools = await listNormalized();
    const actions = (name: string) =>
      (tools.find((t) => t.name === name)!.inputSchema as any).properties.action.enum;

    expect(actions("ynab_transactions_write")).toContain("adjust");
    expect(actions("ynab_categories_write")).toEqual(["create", "create_group", "update", "move", "auto_assign"]);
    expect(actions("ynab_accounts_write")).toEqual(["create", "reconcile"]);
    expect(actions("ynab_budgets")).toEqual(["list", "get", "months", "profiles"]);
  });

  it("lets every tool pick a profile and budget per call", async () => {
    for (const tool of await listNormalized()) {
      const props = (tool.inputSchema as any).properties;
      expect(props.profile, `${tool.name}.profile`).toEqual({
        type: "string",
        description: "Profile name (optional, uses default)",
      });
      expect(props.budget, `${tool.name}.budget`).toBeDefined();
      expect((tool.inputSchema as any).required, tool.name).toEqual(["action"]);
    }
  });

  it("advertises 13 account types on ynab_accounts_write create", async () => {
    const tool = (await listNormalized()).find((t) => t.name === "ynab_accounts_write")!;
    expect((tool.inputSchema as any).properties.type.enum).toHaveLength(13);
  });
});
