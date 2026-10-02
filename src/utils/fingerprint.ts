import { createHash } from "node:crypto";

interface FingerprintTxn {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  payee_id?: string | null;
  payee_name?: string | null;
  memo?: string | null;
  category_id?: string | null;
  deleted?: boolean;
  subtransactions?: Array<{ id: string; amount: number; category_id?: string | null; deleted?: boolean }>;
}

/**
 * Short hash of the parts of a transaction a category suggestion depends on.
 * `apply_category_suggestions` recomputes it from live data and skips any
 * transaction that changed (edited, categorised, split, deleted) since the
 * suggestion was made.
 */
export function contentFingerprint(t: FingerprintTxn): string {
  const legs = (t.subtransactions ?? []).filter((s) => !s.deleted).map((s) => [s.id, s.amount, s.category_id ?? null]);
  const payload = JSON.stringify([
    t.id, t.account_id, t.date, t.amount, t.payee_id ?? null, t.payee_name ?? null,
    t.memo ?? null, t.category_id ?? null, !!t.deleted, legs,
  ]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
