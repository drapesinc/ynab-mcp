/**
 * Spending-report helpers: flatten transactions into "entries", one per
 * category leg. Split transactions count by leg (never by their "Split"
 * parent), deleted rows and transfers between accounts are left out.
 */

export interface SpendingEntry {
  date: string;
  /** milliunits, negative = outflow */
  amount: number;
  category: string;
  payee: string;
}

interface TxnLike {
  date: string;
  amount: number;
  deleted?: boolean;
  payee_name?: string | null;
  category_name?: string | null;
  transfer_account_id?: string | null;
  subtransactions?: Array<{
    amount: number;
    deleted?: boolean;
    payee_name?: string | null;
    category_name?: string | null;
    transfer_account_id?: string | null;
  }>;
}

export const UNCATEGORIZED = "Uncategorized";
export const NO_PAYEE = "(no payee)";

/** Money coming into Ready to Assign is income, not a spending category. */
export function isInflowCategory(name: string): boolean {
  return /^Inflow:/i.test(name);
}

export function toEntries(transactions: TxnLike[]): SpendingEntry[] {
  const entries: SpendingEntry[] = [];
  for (const t of transactions) {
    if (t.deleted || t.transfer_account_id) continue;
    const legs = (t.subtransactions ?? []).filter((s) => !s.deleted);
    if (legs.length > 0) {
      for (const s of legs) {
        if (s.transfer_account_id) continue;
        entries.push({
          date: t.date,
          amount: s.amount,
          category: s.category_name || UNCATEGORIZED,
          payee: s.payee_name || t.payee_name || NO_PAYEE,
        });
      }
    } else {
      entries.push({
        date: t.date,
        amount: t.amount,
        category: t.category_name || UNCATEGORIZED,
        payee: t.payee_name || NO_PAYEE,
      });
    }
  }
  return entries;
}
