const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let message = `Fehler ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface AccountNode {
  id: number;
  name: string;
  type: AccountType;
  parentId: number | null;
  isActive: boolean;
  ownBalance: number;
  balance: number;
  children: AccountNode[];
}

export interface FlatAccount {
  id: number;
  name: string;
  type: AccountType;
  parentId: number | null;
  isActive: boolean;
  balance: number;
}

export interface AccountExportNode {
  name: string;
  type: AccountType;
  isActive?: boolean;
  children?: AccountExportNode[];
}

export interface Payee {
  id: number;
  name: string;
  expenseTotal: number;
  transactionCount: number;
}

export interface Posting {
  id?: number;
  accountId: number;
  accountName?: string;
  amountCents: number;
}

export interface Transaction {
  id: number;
  date: string;
  description: string | null;
  payeeId: number | null;
  payeeName: string | null;
  postings: Posting[];
}

export interface RecurringTemplate {
  id: number;
  name: string;
  payeeId: number | null;
  payeeName: string | null;
  fromAccountId: number;
  fromAccountName: string;
  toAccountId: number;
  toAccountName: string;
  amountCents: number;
  interval: "weekly" | "monthly" | "yearly";
  intervalDay: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  lastBookedDate: string | null;
  nextDueDate: string | null;
}

export interface ForecastResponse {
  months: number;
  accounts: {
    accountId: number;
    accountName: string;
    currentBalance: number;
    projection: { date: string; balance: number }[];
  }[];
  upcomingOccurrences: {
    date: string;
    templateId: number;
    templateName: string;
    amountCents: number;
    fromAccountName: string;
    toAccountName: string;
  }[];
}

export interface CategoryReportRow {
  accountId: number;
  accountName: string;
  accountType: "expense" | "income";
  parentId: number | null;
  depth: number;
  totalCents: number;
}

export interface PayeeReportRow {
  payeeId: number;
  payeeName: string;
  expenseTotalCents: number;
  incomeTotalCents: number;
}

export interface ImportFieldMapping {
  index: number;
  header: string | null;
}

export interface ImportTemplateMapping {
  date: ImportFieldMapping;
  amount: ImportFieldMapping;
  description?: ImportFieldMapping;
  payee?: ImportFieldMapping;
}

export interface ImportTemplate {
  id: number;
  name: string;
  delimiter: string;
  hasHeader: boolean;
  skipRows: number;
  mapping: ImportTemplateMapping;
  defaultAccountId: number | null;
}

export const api = {
  getInfo: () => request<{ version: string }>("/info"),

  getAccountsTree: () => request<AccountNode[]>("/accounts"),
  getAccountsFlat: () => request<FlatAccount[]>("/accounts/flat"),
  createAccount: (data: { name: string; type: AccountType; parentId?: number | null }) =>
    request<{ id: number }>("/accounts", { method: "POST", body: JSON.stringify(data) }),
  updateAccount: (id: number, data: Partial<{ name: string; parentId: number | null; isActive: boolean }>) =>
    request<{ ok: true }>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAccount: (id: number) => request<{ ok: true }>(`/accounts/${id}`, { method: "DELETE" }),
  exportAccounts: () => request<AccountExportNode[]>("/accounts/export"),
  importAccounts: (nodes: AccountExportNode[]) =>
    request<{ created: number; updated: number }>("/accounts/import", { method: "POST", body: JSON.stringify(nodes) }),

  getPayees: () => request<Payee[]>("/payees"),
  createPayee: (name: string) => request<{ id: number; name: string }>("/payees", { method: "POST", body: JSON.stringify({ name }) }),
  deletePayee: (id: number) => request<{ ok: true }>(`/payees/${id}`, { method: "DELETE" }),

  getTransactions: (
    filters: { account?: number; payee?: number; from?: string; to?: string; description?: string } = {}
  ) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    return request<Transaction[]>(`/transactions${qs ? `?${qs}` : ""}`);
  },
  createTransaction: (data: {
    date: string;
    description?: string;
    payeeId?: number | null;
    payeeName?: string | null;
    postings: { accountId: number; amountCents: number }[];
  }) => request<{ id: number }>("/transactions", { method: "POST", body: JSON.stringify(data) }),
  updateTransaction: (id: number, data: Partial<{
    date: string;
    description: string;
    payeeId: number | null;
    payeeName: string | null;
    postings: { accountId: number; amountCents: number }[];
  }>) => request<{ ok: true }>(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTransaction: (id: number) => request<{ ok: true }>(`/transactions/${id}`, { method: "DELETE" }),

  getRecurring: () => request<RecurringTemplate[]>("/recurring"),
  createRecurring: (data: {
    name: string;
    payeeId?: number | null;
    fromAccountId: number;
    toAccountId: number;
    amountCents: number;
    interval: "weekly" | "monthly" | "yearly";
    intervalDay: number;
    startDate: string;
    endDate?: string | null;
  }) => request<{ id: number }>("/recurring", { method: "POST", body: JSON.stringify(data) }),
  updateRecurring: (id: number, data: Record<string, unknown>) =>
    request<{ ok: true }>(`/recurring/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRecurring: (id: number) => request<{ ok: true }>(`/recurring/${id}`, { method: "DELETE" }),
  bookRecurring: (id: number, date?: string) =>
    request<{ transactionId: number }>(`/recurring/${id}/book`, { method: "POST", body: JSON.stringify({ date }) }),

  getForecast: (months = 6) => request<ForecastResponse>(`/forecast?months=${months}`),

  getReportByCategory: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request<CategoryReportRow[]>(`/reports/by-category?${params.toString()}`);
  },
  getReportByPayee: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request<PayeeReportRow[]>(`/reports/by-payee?${params.toString()}`);
  },

  importParse: (csvText: string, skipRows = 0) => request<{ delimiter: string; headers: string[]; sampleRows: string[][]; rowCount: number }>(
    "/import/parse",
    { method: "POST", body: JSON.stringify({ csvText, skipRows }) }
  ),
  importPreview: (data: {
    csvText: string;
    delimiter: string;
    hasHeader: boolean;
    mapping: { date: number; amount: number; description?: number; payee?: number };
    defaultAccountId: number;
    skipRows?: number;
  }) =>
    request<{
      rows: {
        rowIndex: number;
        date: string | null;
        rawDate: string;
        amountCents: number | null;
        description: string;
        payeeName: string | null;
        suggestedCategoryAccountId: number | null;
        suggestedCategoryAccountName: string | null;
        suggestionSource: "payee" | "similarBooking" | null;
        similarBookingOf: { transactionId: number; date: string; description: string | null } | null;
        possibleDuplicate: boolean;
        duplicateOf: { transactionId: number; date: string; description: string | null } | null;
        valid: boolean;
      }[];
    }>("/import/preview", { method: "POST", body: JSON.stringify(data) }),
  importCommit: (data: {
    defaultAccountId: number;
    rows: { date: string; amountCents: number; description: string; payeeName: string | null; categoryAccountId: number }[];
  }) => request<{ created: number }>("/import/commit", { method: "POST", body: JSON.stringify(data) }),

  getImportTemplates: () => request<ImportTemplate[]>("/import-templates"),
  createImportTemplate: (data: {
    name: string;
    delimiter: string;
    hasHeader: boolean;
    skipRows: number;
    mapping: ImportTemplateMapping;
    defaultAccountId?: number | null;
  }) => request<{ id: number }>("/import-templates", { method: "POST", body: JSON.stringify(data) }),
  deleteImportTemplate: (id: number) => request<{ ok: true }>(`/import-templates/${id}`, { method: "DELETE" }),
};

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function flattenAccounts(nodes: AccountNode[], depth = 0): { node: AccountNode; depth: number }[] {
  const result: { node: AccountNode; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ node, depth });
    result.push(...flattenAccounts(node.children, depth + 1));
  }
  return result;
}
