/**
 * Formatter - handles milliunits conversion and output formatting
 *
 * YNAB uses milliunits: 1000 milliunits = $1.00
 */

/**
 * Convert dollars to milliunits
 */
export function dollarsToMilliunits(dollars: number): number {
  return Math.round(dollars * 1000);
}

/**
 * Convert milliunits to dollars
 */
export function milliunitsToDollars(milliunits: number): number {
  return milliunits / 1000;
}

/**
 * Format milliunits as currency string
 */
export function formatAmount(milliunits: number, currencyCode = 'USD'): string {
  const dollars = milliunitsToDollars(milliunits);

  // Use appropriate locale based on currency
  let locale = 'en-US';
  if (currencyCode === 'CAD') locale = 'en-CA';
  if (currencyCode === 'GHS') locale = 'en-GH';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(dollars);
  } catch {
    // Fallback for unsupported currencies
    return `${currencyCode} ${dollars.toFixed(2)}`;
  }
}

/**
 * Format a date for YNAB API (YYYY-MM-DD)
 */
export function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    // Already formatted or ISO string
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    date = new Date(date);
  }

  return date.toISOString().split('T')[0];
}

/**
 * Get current month in YNAB format (YYYY-MM-01)
 */
export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Format transaction status for display
 */
export function formatStatus(cleared: string | undefined, approved: boolean): string {
  const parts: string[] = [];

  if (cleared === 'reconciled') {
    parts.push('Reconciled');
  } else if (cleared === 'cleared') {
    parts.push('Cleared');
  } else {
    parts.push('Uncleared');
  }

  if (!approved) {
    parts.push('Unapproved');
  }

  return parts.join(', ');
}

/**
 * Format account type for display
 */
export function formatAccountType(type: string): string {
  const typeMap: Record<string, string> = {
    checking: 'Checking',
    savings: 'Savings',
    cash: 'Cash',
    creditCard: 'Credit Card',
    lineOfCredit: 'Line of Credit',
    otherAsset: 'Other Asset',
    otherLiability: 'Other Liability',
    mortgage: 'Mortgage',
    autoLoan: 'Auto Loan',
    studentLoan: 'Student Loan',
    personalLoan: 'Personal Loan',
    medicalDebt: 'Medical Debt',
    otherDebt: 'Other Debt',
  };

  return typeMap[type] || type;
}

/**
 * Format category goal type for display
 */
export function formatGoalType(goalType: string | null | undefined): string {
  if (!goalType) return 'No Goal';

  const goalMap: Record<string, string> = {
    TB: 'Target Balance',
    TBD: 'Target by Date',
    MF: 'Monthly Funding',
    NEED: 'Needed for Spending',
    DEBT: 'Debt Payment',
  };

  return goalMap[goalType] || goalType;
}

/**
 * Create MCP response format
 */
export function createResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
  };
}

/**
 * Create MCP error response
 */
export function createErrorResponse(message: string): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }]
  };
}

/**
 * Format budget summary for display
 */
export interface BudgetSummary {
  name: string;
  toBeBudgeted: string;
  activity: string;
  budgeted: string;
  accounts: Array<{
    name: string;
    balance: string;
    type: string;
  }>;
}

export function formatBudgetSummary(
  budget: { name: string },
  month: {
    to_be_budgeted: number;
    activity: number;
    budgeted: number;
  },
  accounts: Array<{
    name: string;
    balance: number;
    type: string;
    on_budget: boolean;
    closed: boolean;
  }>,
  currencyCode = 'USD'
): BudgetSummary {
  return {
    name: budget.name,
    toBeBudgeted: formatAmount(month.to_be_budgeted, currencyCode),
    activity: formatAmount(month.activity, currencyCode),
    budgeted: formatAmount(month.budgeted, currencyCode),
    accounts: accounts
      .filter(a => !a.closed)
      .map(a => ({
        name: a.name,
        balance: formatAmount(a.balance, currencyCode),
        type: formatAccountType(a.type),
      })),
  };
}

/**
 * Format transaction for display
 */
export interface FormattedTransaction {
  id: string;
  date: string;
  amount: string;
  payee: string;
  category: string;
  memo: string;
  status: string;
  account: string;
}

export function formatTransaction(
  tx: {
    id: string;
    date: string;
    amount: number;
    payee_name: string | null;
    category_name: string | null;
    memo: string | null;
    cleared: string;
    approved: boolean;
    account_name: string;
  },
  currencyCode = 'USD'
): FormattedTransaction {
  return {
    id: tx.id,
    date: tx.date,
    amount: formatAmount(tx.amount, currencyCode),
    payee: tx.payee_name || 'Unknown',
    category: tx.category_name || 'Uncategorized',
    memo: tx.memo || '',
    status: formatStatus(tx.cleared, tx.approved),
    account: tx.account_name,
  };
}
