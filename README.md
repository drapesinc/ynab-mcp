# ynab-mcp

A comprehensive YNAB (You Need A Budget) MCP server with **multi-token, multi-budget, multi-account** support. Designed for AI assistants that need to read and manage YNAB budgets through the Model Context Protocol.

Based on [calebl/ynab-mcp-server](https://github.com/calebl/ynab-mcp-server), enhanced with:

- **Multi-profile support** -- manage multiple YNAB accounts with separate API tokens
- **Budget aliases** -- use friendly names like `cad` or `usd` instead of UUIDs
- **Default accounts** -- pre-configured accounts for quick transaction entry
- **Multi-currency formatting** -- proper locale-aware formatting for CAD, USD, GHS, and more
- **Name resolution with caching** -- reference accounts, categories, and payees by name (fuzzy match supported)
- **8 consolidated tools** -- efficient context usage for LLMs, covering all YNAB operations

## Quick Start

### 1. Get a YNAB Personal Access Token

Go to [YNAB Developer Settings](https://app.ynab.com/settings/developer) and create a new Personal Access Token.

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your tokens:

```bash
cp .env.example .env
```

**Simple setup (single account):**

```bash
YNAB_API_TOKEN=your-api-token
YNAB_BUDGET_ID=your-default-budget-id
```

**Advanced setup (multiple accounts/profiles):**

```bash
# Define profiles
YNAB_PROFILES=personal,ammish
YNAB_TOKEN_PERSONAL=your-personal-token
YNAB_TOKEN_AMMISH=shared-budget-token
YNAB_DEFAULT_PROFILE=personal

# Budget aliases per profile (alias:id pairs, comma-separated)
YNAB_BUDGETS_PERSONAL=cad:ed5ffea6-...,usd:6a8c1cd7-...,ghs:ddc0a94e-...
YNAB_BUDGETS_AMMISH=main:abc123...
YNAB_DEFAULT_BUDGET=cad

# Default accounts per budget (for quick transaction entry)
YNAB_DEFAULT_ACCOUNT_CAD=RBC Chequing
YNAB_DEFAULT_ACCOUNT_USD=RBC US Checking
```

### 3. Build and Run

```bash
npm install
npm run build
npm start
```

### 4. Connect to Claude Desktop or Claude Code

**Claude Desktop (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "ynab": {
      "command": "node",
      "args": ["/path/to/ynab-mcp/dist/index.js"],
      "env": {
        "YNAB_API_TOKEN": "your-api-token",
        "YNAB_BUDGET_ID": "your-budget-id"
      }
    }
  }
}
```

**Claude Code (`.mcp.json`):**

```json
{
  "mcpServers": {
    "ynab": {
      "command": "node",
      "args": ["/path/to/ynab-mcp/dist/index.js"],
      "env": {
        "YNAB_PROFILES": "personal",
        "YNAB_TOKEN_PERSONAL": "your-token",
        "YNAB_BUDGETS_PERSONAL": "main:your-budget-uuid",
        "YNAB_DEFAULT_PROFILE": "personal",
        "YNAB_DEFAULT_BUDGET": "main"
      }
    }
  }
}
```

## Available Tools (8 Consolidated)

All tools accept optional `profile` and `budget` parameters. Defaults are used when not specified.

### Read Tools

#### `ynab_budgets`

Budget and profile operations.

| Action | Description |
|--------|-------------|
| `list` | List all budgets for a profile, including configured aliases |
| `get` | Get budget details with month summary (income, activity, to-be-budgeted) and account list |
| `months` | List all budget months with income, budgeted, activity, and age of money |
| `profiles` | List all configured profiles and their budgets |

Parameters: `action`, `profile?`, `budget?`, `month?`

#### `ynab_accounts`

Account read operations.

| Action | Description |
|--------|-------------|
| `list` | List accounts with optional filters (type, on_budget, include_closed) |
| `get` | Get single account details including note and last reconciled date |
| `balances` | Quick balance summary with net worth, total assets, and total liabilities |

Parameters: `action`, `profile?`, `budget?`, `account?`, `type?`, `on_budget?`, `include_closed?`

#### `ynab_transactions_read`

Transaction query operations.

| Action | Description |
|--------|-------------|
| `list` | Filter transactions by date range, account, category, payee, memo, status, amount range |
| `search` | Fuzzy search by payee name or memo content |
| `unapproved` | Get pending/unapproved transactions |
| `scheduled` | List recurring/scheduled transactions with frequency and next date |

Parameters: `action`, `profile?`, `budget?`, `account?`, `category?`, `since_date?`, `until_date?`, `payee?`, `memo?`, `status?`, `type?`, `min_amount?`, `max_amount?`, `limit?`

#### `ynab_categories_read`

Category query operations.

| Action | Description |
|--------|-------------|
| `list` | List all categories grouped by category group, with budget/activity/balance totals |
| `get` | Get category details for a specific month, including goal progress |

Parameters: `action`, `profile?`, `budget?`, `category?`, `month?`, `include_hidden?`

### Write Tools

#### `ynab_transactions_write`

Transaction mutation operations.

| Action | Description |
|--------|-------------|
| `create` | Create a transaction with optional split categories. Uses default account if none specified |
| `update` | Update an existing transaction (amount, payee, category, memo, date, status) |
| `delete` | Delete a transaction by ID |
| `approve` | Approve or unapprove a transaction |
| `bulk_approve` | Approve multiple transactions at once by IDs |
| `adjust` | Create a balance adjustment for tracking accounts (specify target balance) |
| `import` | Trigger import of transactions from linked financial institutions |

Parameters: `action`, `profile?`, `budget?`, `account?`, `transaction_id?`, `amount?`, `payee?`, `category?`, `memo?`, `date?`, `cleared?`, `approved?`, `splits?`, `transaction_ids?`

#### `ynab_categories_write`

Category mutation operations.

| Action | Description |
|--------|-------------|
| `update` | Set the budgeted amount for a category in a specific month |
| `move` | Move funds between categories (validates sufficient funds) |

Parameters: `action`, `profile?`, `budget?`, `category?`, `from_category?`, `to_category?`, `amount?`, `month?`

#### `ynab_accounts_write`

Account mutation operations.

| Action | Description |
|--------|-------------|
| `create` | Create a new account with type and starting balance |
| `reconcile` | Reconcile an account to a confirmed balance (creates adjustment transaction if needed) |

Parameters: `action`, `profile?`, `budget?`, `account?`, `name?`, `type?`, `balance?`, `note?`

#### `ynab_payees`

Payee operations.

| Action | Description |
|--------|-------------|
| `list` | List payees with optional search filter |
| `get` | Get payee details with 5 most recent transactions |
| `update` | Rename a payee |

Parameters: `action`, `profile?`, `budget?`, `payee?`, `new_name?`, `search?`, `limit?`

## Usage Examples

```typescript
// List all configured profiles
ynab_budgets({ action: "profiles" })

// Get budget summary for current month
ynab_budgets({ action: "get", budget: "cad" })

// List budget months with income/activity history
ynab_budgets({ action: "months", budget: "cad" })

// Get balance summary with net worth
ynab_accounts({ action: "balances", budget: "usd" })

// Create transaction using default account
ynab_transactions_write({
  action: "create",
  amount: -45.99,
  payee: "Grocery Store",
  category: "Groceries"
})

// Create split transaction
ynab_transactions_write({
  action: "create",
  amount: -100,
  payee: "Costco",
  splits: [
    { amount: -60, category: "Groceries" },
    { amount: -40, category: "Household Goods" }
  ]
})

// Search transactions by payee
ynab_transactions_read({
  action: "search",
  payee: "coffee",
  since_date: "2025-01-01"
})

// Get scheduled/recurring transactions
ynab_transactions_read({ action: "scheduled" })

// Approve multiple transactions at once
ynab_transactions_write({
  action: "bulk_approve",
  transaction_ids: ["id-1", "id-2", "id-3"]
})

// Import from linked bank accounts
ynab_transactions_write({ action: "import" })

// Move money between categories
ynab_categories_write({
  action: "move",
  from_category: "Dining Out",
  to_category: "Groceries",
  amount: 50
})

// Reconcile an account
ynab_accounts_write({
  action: "reconcile",
  account: "RBC Chequing",
  balance: 1234.56
})

// Switch to a different profile
ynab_budgets({ action: "list", profile: "ammish" })
```

## Human-Friendly Features

- **Amounts in dollars** -- Input `-45.99`, output `$45.99 CAD` (not milliunits)
- **Name resolution** -- Use `"RBC Chequing"` instead of account UUIDs. Supports fuzzy matching.
- **Budget aliases** -- Use `"cad"` instead of full budget IDs
- **Smart defaults** -- Profile, budget, and account all default from configuration
- **Multi-currency** -- Locale-aware formatting for CAD, USD, GHS, and other currencies
- **Cached lookups** -- Account, category, and payee name-to-ID resolution is cached for 5 minutes to reduce API calls

## Architecture

```
src/
├── index.ts                    # MCP server entry point, tool registration
├── config.ts                   # Multi-profile configuration from env vars
├── utils/
│   ├── profile-manager.ts      # YNAB API client per profile, budget resolution
│   ├── resolver.ts             # Name-to-ID resolution with 5-minute TTL cache
│   └── formatter.ts            # Currency formatting, milliunit conversion, response helpers
└── tools/
    ├── ynab-budgets.ts             # Budget and profile operations
    ├── ynab-accounts.ts            # Account read operations
    ├── ynab-accounts-write.ts      # Account mutations (create, reconcile)
    ├── ynab-transactions-read.ts   # Transaction queries and search
    ├── ynab-transactions-write.ts  # Transaction mutations (CRUD, approve, import)
    ├── ynab-categories-read.ts     # Category queries
    ├── ynab-categories-write.ts    # Category mutations (budget, move funds)
    └── ynab-payees.ts              # Payee operations
```

Each tool module exports `name`, `description`, `inputSchema` (Zod), and an `execute` function. Tools are registered in `index.ts` which validates configuration on startup and logs loaded profiles.

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `YNAB_API_TOKEN` | Yes* | Single-profile API token |
| `YNAB_BUDGET_ID` | No | Default budget ID (single-profile mode) |
| `YNAB_PROFILES` | Yes* | Comma-separated profile names (multi-profile mode) |
| `YNAB_TOKEN_{PROFILE}` | Yes* | API token per profile (e.g., `YNAB_TOKEN_PERSONAL`) |
| `YNAB_BUDGETS_{PROFILE}` | No | Budget aliases per profile (`alias:uuid,...`) |
| `YNAB_DEFAULT_PROFILE` | No | Default profile name |
| `YNAB_DEFAULT_BUDGET` | No | Default budget alias |
| `YNAB_DEFAULT_ACCOUNT_{BUDGET}` | No | Default account name per budget alias |

\* Either `YNAB_API_TOKEN` (single-profile) or `YNAB_PROFILES` + `YNAB_TOKEN_*` (multi-profile) is required.

## Development

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript to ./dist
npm start                # Start the MCP server
npm run watch            # Development build with file watching
npm run debug            # Debug with MCP Inspector
npm test                 # Run tests (vitest)
npm run test:watch       # Run tests with file watching
npm run test:coverage    # Run tests with coverage report
```

### Adding a New Tool

1. Create `src/tools/my-tool.ts` following the module pattern:

```typescript
import { z } from "zod";
import { getApiClient, resolveBudgetId } from "../utils/profile-manager.js";
import { createResponse, createErrorResponse } from "../utils/formatter.js";

export const name = "ynab_my_tool";
export const description = "Description of what this tool does";
export const inputSchema = {
  action: z.enum(["action1", "action2"]).describe("Action to perform"),
  profile: z.string().optional().describe("Profile name"),
  budget: z.string().optional().describe("Budget alias or ID"),
};

export async function execute(input: { action: string; profile?: string; budget?: string }) {
  const api = getApiClient(input.profile);
  const budgetId = resolveBudgetId(input.budget, input.profile);
  // ... implementation
  return createResponse({ success: true });
}
```

2. Register in `src/index.ts`:

```typescript
import * as MyTool from "./tools/my-tool.js";

server.registerTool(MyTool.name, {
  title: "My Tool",
  description: MyTool.description,
  inputSchema: MyTool.inputSchema,
}, async (input) => MyTool.execute(input as Parameters<typeof MyTool.execute>[0]));
```

3. Add tests in `src/tests/`

### Docker

```bash
docker build -t ynab-mcp .
docker run -e YNAB_API_TOKEN=your-token ynab-mcp
```

## Rate Limits

YNAB API allows 200 requests per hour per token. Each profile uses a separate token, so rate limits are independent across profiles. The server caches name-to-ID resolutions (accounts, categories, payees) with a 5-minute TTL to minimize API calls.

## Credits

Forked from [calebl/ynab-mcp-server](https://github.com/calebl/ynab-mcp-server). Upstream features (tool name prefixes, API gap implementations, scheduled transactions) are merged and incorporated into the consolidated tool architecture.

## License

MIT
