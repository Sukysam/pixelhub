"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { API_BASE_URL, ApiError, apiRequest, getAuthToken, getAuthUser, getErrorMessage } from "@/lib/api";

type Expense = {
  id: number;
  amount: string;
  expense_date: string;
  category: string | null;
  description: string | null;
  vendor: string | null;
  merchant_reference: string | null;
  project_code: string | null;
  cost_center: string | null;
  source_account: number | null;
  source_account_name: string | null;
  source_account_status: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  updated_at: string;
};

type SourceAccount = {
  id: number;
  name: string;
  account_type: string;
  initial_balance: string;
  currency: number;
  currency_code: string;
  status: string;
  active_expense_count: number;
  updated_at: string;
};

type Currency = {
  id: number;
  code: string;
  name: string;
};

type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

type ExpenseForm = {
  amount: string;
  expense_date: string;
  category: string;
  description: string;
  vendor: string;
  merchant_reference: string;
  project_code: string;
  cost_center: string;
  source_account: string;
};

type SourceAccountForm = {
  name: string;
  account_type: string;
  initial_balance: string;
  currency: string;
  status: string;
};

const EMPTY_EXPENSE_FORM: ExpenseForm = {
  amount: "",
  expense_date: new Date().toISOString().slice(0, 10),
  category: "",
  description: "",
  vendor: "",
  merchant_reference: "",
  project_code: "",
  cost_center: "",
  source_account: "",
};

const EMPTY_SOURCE_ACCOUNT_FORM: SourceAccountForm = {
  name: "",
  account_type: "petty_cash",
  initial_balance: "0.00",
  currency: "",
  status: "active",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  petty_cash: "Petty Cash",
  bank: "Bank",
  mobile_money: "Mobile Money",
  other: "Other",
};

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  closed: "Closed",
};

