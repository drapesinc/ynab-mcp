# ynab-mcp

A comprehensive YNAB (You Need A Budget) MCP server with **multi-token, multi-budget, multi-account** support.

Based on [calebl/ynab-mcp-server](https://github.com/calebl/ynab-mcp-server), enhanced with:
- **Multi-profile support**: Manage multiple YNAB accounts (different API tokens)
- **Budget aliases**: Use friendly names like "cad" instead of UUIDs
- **Default accounts**: Pre-configured accounts for quick transaction entry
- **Multi-currency**: Proper formatting for CAD, USD, GHS, etc.
- **8 consolidated tools**: Efficient context usage for LLMs

## Quick Start

### Environment Variables

```bash
# Single profile setup (simple)
YNAB_API_TOKEN=your-api-token
YNAB_BUDGET_ID=your-default-budget-id

# Multi-profile setup (advanced)
YNAB_PROFILES=personal,ammish
YNAB_TOKEN_PERSONAL=your-personal-token
YNAB_TOKEN_AMMISH=shared-budget-token
YNAB_DEFAULT_PROFILE=personal

# Budget aliases per profile (alias:id pairs, comma-separated)
YNAB_BUDGETS_PERSONAL=cad:ed5ffea6-1509-...,usd:6a8c1cd7-485d-...,ghs:ddc0a94e-...
YNAB_BUDGETS_AMMISH=main:abc123...
YNAB_DEFAULT_BUDGET=cad

# Default accounts per budget (for quick transaction entry)
YNAB_DEFAULT_ACCOUNT_CAD=RBC Chequing
YNAB_DEFAULT_ACCOUNT_USD=RBC US Checking
```

### Claude Desktop / Claude Code Config

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

## Available Tools (8 Consolidated)

All tools accept optional `profile` and `budget` parameters. Defaults are used when not specified.

### Read Tools

#### `ynab_budgets`
Budget operations.
- `action: list` - List all budgets for profile
- `action: get` - Get budget details with month summary
- `action: profiles` - List configured profiles

#### `ynab_accounts`
Account operations.
- `action: list` - List accounts (filter by type, on_budget, closed)
- `action: get` - Get single account details
- `action: balances` - Quick balance summary

#### `ynab_transactions_read`
Transaction queries.
- `action: list` - Filter by date, account, category, payee, status, amount
- `action: search` - Search by payee/memo
- `action: unapproved` - Get pending transactions

#### `ynab_categories_read`
Category queries.
- `action: list` - List all categories grouped
- `action: get` - Get category budget for specific month

### Write Tools

#### `ynab_transactions_write`
Transaction mutations.
- `action: create` - Create transaction (supports splits)
- `action: update` - Update existing transaction
- `action: delete` - Delete transaction
- `action: approve` - Approve/unapprove transaction
- `action: adjust` - Balance adjustment for tracking accounts

#### `ynab_categories_write`
Category mutations.
- `action: update` - Set budgeted amount for month
- `action: move` - Move funds between categories

#### `ynab_accounts_write`
Account mutations.
- `action: create` - Create new account
- `action: reconcile` - Mark account as reconciled

#### `ynab_payees`
Payee operations.
- `action: list` - List all payees
- `action: get` - Get payee details with recent transactions
- `action: update` - Rename payee

## Example Usage

```typescript
// List budgets for default profile
ynab_budgets({ action: "list" })

// Get balance summary for USD budget
ynab_accounts({ action: "balances", budget: "usd" })

// Create transaction using default account
ynab_transactions_write({
  action: "create",
  amount: -45.99,
  payee: "Grocery Store",
  category: "Groceries"
})

// Search transactions
ynab_transactions_read({
  action: "search",
  payee: "coffee",
  since_date: "2025-01-01"
})

// Move money between categories
ynab_categories_write({
  action: "move",
  from_category: "Dining Out",
  to_category: "Groceries",
  amount: 50
})

// Switch to different profile
ynab_budgets({ action: "list", profile: "ammish" })
```

## Human-Friendly Features

- **Amounts in dollars**: Input `-45.99`, output `$45.99` (not milliunits)
- **Name resolution**: Use "RBC Chequing" instead of account UUIDs
- **Budget aliases**: Use "cad" instead of full budget IDs
- **Smart defaults**: Profile, budget, and account default from config

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Development with watch
npm run watch
```

## Project Structure

```
ynab-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── config.ts             # Multi-profile configuration
│   ├── utils/
│   │   ├── profile-manager.ts    # API client per profile
│   │   ├── resolver.ts           # Name-to-ID resolution with caching
│   │   └── formatter.ts          # Currency formatting, response helpers
│   └── tools/
│       ├── ynab-budgets.ts
│       ├── ynab-accounts.ts
│       ├── ynab-accounts-write.ts
│       ├── ynab-transactions-read.ts
│       ├── ynab-transactions-write.ts
│       ├── ynab-categories-read.ts
│       ├── ynab-categories-write.ts
│       └── ynab-payees.ts
└── tests/
```

## Rate Limits

YNAB API allows 200 requests/hour per token. Each profile uses a separate token, so limits are independent. The server caches name-to-ID resolutions to minimize API calls.

## Credits

Based on [calebl/ynab-mcp-server](https://github.com/calebl/ynab-mcp-server).

## License

MIT
