/**
 * Fake YNAB API for tests.
 *
 * Replaces globalThis.fetch with an in-memory implementation of the YNAB
 * endpoints this server uses. Nothing ever leaves the process: any URL that is
 * not https://api.ynab.com/v1/... throws, and every YNAB route is served from
 * the in-memory data below. Every request is recorded (method, path, query,
 * bearer token, JSON body) so tests can assert which profile token and which
 * budget (plan) id each tool call used.
 *
 * Each token can see only its own plans, like real YNAB: a request that uses
 * the wrong token for a plan gets a 404, so profile mix-ups fail loudly.
 */

export const BASE = "https://api.ynab.com/v1";

export const TOKENS = {
  personal: "dummy-token-personal",
  kokuros: "dummy-token-kokuros",
} as const;

// Obviously fake ids. Each plan gets its own id space (prefix) so an id from
// one budget is never valid in another.
export const PLANS = {
  cad: "aaaaaaaa-0000-4000-8000-00000000c0ad",
  ghs: "aaaaaaaa-0000-4000-8000-000000006e50",
  usd: "aaaaaaaa-0000-4000-8000-0000000005d0",
  kokuros: "bbbbbbbb-0000-4000-8000-0000000c0c00",
} as const;

const KIND_CODES: Record<string, string> = {
  acc: "acc0", tpay: "a0a0", cat: "ca70", pay: "da70", grp: "6700", txn: "7700",
  sub: "5ab0", splt: "5b17", sch: "5c40",
};

