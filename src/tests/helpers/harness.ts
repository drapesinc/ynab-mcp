/**
 * Test harness: boots the real server (src/index.ts, all 8 registered tools)
 * against the fake YNAB API and talks to it as an MCP client over an
 * in-memory transport, so every test goes through the same zod validation
 * and tool registration the live server uses.
 *
 * Safety: every real YNAB_* variable is removed from process.env before the
 * server loads, only dummy tokens are configured, and fetch is replaced by the
 * fake (which refuses any non-YNAB URL and never touches the network).
 */
import { expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeYnab, PLANS, TOKENS } from "./fake-ynab.js";

export { PLANS, TOKENS } from "./fake-ynab.js";

/** "Today" for every test, so default dates and months are stable. */
export const FIXED_NOW = new Date("2026-09-15T12:00:00.000Z");

export const TEST_ENV: Record<string, string> = {
  YNAB_PROFILES: "personal,kokuros",
  YNAB_TOKEN_PERSONAL: TOKENS.personal,
  YNAB_TOKEN_KOKUROS: TOKENS.kokuros,
  YNAB_BUDGETS_PERSONAL: `cad:${PLANS.cad},ghs:${PLANS.ghs},usd:${PLANS.usd}`,
  YNAB_BUDGETS_KOKUROS: `kokuros:${PLANS.kokuros}`,
  YNAB_DEFAULT_PROFILE: "personal",
  YNAB_DEFAULT_BUDGET: "cad",
  YNAB_DEFAULT_ACCOUNT_CAD: "Chequing",
  YNAB_DEFAULT_ACCOUNT_KOKUROS: "Visa Infinite",
};

export interface ToolResult {
  raw: any;
  text: string;
  json: any;
  isError: boolean | undefined;
}

export interface Harness {
  client: Client;
  fake: FakeYnab;
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** Reset fake data, request log and the server's name-resolution caches. */
  reset(): void;
  close(): Promise<void>;
}

export async function startServer(): Promise<Harness> {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("YNAB_")) delete process.env[key];
  }
  Object.assign(process.env, TEST_ENV);

  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });

  const fake = new FakeYnab();
  fake.install();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
    StdioServerTransport: class {
      constructor() {
        return serverTransport;
      }
    },
  }));

  // The server logs config and tool errors to stderr; keep test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});

  await import("../../index.js");
  const resolver = await import("../../utils/resolver.js");

  const client = new Client({ name: "ynab-mcp-tests", version: "0.0.0" });
  await client.connect(clientTransport);

  return {
    client,
    fake,
    async call(name, args) {
      const raw: any = await client.callTool({ name, arguments: args });
      const text: string = raw.content?.[0]?.text ?? "";
      let json: any = undefined;
      try {
        json = JSON.parse(text);
      } catch {
        // error results are plain "Error: ..." text
      }
      return { raw, text, json, isError: raw.isError };
    },
    reset() {
      fake.reset();
      resolver.clearCaches();
    },
    async close() {
      await client.close();
      fake.uninstall();
      vi.useRealTimers();
    },
  };
}

/**
 * Assert that a call failed zod input validation. SDK <= 1.30 rejected the
 * promise; SDK >= 1.32 returns an isError result with the same message. Both
 * mean the call was refused before the handler ran, so accept either.
 */
export async function expectInvalid(call: Promise<ToolResult>, message: RegExp): Promise<void> {
  let text: string;
  try {
    const r = await call;
    expect(r.isError).toBe(true);
    text = r.text;
  } catch (e) {
    text = e instanceof Error ? e.message : String(e);
  }
  expect(text).toMatch(message);
}
