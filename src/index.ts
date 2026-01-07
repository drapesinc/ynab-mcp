#!/usr/bin/env node
/**
 * YNAB MCP Server
 *
 * Multi-profile, multi-budget YNAB integration for AI assistants.
 * Supports multiple YNAB accounts, budget aliases, and default accounts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Import consolidated tools
import * as YnabBudgets from "./tools/ynab-budgets.js";
import * as YnabAccounts from "./tools/ynab-accounts.js";
import * as YnabAccountsWrite from "./tools/ynab-accounts-write.js";
import * as YnabTransactionsRead from "./tools/ynab-transactions-read.js";
import * as YnabTransactionsWrite from "./tools/ynab-transactions-write.js";
import * as YnabCategoriesRead from "./tools/ynab-categories-read.js";
import * as YnabCategoriesWrite from "./tools/ynab-categories-write.js";
import * as YnabPayees from "./tools/ynab-payees.js";

// Validate configuration on startup
import { getConfig, listProfiles } from "./config.js";

const server = new McpServer({
  name: "ynab-mcp",
  version: "1.0.0",
});

// Validate config at startup
try {
  const config = getConfig();
  const profiles = listProfiles();
  console.error(`YNAB MCP: Loaded ${profiles.length} profile(s): ${profiles.join(", ")}`);
  console.error(`YNAB MCP: Default profile: ${config.defaultProfile}, Default budget: ${config.defaultBudget}`);
} catch (error) {
  console.error("YNAB MCP: Configuration error:", error instanceof Error ? error.message : error);
  console.error("YNAB MCP: See README for environment variable setup");
  process.exit(1);
}

// Register consolidated tools (8 total)

// Read-only tools (4)
server.registerTool(YnabBudgets.name, {
  title: "YNAB Budgets",
  description: YnabBudgets.description,
  inputSchema: YnabBudgets.inputSchema,
}, async (input) => YnabBudgets.execute(input as Parameters<typeof YnabBudgets.execute>[0]));

server.registerTool(YnabAccounts.name, {
  title: "YNAB Accounts",
  description: YnabAccounts.description,
  inputSchema: YnabAccounts.inputSchema,
}, async (input) => YnabAccounts.execute(input as Parameters<typeof YnabAccounts.execute>[0]));

server.registerTool(YnabTransactionsRead.name, {
  title: "YNAB Transactions (Read)",
  description: YnabTransactionsRead.description,
  inputSchema: YnabTransactionsRead.inputSchema,
}, async (input) => YnabTransactionsRead.execute(input as Parameters<typeof YnabTransactionsRead.execute>[0]));

server.registerTool(YnabCategoriesRead.name, {
  title: "YNAB Categories (Read)",
  description: YnabCategoriesRead.description,
  inputSchema: YnabCategoriesRead.inputSchema,
}, async (input) => YnabCategoriesRead.execute(input as Parameters<typeof YnabCategoriesRead.execute>[0]));

// Write tools (4)
server.registerTool(YnabTransactionsWrite.name, {
  title: "YNAB Transactions (Write)",
  description: YnabTransactionsWrite.description,
  inputSchema: YnabTransactionsWrite.inputSchema,
}, async (input) => YnabTransactionsWrite.execute(input as Parameters<typeof YnabTransactionsWrite.execute>[0]));

server.registerTool(YnabCategoriesWrite.name, {
  title: "YNAB Categories (Write)",
  description: YnabCategoriesWrite.description,
  inputSchema: YnabCategoriesWrite.inputSchema,
}, async (input) => YnabCategoriesWrite.execute(input as Parameters<typeof YnabCategoriesWrite.execute>[0]));

server.registerTool(YnabAccountsWrite.name, {
  title: "YNAB Accounts (Write)",
  description: YnabAccountsWrite.description,
  inputSchema: YnabAccountsWrite.inputSchema,
}, async (input) => YnabAccountsWrite.execute(input as Parameters<typeof YnabAccountsWrite.execute>[0]));

server.registerTool(YnabPayees.name, {
  title: "YNAB Payees",
  description: YnabPayees.description,
  inputSchema: YnabPayees.inputSchema,
}, async (input) => YnabPayees.execute(input as Parameters<typeof YnabPayees.execute>[0]));

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("YNAB MCP server running on stdio");
}

main().catch(console.error);