export function idFor(planId: string, kind: string, n: number): string {
  // planId suffix + kind code keep ids unique per plan and per entity kind;
  // still a 36-char uuid-shaped string (the fork treats those as raw ids).
  const code = KIND_CODES[kind];
  if (!code) throw new Error(`fake: unknown id kind ${kind}`);
  return `${planId.slice(-4)}${code}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  token: string | null;
  body: any;
}

interface PlanData {
  id: string;
  name: string;
  currency: string;
  accounts: any[];
  categoryGroups: any[];
  payees: any[];
  transactions: any[];
  scheduled: any[];
  months: any[];
}

function currencyFormat(iso: string) {
  return {
    iso_code: iso,
    example_format: "123,456.78",
    decimal_digits: 2,
    decimal_separator: ".",
    symbol_first: true,
    group_separator: ",",
    currency_symbol: iso === "GHS" ? "GH₵" : "$",
    display_symbol: true,
  };
}

function makeAccount(planId: string, n: number, name: string, type: string, balance: number, extra: Record<string, unknown> = {}) {
  return {
    id: idFor(planId, "acc", n),
    name,
    type,
    on_budget: true,
    closed: false,
    note: null,
    balance,
    cleared_balance: balance,
    uncleared_balance: 0,
    transfer_payee_id: idFor(planId, "tpay", n),
    direct_import_linked: false,
    direct_import_in_error: false,
    last_reconciled_at: null,
    debt_original_balance: null,
    debt_interest_rates: {},
    debt_minimum_payments: {},
    debt_escrow_amounts: {},
    deleted: false,
    ...extra,
  };
}

function makeCategory(planId: string, groupId: string, groupName: string, n: number, name: string, budgeted: number, activity: number, extra: Record<string, unknown> = {}) {
  return {
    id: idFor(planId, "cat", n),
    category_group_id: groupId,
    category_group_name: groupName,
    name,
    hidden: false,
    original_category_group_id: null,
    note: null,
    budgeted,
    activity,
    balance: budgeted + activity,
    goal_type: null,
    goal_needs_whole_amount: null,
    goal_day: null,
    goal_cadence: null,
    goal_cadence_frequency: null,
    goal_creation_month: null,
    goal_target: null,
    goal_target_month: null,
    goal_target_date: null,
    goal_percentage_complete: null,
    goal_months_to_budget: null,
    goal_under_funded: null,
    goal_overall_funded: null,
    goal_overall_left: null,
    goal_snoozed_at: null,
    deleted: false,
    ...extra,
  };
}

function makeTransaction(planId: string, n: number, fields: Record<string, any>) {
  return {
    id: idFor(planId, "txn", n),
    date: "2026-09-01",
    amount: 0,
    memo: null,
    cleared: "cleared",
    approved: true,
    flag_color: null,
    flag_name: null,
    account_id: idFor(planId, "acc", 1),
    account_name: "Chequing",
    payee_id: null,
    payee_name: null,
    category_id: null,
    category_name: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    matched_transaction_id: null,
    import_id: null,
    import_payee_name: null,
    import_payee_name_original: null,
    debt_transaction_type: null,
    deleted: false,
    subtransactions: [],
    ...fields,
  };
}

/** Build a realistic, deterministic budget. Amounts in milliunits. */
export function makePlan(id: string, name: string, currency: string): PlanData {
  const acc = (n: number) => idFor(id, "acc", n);
  const cat = (n: number) => idFor(id, "cat", n);
  const pay = (n: number) => idFor(id, "pay", n);
  const grp = (n: number) => idFor(id, "grp", n);

  const accounts = [
    makeAccount(id, 1, "Chequing", "checking", 1_500_000),
    makeAccount(id, 2, "Visa Infinite", "creditCard", -250_500, { cleared_balance: -200_500, uncleared_balance: -50_000 }),
    makeAccount(id, 3, "Old Savings", "savings", 0, { closed: true }),
    makeAccount(id, 4, "House Asset", "otherAsset", 300_000_000, { on_budget: false }),
  ];

  const billsGroup = { id: grp(1), name: "Bills", hidden: false, deleted: false };
  const everydayGroup = { id: grp(2), name: "Everyday", hidden: false, deleted: false };
  const hiddenGroup = { id: grp(3), name: "Hidden Categories", hidden: true, deleted: false };
  const categoryGroups = [
    {
      ...billsGroup,
      categories: [
        makeCategory(id, billsGroup.id, "Bills", 1, "Rent", 1_200_000, -1_200_000, { goal_type: "MF", goal_target: 1_200_000 }),
        makeCategory(id, billsGroup.id, "Bills", 2, "Phone", 80_000, -75_000),
      ],
    },
    {
      ...everydayGroup,
      categories: [
        makeCategory(id, everydayGroup.id, "Everyday", 3, "Groceries", 600_000, -412_340),
        makeCategory(id, everydayGroup.id, "Everyday", 4, "Household", 100_000, -35_000),
        makeCategory(id, everydayGroup.id, "Everyday", 5, "Old Hobby", 0, 0, { hidden: true }),
      ],
    },
    {
      ...hiddenGroup,
      categories: [makeCategory(id, hiddenGroup.id, "Hidden Categories", 6, "Retired", 0, 0, { hidden: true })],
    },
  ];

  const payees = [
    { id: pay(1), name: "Loblaws", transfer_account_id: null, deleted: false },
    { id: pay(2), name: "Landlord Inc", transfer_account_id: null, deleted: false },
    { id: pay(3), name: "Transfer : Visa Infinite", transfer_account_id: acc(2), deleted: false },
    { id: pay(4), name: "Costco Wholesale", transfer_account_id: null, deleted: false },
    { id: pay(5), name: "Gone Payee", transfer_account_id: null, deleted: true },
  ];

  const transactions = [
    makeTransaction(id, 1, {
      date: "2026-09-01", amount: -1_200_000, payee_id: pay(2), payee_name: "Landlord Inc",
      category_id: cat(1), category_name: "Rent", memo: "September rent", cleared: "reconciled",
    }),
    makeTransaction(id, 2, {
      date: "2026-09-05", amount: -82_450, payee_id: pay(1), payee_name: "Loblaws",
      category_id: cat(3), category_name: "Groceries", memo: null, cleared: "cleared",
      account_id: acc(2), account_name: "Visa Infinite", flag_color: "red", flag_name: "Check",
    }),
    makeTransaction(id, 3, {
      date: "2026-09-10", amount: -45_000, payee_id: pay(4), payee_name: "Costco Wholesale",
      category_id: null, category_name: null, memo: "bulk run", cleared: "uncleared", approved: false,
    }),
    // A split: the parent row is categorised "Split"; the real categories live on the legs.
    makeTransaction(id, 4, {
      date: "2026-09-12", amount: -826_080, payee_id: pay(4), payee_name: "Costco Wholesale",
      category_id: idFor(id, "splt", 1), category_name: "Split", memo: "Costco haul", cleared: "cleared",
      approved: false,
      subtransactions: [
        {
          id: idFor(id, "sub", 1), transaction_id: idFor(id, "txn", 4), amount: -350_000, memo: "printer",
          payee_id: null, payee_name: null, category_id: cat(4), category_name: "Household",
          transfer_account_id: null, transfer_transaction_id: null, deleted: false,
        },
        {
          id: idFor(id, "sub", 2), transaction_id: idFor(id, "txn", 4), amount: -476_080, memo: null,
          payee_id: null, payee_name: null, category_id: cat(3), category_name: "Groceries",
          transfer_account_id: null, transfer_transaction_id: null, deleted: false,
        },
        {
          id: idFor(id, "sub", 3), transaction_id: idFor(id, "txn", 4), amount: -1_000, memo: "removed leg",
          payee_id: null, payee_name: null, category_id: cat(2), category_name: "Phone",
          transfer_account_id: null, transfer_transaction_id: null, deleted: true,
        },
      ],
    }),
    makeTransaction(id, 5, {
      date: "2026-08-20", amount: 3_000_000, payee_id: null, payee_name: "Employer Payroll",
      category_id: cat(99), category_name: "Inflow: Ready to Assign", memo: "Pay", cleared: "cleared",
    }),
    makeTransaction(id, 6, {
      date: "2026-08-15", amount: -10_000, payee_name: "Deleted thing", deleted: true,
    }),
  ];

  const scheduled = [
    {
      id: idFor(id, "sch", 1), date_first: "2026-01-01", date_next: "2026-10-01", frequency: "monthly",
      amount: -1_200_000, memo: "rent", flag_color: null, flag_name: null, account_id: acc(1),
      payee_id: pay(2), category_id: cat(1), transfer_account_id: null, deleted: false,
      account_name: "Chequing", payee_name: "Landlord Inc", category_name: "Rent", subtransactions: [],
    },
    {
      id: idFor(id, "sch", 2), date_first: "2025-01-01", date_next: "2025-02-01", frequency: "monthly",
      amount: -5_000, memo: null, flag_color: null, flag_name: null, account_id: acc(1),
      payee_id: null, category_id: null, transfer_account_id: null, deleted: true,
      account_name: "Chequing", payee_name: null, category_name: null, subtransactions: [],
    },
  ];

  const months = [
    { month: "2026-09-01", note: null, income: 3_000_000, budgeted: 1_980_000, activity: -1_722_340, to_be_budgeted: 125_000, age_of_money: 42, deleted: false },
    { month: "2026-08-01", note: "busy", income: 2_900_000, budgeted: 2_100_000, activity: -2_050_000, to_be_budgeted: 0, age_of_money: 40, deleted: false },
  ];

  return { id, name, currency, accounts, categoryGroups, payees, transactions, scheduled, months };
}

function ynabError(status: number, id: string, name: string, detail: string) {
  return { status, body: { error: { id, name, detail } } };
}

const NOT_FOUND = ynabError(404, "404.2", "resource_not_found", "Resource not found");

type Handler = (ctx: { plan: PlanData; m: RegExpMatchArray; query: Record<string, string>; body: any }) => { status?: number; body: any };

export class FakeYnab {
  requests: RecordedRequest[] = [];
  plans: Map<string, PlanData> = new Map();
  /** token -> plan ids it can see */
  access: Map<string, string[]> = new Map();
  private failures: Array<{ method: string; path: RegExp; status: number; body: any }> = [];
  private seq = 1000;
  private originalFetch: typeof fetch | undefined;

  constructor() {
    this.reset();
  }

  reset() {
    this.requests = [];
    this.failures = [];
    this.seq = 1000;
    this.plans = new Map([
      [PLANS.cad, makePlan(PLANS.cad, "Personal CAD", "CAD")],
      [PLANS.ghs, makePlan(PLANS.ghs, "Personal GHS", "GHS")],
      [PLANS.usd, makePlan(PLANS.usd, "Personal USD", "USD")],
      [PLANS.kokuros, makePlan(PLANS.kokuros, "Kokuros Micromarkets", "CAD")],
    ]);
    this.access = new Map([
      [TOKENS.personal, [PLANS.cad, PLANS.ghs, PLANS.usd]],
      [TOKENS.kokuros, [PLANS.kokuros]],
    ]);
  }

  install() {
    this.originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => this.handle(input, init)) as typeof fetch;
  }

  uninstall() {
    if (this.originalFetch) globalThis.fetch = this.originalFetch;
  }

  /** Make the next request matching method+path fail with a YNAB-style error body. */
  failNext(method: string, path: RegExp, status = 400, detail = "Simulated YNAB failure") {
    this.failures.push({ method, path, status, body: { error: { id: String(status), name: "bad_request", detail } } });
  }

  /** Requests that change data. */
  writes() {
    return this.requests.filter((r) => r.method !== "GET");
  }

  plan(id: string): PlanData {
    const p = this.plans.get(id);
    if (!p) throw new Error(`fake: unknown plan ${id}`);
    return p;
  }

  private nextId(planId: string, kind: string) {
    return idFor(planId, kind, ++this.seq);
  }

  private async handle(input: any, init?: any): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (url.origin + "/v1" !== BASE || !url.pathname.startsWith("/v1/")) {
      throw new Error(`fake-ynab: refusing non-YNAB URL ${url.href}`);
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.slice("/v1".length);
    const query = Object.fromEntries(url.searchParams.entries());
    const headers = new Headers(init?.headers ?? {});
    const auth = headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    let body: any = undefined;
    if (init?.body) {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    this.requests.push({ method, path, query, token, body });

    const json = (status: number, payload: any) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (!token || !this.access.has(token)) {
      return json(401, { error: { id: "401", name: "unauthorized", detail: "Unauthorized" } });
    }

    const failIdx = this.failures.findIndex((f) => f.method === method && f.path.test(path));
    if (failIdx >= 0) {
      const [f] = this.failures.splice(failIdx, 1);
      return json(f.status, f.body);
    }

    const result = this.route(method, path, query, body, token);
    return json(result.status ?? 200, result.body);
  }

  private route(method: string, path: string, query: Record<string, string>, body: any, token: string): { status?: number; body: any } {
    if (method === "GET" && path === "/plans") {
      const ids = this.access.get(token)!;
      return {
        body: {
          data: {
            plans: ids.map((id) => {
              const p = this.plan(id);
              return {
                id: p.id, name: p.name, last_modified_on: "2026-09-29T12:00:00.000Z",
                first_month: "2025-01-01", last_month: "2026-09-01",
                date_format: { format: "YYYY-MM-DD" }, currency_format: currencyFormat(p.currency),
              };
            }),
            default_plan: null,
          },
        },
      };
    }

    const m = path.match(/^\/plans\/([^/]+)(\/.*)?$/);
    if (!m) return NOT_FOUND;
    const planId = decodeURIComponent(m[1]);
    if (!this.access.get(token)!.includes(planId)) return NOT_FOUND;
    const plan = this.plan(planId);
    const rest = m[2] ?? "";

    for (const [verb, re, handler] of this.routes) {
      if (verb !== method) continue;
      const mm = rest.match(re);
      if (mm) return handler({ plan, m: mm, query, body });
    }
    return NOT_FOUND;
  }

  private findAccount(plan: PlanData, id: string) {
    return plan.accounts.find((a) => a.id === id);
  }

  private allCategories(plan: PlanData) {
    return plan.categoryGroups.flatMap((g) => g.categories);
  }

  private materialize(plan: PlanData, t: any) {
    // Fill the denormalised name fields YNAB returns on a saved transaction.
    const account = this.findAccount(plan, t.account_id);
    const payee = plan.payees.find((p) => p.id === t.payee_id);
    const category = this.allCategories(plan).find((c) => c.id === t.category_id);
    const subs = (t.subtransactions ?? []).map((s: any) => ({
      id: this.nextId(plan.id, "sub"), transaction_id: t.id, amount: s.amount, memo: s.memo ?? null,
      payee_id: s.payee_id ?? null, payee_name: s.payee_name ?? null, category_id: s.category_id ?? null,
      category_name: this.allCategories(plan).find((c) => c.id === s.category_id)?.name ?? null,
      transfer_account_id: null, transfer_transaction_id: null, deleted: false,
    }));
    return makeTransaction(plan.id, 0, {
      ...t,
      memo: t.memo ?? null,
      flag_color: t.flag_color ?? null,
      account_name: account?.name ?? "Unknown account",
      payee_id: t.payee_id ?? payee?.id ?? null,
      payee_name: t.payee_name ?? payee?.name ?? null,
      category_id: subs.length > 0 ? idFor(plan.id, "splt", 1) : t.category_id ?? null,
      category_name: subs.length > 0 ? "Split" : category?.name ?? null,
      subtransactions: subs,
    });
  }

  private scheduledOut(plan: PlanData, s: any) {
    const account = this.findAccount(plan, s.account_id);
    const payee = plan.payees.find((p) => p.id === s.payee_id);
    const category = this.allCategories(plan).find((c) => c.id === s.category_id);
    return {
      id: s.id, date_first: s.date_first ?? s.date, date_next: s.date_next ?? s.date,
      frequency: s.frequency ?? "never", amount: s.amount ?? 0, memo: s.memo ?? null,
      flag_color: s.flag_color ?? null, flag_name: null, account_id: s.account_id,
      payee_id: s.payee_id ?? null, category_id: s.category_id ?? null, transfer_account_id: null,
      deleted: s.deleted ?? false, account_name: account?.name ?? "Unknown account",
      payee_name: s.payee_name ?? payee?.name ?? null, category_name: category?.name ?? null, subtransactions: [],
    };
  }

  private routes: Array<[string, RegExp, Handler]> = [
    ["GET", /^$/, ({ plan }) => ({
      body: { data: { plan: { id: plan.id, name: plan.name, last_modified_on: "2026-09-29T12:00:00.000Z", currency_format: currencyFormat(plan.currency), date_format: { format: "YYYY-MM-DD" } }, server_knowledge: 1 } },
    })],

    // Accounts
    ["GET", /^\/accounts$/, ({ plan }) => ({ body: { data: { accounts: plan.accounts, server_knowledge: 1 } } })],
    ["GET", /^\/accounts\/([^/]+)$/, ({ plan, m }) => {
      const a = this.findAccount(plan, m[1]);
      return a ? { body: { data: { account: a } } } : NOT_FOUND;
    }],
    ["POST", /^\/accounts$/, ({ plan, body }) => {
      const a = makeAccount(plan.id, ++this.seq, body.account.name, body.account.type, body.account.balance);
      plan.accounts.push(a);
      return { status: 201, body: { data: { account: a } } };
    }],

    // Transactions
    ["GET", /^\/transactions$/, ({ plan, query }) => ({
      body: { data: { transactions: plan.transactions.filter((t) => !query.since_date || t.date >= query.since_date), server_knowledge: 1 } },
    })],
    ["GET", /^\/accounts\/([^/]+)\/transactions$/, ({ plan, m, query }) => ({
      body: { data: { transactions: plan.transactions.filter((t) => t.account_id === m[1] && (!query.since_date || t.date >= query.since_date)), server_knowledge: 1 } },
    })],
    ["GET", /^\/months\/([^/]+)\/transactions$/, ({ plan, m }) => ({
      body: { data: { transactions: plan.transactions.filter((t) => t.date.slice(0, 7) === m[1].slice(0, 7)), server_knowledge: 1 } },
    })],
    ["GET", /^\/transactions\/([^/]+)$/, ({ plan, m }) => {
      const t = plan.transactions.find((x) => x.id === m[1]);
      return t ? { body: { data: { transaction: t, server_knowledge: 1 } } } : NOT_FOUND;
    }],
    ["POST", /^\/transactions\/import$/, () => ({ status: 201, body: { data: { transaction_ids: ["imported-1", "imported-2"] } } })],
    ["POST", /^\/transactions$/, ({ plan, body }) => {
      const created = this.materialize(plan, { ...body.transaction, id: this.nextId(plan.id, "txn") });
      plan.transactions.push(created);
      return { status: 201, body: { data: { transaction_ids: [created.id], transaction: created, server_knowledge: 2 } } };
    }],
    ["PUT", /^\/transactions\/([^/]+)$/, ({ plan, m, body }) => {
      const idx = plan.transactions.findIndex((x) => x.id === m[1]);
      if (idx < 0) return NOT_FOUND;
      const merged = this.materialize(plan, { ...plan.transactions[idx], ...body.transaction, id: m[1], subtransactions: [] });
      if (plan.transactions[idx].subtransactions?.length && !body.transaction.subtransactions) {
        merged.subtransactions = plan.transactions[idx].subtransactions;
        merged.category_id = plan.transactions[idx].category_id;
        merged.category_name = plan.transactions[idx].category_name;
      }
      plan.transactions[idx] = merged;
      return { body: { data: { transaction: merged, server_knowledge: 2 } } };
    }],
    ["PATCH", /^\/transactions$/, ({ plan, body }) => {
      const updated = body.transactions.map((u: any) => {
        const idx = plan.transactions.findIndex((x) => x.id === u.id);
        if (idx < 0) return null;
        plan.transactions[idx] = { ...plan.transactions[idx], ...u };
        return plan.transactions[idx];
      }).filter(Boolean);
      return { body: { data: { transaction_ids: updated.map((t: any) => t.id), transactions: updated, server_knowledge: 2 } } };
    }],
    ["DELETE", /^\/transactions\/([^/]+)$/, ({ plan, m }) => {
      const t = plan.transactions.find((x) => x.id === m[1]);
      if (!t) return NOT_FOUND;
      t.deleted = true;
      return { body: { data: { transaction: t, server_knowledge: 2 } } };
    }],
    ["GET", /^\/payees\/([^/]+)\/transactions$/, ({ plan, m }) => ({
      body: {
        data: {
          transactions: plan.transactions.filter((t) => t.payee_id === m[1]).map((t) => {
            const { subtransactions, ...rest } = t;
            return { ...rest, type: "transaction", parent_transaction_id: null };
          }),
          server_knowledge: 1,
        },
      },
    })],

    // Scheduled transactions
    ["GET", /^\/scheduled_transactions$/, ({ plan }) => ({ body: { data: { scheduled_transactions: plan.scheduled, server_knowledge: 1 } } })],
    ["GET", /^\/scheduled_transactions\/([^/]+)$/, ({ plan, m }) => {
      const s = plan.scheduled.find((x) => x.id === m[1]);
      return s ? { body: { data: { scheduled_transaction: s } } } : NOT_FOUND;
    }],
    ["POST", /^\/scheduled_transactions$/, ({ plan, body }) => {
      const s = this.scheduledOut(plan, { ...body.scheduled_transaction, id: this.nextId(plan.id, "sch") });
      plan.scheduled.push(s);
      return { status: 201, body: { data: { scheduled_transaction: s } } };
    }],
    ["PUT", /^\/scheduled_transactions\/([^/]+)$/, ({ plan, m, body }) => {
      const idx = plan.scheduled.findIndex((x) => x.id === m[1]);
      if (idx < 0) return NOT_FOUND;
      const s = this.scheduledOut(plan, { ...plan.scheduled[idx], ...body.scheduled_transaction, date_next: body.scheduled_transaction.date, id: m[1] });
      plan.scheduled[idx] = s;
      return { body: { data: { scheduled_transaction: s } } };
    }],
    ["DELETE", /^\/scheduled_transactions\/([^/]+)$/, ({ plan, m }) => {
      const s = plan.scheduled.find((x) => x.id === m[1]);
      if (!s) return NOT_FOUND;
      return { body: { data: { scheduled_transaction: { ...s, deleted: true } } } };
    }],

    // Categories
    ["GET", /^\/categories$/, ({ plan }) => ({ body: { data: { category_groups: plan.categoryGroups, server_knowledge: 1 } } })],
    ["POST", /^\/categories$/, ({ plan, body }) => {
      const group = plan.categoryGroups.find((g) => g.id === body.category.category_group_id);
      if (!group) return NOT_FOUND;
      const c = makeCategory(plan.id, group.id, group.name, ++this.seq, body.category.name, 0, 0, {
        goal_target: body.category.goal_target ?? null, goal_target_date: body.category.goal_target_date ?? null,
      });
      group.categories.push(c);
      return { status: 201, body: { data: { category: c, server_knowledge: 2 } } };
    }],
    ["POST", /^\/category_groups$/, ({ plan, body }) => {
      const g = { id: this.nextId(plan.id, "grp"), name: body.category_group.name, hidden: false, deleted: false, categories: [] };
      plan.categoryGroups.push(g);
      const { categories, ...rest } = g;
      return { status: 201, body: { data: { category_group: rest, server_knowledge: 2 } } };
    }],
    ["GET", /^\/months\/([^/]+)\/categories\/([^/]+)$/, ({ plan, m }) => {
      const c = this.allCategories(plan).find((x) => x.id === m[2]);
      return c ? { body: { data: { category: c } } } : NOT_FOUND;
    }],
    ["PATCH", /^\/months\/([^/]+)\/categories\/([^/]+)$/, ({ plan, m, body }) => {
      const c = this.allCategories(plan).find((x) => x.id === m[2]);
      if (!c) return NOT_FOUND;
      c.balance = c.balance - c.budgeted + body.category.budgeted;
      c.budgeted = body.category.budgeted;
      return { body: { data: { category: c, server_knowledge: 2 } } };
    }],

    // Months
    ["GET", /^\/months$/, ({ plan }) => ({ body: { data: { months: plan.months, server_knowledge: 1 } } })],
    ["GET", /^\/months\/([^/]+)$/, ({ plan, m }) => {
      const mo = plan.months.find((x) => x.month === m[1]) ?? { ...plan.months[0], month: m[1] };
      return { body: { data: { month: { ...mo, categories: this.allCategories(plan) }, server_knowledge: 1 } } };
    }],

    // Payees
    ["GET", /^\/payees$/, ({ plan }) => ({ body: { data: { payees: plan.payees, server_knowledge: 1 } } })],
    ["GET", /^\/payees\/([^/]+)$/, ({ plan, m }) => {
      const p = plan.payees.find((x) => x.id === m[1]);
      return p ? { body: { data: { payee: p } } } : NOT_FOUND;
    }],
    ["PATCH", /^\/payees\/([^/]+)$/, ({ plan, m, body }) => {
      const p = plan.payees.find((x) => x.id === m[1]);
      if (!p) return NOT_FOUND;
      p.name = body.payee.name;
      return { body: { data: { payee: p, server_knowledge: 2 } } };
    }],
  ];
}