export default function ExpensesPage() {
  const authUser = getAuthUser();
  const permissions = new Set(authUser?.permissions ?? []);
  const canReadSourceAccounts =
    !!authUser && (authUser.is_superuser || permissions.has("data.source_accounts.read") || permissions.has("data.source_accounts.write"));
  const canWriteSourceAccounts = !!authUser && (authUser.is_superuser || permissions.has("data.source_accounts.write"));

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [sourceAccounts, setSourceAccounts] = useState<SourceAccount[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceAccountsLoading, setSourceAccountsLoading] = useState(false);
  const [currenciesLoading, setCurrenciesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sourceAccountFilter, setSourceAccountFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(EMPTY_EXPENSE_FORM);
  const [isExpenseSaving, setIsExpenseSaving] = useState(false);
  const [sourceAccountDialogOpen, setSourceAccountDialogOpen] = useState(false);
  const [editingSourceAccount, setEditingSourceAccount] = useState<SourceAccount | null>(null);
  const [sourceAccountForm, setSourceAccountForm] = useState<SourceAccountForm>(EMPTY_SOURCE_ACCOUNT_FORM);
  const [sourceAccountSaving, setSourceAccountSaving] = useState(false);
  const [deleteSourceAccountOpen, setDeleteSourceAccountOpen] = useState(false);
  const [deleteSourceAccountTarget, setDeleteSourceAccountTarget] = useState<SourceAccount | null>(null);
  const [deleteSourceAccountConfirmed, setDeleteSourceAccountConfirmed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx" | "pdf">("csv");
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [exportFields, setExportFields] = useState<Record<string, boolean>>({
    expense_date: true,
    amount: true,
    category: true,
    vendor: true,
    project_code: true,
    cost_center: true,
    source_account: true,
    assigned_to: true,
  });
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDryRun, setImportDryRun] = useState(false);
  const [importRollbackOnError, setImportRollbackOnError] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported?: number;
    rows?: number;
    would_create?: number;
    errors?: unknown[];
    error_log_token?: string;
  } | null>(null);

  const exportableFields = useMemo(
    () => [
      "expense_date",
      "amount",
      "category",
      "description",
      "vendor",
      "merchant_reference",
      "project_code",
      "cost_center",
      "source_account",
      "assigned_to",
      "created_by",
      "created_at",
      "updated_at",
    ],
    []
  );

  const activeSourceAccounts = useMemo(
    () => sourceAccounts.filter((account) => account.status === "active"),
    [sourceAccounts]
  );

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 403) return e.message || "You do not have permission to manage this expense feature.";
      if (e.status === 409) return e.message || "This record was changed by another user.";
    }
    return getErrorMessage(e, fallback);
  }, []);

  const buildListPath = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", "1");
    if (query.trim()) params.set("q", query.trim());
    if (categoryFilter.trim()) params.set("category", categoryFilter.trim());
    if (sourceAccountFilter.trim()) params.set("source_account", sourceAccountFilter.trim());
    if (mineOnly) params.set("assigned_to", "me");
    return `/expenses/?${params.toString()}`;
  }, [categoryFilter, mineOnly, query, sourceAccountFilter]);

  const loadExpenses = useCallback(
    async (path?: string) => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiRequest<Paginated<Expense>>(path ?? buildListPath());
        setExpenses(data.results);
        setNextUrl(data.next);
      } catch (e: unknown) {
        setError(toUserMessage(e, "Failed to load expenses"));
      } finally {
        setLoading(false);
      }
    },
    [buildListPath, toUserMessage]
  );

  const loadSourceAccounts = useCallback(async () => {
    if (!canReadSourceAccounts) return;
    try {
      setSourceAccountsLoading(true);
      const data = await apiRequest<SourceAccount[]>("/source-accounts/");
      setSourceAccounts(data);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load source accounts"));
    } finally {
      setSourceAccountsLoading(false);
    }
  }, [canReadSourceAccounts, toUserMessage]);

  const loadCurrencies = useCallback(async () => {
    try {
      setCurrenciesLoading(true);
      const data = await apiRequest<Currency[]>("/currencies/");
      setCurrencies(data);
      if (!sourceAccountForm.currency && data.length) {
        setSourceAccountForm((prev) => ({ ...prev, currency: String(data[0].id) }));
      }
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load currencies"));
    } finally {
      setCurrenciesLoading(false);
    }
  }, [sourceAccountForm.currency, toUserMessage]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  useEffect(() => {
    void loadCurrencies();
  }, [loadCurrencies]);

  useEffect(() => {
    void loadSourceAccounts();
  }, [loadSourceAccounts]);

  const loadMore = async () => {
    if (!nextUrl) return;
    try {
      setLoading(true);
      const data = await apiRequest<Paginated<Expense>>(nextUrl);
      setExpenses((prev) => [...prev, ...data.results]);
      setNextUrl(data.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more expenses"));
    } finally {
      setLoading(false);
    }
  };

  const resetExpenseForm = () => {
    setExpenseForm(EMPTY_EXPENSE_FORM);
    setEditingExpense(null);
  };

  const resetSourceAccountForm = () => {
    setSourceAccountForm((prev) => ({
      ...EMPTY_SOURCE_ACCOUNT_FORM,
      currency: prev.currency || (currencies[0] ? String(currencies[0].id) : ""),
    }));
    setEditingSourceAccount(null);
  };

  const openEditExpense = (expense: Expense) => {
    setError(null);
    setSuccess(null);
    setEditingExpense(expense);
    setExpenseForm({
      amount: expense.amount,
      expense_date: expense.expense_date,
      category: expense.category ?? "",
      description: expense.description ?? "",
      vendor: expense.vendor ?? "",
      merchant_reference: expense.merchant_reference ?? "",
      project_code: expense.project_code ?? "",
      cost_center: expense.cost_center ?? "",
      source_account: expense.source_account ? String(expense.source_account) : "",
    });
    setIsExpenseDialogOpen(true);
  };

  const openCreateSourceAccount = () => {
    if (currenciesLoading || currencies.length === 0) {
      setError(currenciesLoading ? "Currencies are still loading. Try again in a moment." : "Add at least one currency before creating a source account.");
      if (!currenciesLoading) {
        void loadCurrencies();
      }
      return;
    }
    setError(null);
    setSuccess(null);
    setEditingSourceAccount(null);
    setSourceAccountForm({
      ...EMPTY_SOURCE_ACCOUNT_FORM,
      currency: currencies[0] ? String(currencies[0].id) : "",
    });
    setSourceAccountDialogOpen(true);
  };

  const openEditSourceAccount = (account: SourceAccount) => {
    setError(null);
    setSuccess(null);
    setEditingSourceAccount(account);
    setSourceAccountForm({
      name: account.name,
      account_type: account.account_type,
      initial_balance: account.initial_balance,
      currency: String(account.currency),
      status: account.status,
    });
    setSourceAccountDialogOpen(true);
  };

  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!expenseForm.category.trim()) {
      setError("Category is required.");
      return;
    }
    if (!expenseForm.project_code.trim() && !expenseForm.cost_center.trim()) {
      setError("Project code or cost center is required.");
      return;
    }
    try {
      setIsExpenseSaving(true);
      setError(null);
      setSuccess(null);
      const payload = {
        amount: expenseForm.amount,
        expense_date: expenseForm.expense_date,
        category: expenseForm.category.trim(),
        description: expenseForm.description.trim() || null,
        vendor: expenseForm.vendor.trim() || null,
        merchant_reference: expenseForm.merchant_reference.trim() || null,
        project_code: expenseForm.project_code.trim() || null,
        cost_center: expenseForm.cost_center.trim() || null,
        source_account: expenseForm.source_account ? Number(expenseForm.source_account) : null,
        ...(editingExpense ? { updated_at: editingExpense.updated_at } : {}),
      };
      const path = editingExpense ? `/expenses/${editingExpense.id}/` : "/expenses/";
      const method = editingExpense ? "PATCH" : "POST";
      const saved = await apiRequest<Expense>(path, { method, body: JSON.stringify(payload) });
      if (editingExpense) {
        setExpenses((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
        setSuccess("Expense updated.");
      } else {
        setExpenses((prev) => [saved, ...prev]);
        setSuccess("Expense created.");
      }
      resetExpenseForm();
      setIsExpenseDialogOpen(false);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save expense"));
    } finally {
      setIsExpenseSaving(false);
    }
  };

  const saveSourceAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sourceAccountForm.name.trim()) {
      setError("Account name is required.");
      return;
    }
    if (!sourceAccountForm.currency) {
      setError("Currency is required.");
      return;
    }
    try {
      setSourceAccountSaving(true);
      setError(null);
      setSuccess(null);
      const payload = {
        name: sourceAccountForm.name.trim(),
        account_type: sourceAccountForm.account_type,
        initial_balance: sourceAccountForm.initial_balance,
        currency: Number(sourceAccountForm.currency),
        status: sourceAccountForm.status,
        ...(editingSourceAccount ? { updated_at: editingSourceAccount.updated_at } : {}),
      };
      const path = editingSourceAccount ? `/source-accounts/${editingSourceAccount.id}/` : "/source-accounts/";
      const method = editingSourceAccount ? "PATCH" : "POST";
      const saved = await apiRequest<SourceAccount>(path, { method, body: JSON.stringify(payload) });
      if (editingSourceAccount) {
        setSourceAccounts((prev) => prev.map((item) => (item.id === saved.id ? saved : item)).sort((a, b) => a.name.localeCompare(b.name)));
        setSuccess("Source account updated.");
      } else {
        setSourceAccounts((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
        setSuccess("Source account created.");
      }
      resetSourceAccountForm();
      setSourceAccountDialogOpen(false);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save source account"));
    } finally {
      setSourceAccountSaving(false);
    }
  };

  const deleteExpense = async (expense: Expense) => {
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<void>(`/expenses/${expense.id}/?updated_at=${encodeURIComponent(expense.updated_at)}`, { method: "DELETE" });
      setExpenses((prev) => prev.filter((row) => row.id !== expense.id));
      setSuccess("Expense deleted.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to delete expense"));
    }
  };

  const confirmDeleteSourceAccount = (account: SourceAccount) => {
    setError(null);
    setSuccess(null);
    setDeleteSourceAccountTarget(account);
    setDeleteSourceAccountConfirmed(false);
    setDeleteSourceAccountOpen(true);
  };

  const deleteSourceAccount = async () => {
    if (!deleteSourceAccountTarget) return;
    if (!deleteSourceAccountConfirmed) {
      setError("Confirm the deletion before continuing.");
      return;
    }
    try {
      setError(null);
      setSuccess(null);
      const result = await apiRequest<{ deleted: boolean; active_expense_count: number }>(`/source-accounts/${deleteSourceAccountTarget.id}/`, {
        method: "DELETE",
        body: JSON.stringify({
          updated_at: deleteSourceAccountTarget.updated_at,
          confirm_keyword: "DELETE",
        }),
      });
      setSourceAccounts((prev) => prev.filter((account) => account.id !== deleteSourceAccountTarget.id));
      setDeleteSourceAccountOpen(false);
      setDeleteSourceAccountTarget(null);
      setDeleteSourceAccountConfirmed(false);
      setSuccess(
        result.active_expense_count
          ? `Source account deleted. ${result.active_expense_count} linked expense records were preserved for audit history.`
          : "Source account deleted."
      );
      await loadExpenses();
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to delete source account"));
    }
  };

  const downloadWithAuth = useCallback(async (path: string) => {
    const token = getAuthToken();
    const url = `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Token ${token}`;
    const res = await fetch(url, { headers, credentials: "include", cache: "no-store" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") ?? "";
    const match = /filename="([^"]+)"/i.exec(cd);
    const filename = match?.[1] ?? "download";
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }, []);

  const handleExport = async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      params.set("file_format", exportFormat);
      const selected = exportableFields.filter((field) => exportFields[field]);
      if (selected.length > 0) params.set("fields", selected.join(","));
      if (exportDateFrom) params.set("expense_date_from", exportDateFrom);
      if (exportDateTo) params.set("expense_date_to", exportDateTo);
      if (categoryFilter.trim()) params.set("category", categoryFilter.trim());
      if (sourceAccountFilter.trim()) params.set("source_account", sourceAccountFilter.trim());
      if (mineOnly) params.set("assigned_to", "me");
      await downloadWithAuth(`/expenses/export/?${params.toString()}`);
      setExportOpen(false);
      setSuccess("Expense export downloaded.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to export expenses"));
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      setError("Choose a file to import.");
      return;
    }
    try {
      setImporting(true);
      setError(null);
      const body = new FormData();
      body.append("file", importFile, importFile.name);
      if (importDryRun) body.append("dry_run", "true");
      body.append("rollback_on_error", importRollbackOnError ? "true" : "false");
      const result = await apiRequest<{
        imported?: number;
        rows?: number;
        would_create?: number;
        errors?: unknown[];
        error_log_token?: string;
      }>("/expenses/import/", { method: "POST", body });
      setImportResult(result);
      if (!importDryRun) {
        setSuccess("Expense import completed.");
        await loadExpenses();
      }
    } catch (e: unknown) {
      if (e instanceof ApiError && e.details && typeof e.details === "object") {
        setImportResult(e.details as typeof importResult);
      }
      setError(toUserMessage(e, "Failed to import expenses"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Expenses</h1>
            <p className="text-sm text-gray-500">Create, import, export, and track expenses by managed source account.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setExportOpen(true)}>
              Export
            </Button>
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              Import
            </Button>
            {canWriteSourceAccounts ? (
              <Button type="button" variant="outline" onClick={openCreateSourceAccount}>
                Manage Source Accounts
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                resetExpenseForm();
                setIsExpenseDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Expense
            </Button>
          </div>
        </div>

        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {success ? <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div> : null}

        {canReadSourceAccounts ? (
          <section className="space-y-4 rounded-lg border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Source Accounts</h2>
                <p className="text-sm text-gray-500">Manage petty cash, bank, and wallet accounts used as expense sources.</p>
              </div>
              {canWriteSourceAccounts ? (
                <Button type="button" onClick={openCreateSourceAccount} disabled={currenciesLoading || currencies.length === 0}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Source Account
                </Button>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Account Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Currency</th>
                    <th className="px-4 py-3">Initial Balance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Linked Expenses</th>
                    <th className="px-4 py-3">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sourceAccountsLoading ? (
                    <tr>
                      <td className="px-4 py-6 text-gray-500" colSpan={7}>
                        Loading source accounts...
                      </td>
                    </tr>
                  ) : sourceAccounts.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-gray-500" colSpan={7}>
                        No source accounts created yet.
                      </td>
                    </tr>
                  ) : (
                    sourceAccounts.map((account) => (
                      <tr key={account.id}>
                        <td className="px-4 py-4 font-medium">{account.name}</td>
                        <td className="px-4 py-4">{ACCOUNT_TYPE_LABELS[account.account_type] ?? account.account_type}</td>
                        <td className="px-4 py-4">{account.currency_code}</td>
                        <td className="px-4 py-4">{account.initial_balance}</td>
                        <td className="px-4 py-4">{ACCOUNT_STATUS_LABELS[account.status] ?? account.status}</td>
                        <td className="px-4 py-4">{account.active_expense_count}</td>
                        <td className="px-4 py-4">
                          {canWriteSourceAccounts ? (
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" onClick={() => openEditSourceAccount(account)}>
                                Edit
                              </Button>
                              <Button type="button" variant="destructive" onClick={() => confirmDeleteSourceAccount(account)}>
                                Delete
                              </Button>
                            </div>
                          ) : (
                            <span className="text-gray-400">Read only</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <div className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-5">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vendor, category, project..." />
          <Input value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} placeholder="Category" />
          <Select value={sourceAccountFilter} onChange={(e) => setSourceAccountFilter(e.target.value)}>
            <option value="">All source accounts</option>
            {sourceAccounts.map((account) => (
              <option key={account.id} value={String(account.id)}>
                {account.name}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Assigned to me
          </label>
          <Button type="button" onClick={() => void loadExpenses()}>
            Apply Filters
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Project / Cost Center</th>
                <th className="px-4 py-3">Source Account</th>
                <th className="px-4 py-3">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={7}>
                    Loading...
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={7}>
                    No expenses found.
                  </td>
                </tr>
              ) : (
                expenses.map((expense) => (
                  <tr key={expense.id} className="align-top">
                    <td className="px-4 py-4">{expense.expense_date}</td>
                    <td className="px-4 py-4 font-medium">{expense.amount}</td>
                    <td className="px-4 py-4">
                      <div>{expense.category || "-"}</div>
                      <div className="text-xs text-gray-500">{expense.assigned_to_name || "Unassigned"}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div>{expense.vendor || "-"}</div>
                      <div className="text-xs text-gray-500">{expense.merchant_reference || ""}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div>{expense.project_code || "-"}</div>
                      <div className="text-xs text-gray-500">{expense.cost_center || "-"}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div>{expense.source_account_name || "-"}</div>
                      <div className="text-xs text-gray-500">
                        {expense.source_account_status ? ACCOUNT_STATUS_LABELS[expense.source_account_status] ?? expense.source_account_status : ""}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => openEditExpense(expense)}>
                          Edit
                        </Button>
                        <Button type="button" variant="destructive" onClick={() => void deleteExpense(expense)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {nextUrl ? (
          <Button type="button" variant="outline" disabled={loading} onClick={() => void loadMore()}>
            Load More
          </Button>
        ) : null}

        <Dialog
          open={isExpenseDialogOpen}
          onOpenChange={(open) => {
            setIsExpenseDialogOpen(open);
            if (!open) resetExpenseForm();
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingExpense ? "Edit Expense" : "Add Expense"}</DialogTitle>
            </DialogHeader>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={saveExpense}>
              <div className="space-y-2">
                <Label htmlFor="exp_amount">Amount</Label>
                <Input
                  id="exp_amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_date">Expense Date</Label>
                <Input
                  id="exp_date"
                  type="date"
                  value={expenseForm.expense_date}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, expense_date: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_category">Category</Label>
                <Input id="exp_category" value={expenseForm.category} onChange={(e) => setExpenseForm((prev) => ({ ...prev, category: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_vendor">Vendor</Label>
                <Input id="exp_vendor" value={expenseForm.vendor} onChange={(e) => setExpenseForm((prev) => ({ ...prev, vendor: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_project">Project Code</Label>
                <Input id="exp_project" value={expenseForm.project_code} onChange={(e) => setExpenseForm((prev) => ({ ...prev, project_code: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_cost">Cost Center</Label>
                <Input id="exp_cost" value={expenseForm.cost_center} onChange={(e) => setExpenseForm((prev) => ({ ...prev, cost_center: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_reference">Reference</Label>
                <Input
                  id="exp_reference"
                  value={expenseForm.merchant_reference}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, merchant_reference: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_source_account">Source Account</Label>
                <Select
                  id="exp_source_account"
                  value={expenseForm.source_account}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, source_account: e.target.value }))}
                >
                  <option value="">No source account</option>
                  {activeSourceAccounts.map((account) => (
                    <option key={account.id} value={String(account.id)}>
                      {account.name} ({account.currency_code})
                    </option>
                  ))}
                  {editingExpense?.source_account && editingExpense.source_account_status !== "active" ? (
                    <option value={String(editingExpense.source_account)}>
                      {editingExpense.source_account_name} (Historical)
                    </option>
                  ) : null}
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="exp_desc">Description</Label>
                <textarea
                  id="exp_desc"
                  className="min-h-[100px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setIsExpenseDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isExpenseSaving}>
                  {isExpenseSaving ? "Saving..." : editingExpense ? "Save Changes" : "Create Expense"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={sourceAccountDialogOpen}
          onOpenChange={(open) => {
            setSourceAccountDialogOpen(open);
            if (!open) resetSourceAccountForm();
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingSourceAccount ? "Edit Source Account" : "Create Source Account"}</DialogTitle>
            </DialogHeader>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={saveSourceAccount}>
              <div className="space-y-2">
                <Label htmlFor="source_account_name">Account Name</Label>
                <Input
                  id="source_account_name"
                  value={sourceAccountForm.name}
                  onChange={(e) => setSourceAccountForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="petty1"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source_account_type">Account Type</Label>
                <Select
                  id="source_account_type"
                  value={sourceAccountForm.account_type}
                  onChange={(e) => setSourceAccountForm((prev) => ({ ...prev, account_type: e.target.value }))}
                >
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="source_account_initial_balance">Initial Balance</Label>
                <Input
                  id="source_account_initial_balance"
                  type="number"
                  min="0"
                  step="0.01"
                  value={sourceAccountForm.initial_balance}
                  onChange={(e) => setSourceAccountForm((prev) => ({ ...prev, initial_balance: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source_account_currency">Currency</Label>
                <Select
                  id="source_account_currency"
                  value={sourceAccountForm.currency}
                  onChange={(e) => setSourceAccountForm((prev) => ({ ...prev, currency: e.target.value }))}
                  disabled={currenciesLoading || currencies.length === 0}
                >
                  <option value="">Select currency</option>
                  {currencies.map((currency) => (
                    <option key={currency.id} value={String(currency.id)}>
                      {currency.code} - {currency.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="source_account_status">Account Status</Label>
                <Select
                  id="source_account_status"
                  value={sourceAccountForm.status}
                  onChange={(e) => setSourceAccountForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  {Object.entries(ACCOUNT_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              {currenciesLoading ? (
                <div className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Loading currencies before Source Account details can be submitted.
                </div>
              ) : null}
              <div className="md:col-span-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Source Account changes are tracked in the system audit log. Deleted accounts are closed and hidden from new selections while preserving historical expense links.
              </div>
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setSourceAccountDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={sourceAccountSaving || !sourceAccountForm.currency}>
                  {sourceAccountSaving ? "Saving..." : editingSourceAccount ? "Save Account" : "Create Account"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={deleteSourceAccountOpen}
          onOpenChange={(open) => {
            setDeleteSourceAccountOpen(open);
            if (!open) {
              setDeleteSourceAccountTarget(null);
              setDeleteSourceAccountConfirmed(false);
            }
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Delete Source Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 p-6 pt-0">
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                This hides the source account from future expense selection and closes it permanently. Historical expenses remain linked for reporting and audit purposes.
              </div>
              <div className="text-sm text-gray-700">
                {deleteSourceAccountTarget ? (
                  <>
                    <div className="font-medium">{deleteSourceAccountTarget.name}</div>
                    <div className="text-gray-500">
                      Linked active expenses: {deleteSourceAccountTarget.active_expense_count}
                    </div>
                  </>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={deleteSourceAccountConfirmed} onChange={(e) => setDeleteSourceAccountConfirmed(e.target.checked)} />
                I understand this deletion is permanent for account management and cannot be undone.
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDeleteSourceAccountOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" disabled={!deleteSourceAccountConfirmed} onClick={() => void deleteSourceAccount()}>
                  Delete Source Account
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Export Expenses</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="expense_export_format">Format</Label>
                <Select id="expense_export_format" value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "csv" | "xlsx" | "pdf")}>
                  <option value="csv">CSV</option>
                  <option value="xlsx">Excel</option>
                  <option value="pdf">PDF</option>
                </Select>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="expense_export_from">Date From</Label>
                  <Input id="expense_export_from" type="date" value={exportDateFrom} onChange={(e) => setExportDateFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expense_export_to">Date To</Label>
                  <Input id="expense_export_to" type="date" value={exportDateTo} onChange={(e) => setExportDateTo(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {exportableFields.map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={!!exportFields[field]} onChange={(e) => setExportFields((prev) => ({ ...prev, [field]: e.target.checked }))} />
                    {field}
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setExportOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void handleExport()}>
                  Download
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Import Expenses</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="expense_import_file">Import File</Label>
                <Input id="expense_import_file" type="file" accept=".csv,.xlsx" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={importDryRun} onChange={(e) => setImportDryRun(e.target.checked)} />
                Dry run only
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={importRollbackOnError} onChange={(e) => setImportRollbackOnError(e.target.checked)} />
                Roll back on validation error
              </label>
              {importResult ? (
                <div className="rounded-md border bg-gray-50 p-3 text-sm text-gray-700">
                  <div>Rows: {importResult.rows ?? 0}</div>
                  <div>Created / Planned: {importResult.imported ?? importResult.would_create ?? 0}</div>
                  <div>Errors: {importResult.errors?.length ?? 0}</div>
                  {importResult.error_log_token ? (
                    <button
                      type="button"
                      className="mt-2 text-blue-600 hover:underline"
                      onClick={() => void downloadWithAuth(`/imports/error-log/${importResult.error_log_token}/`)}
                    >
                      Download Error Log
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => void downloadWithAuth("/expenses/import_template/?file_format=xlsx")}
                >
                  Download Template
                </button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
                    Close
                  </Button>
                  <Button type="button" disabled={importing} onClick={() => void handleImport()}>
                    {importing ? "Importing..." : "Run Import"}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
