"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { API_BASE_URL, ApiError, apiRequest, getAuthToken, getErrorMessage } from "@/lib/api";

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
  source_account: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  updated_at: string;
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

const EMPTY_FORM: ExpenseForm = {
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

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sourceAccountFilter, setSourceAccountFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
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

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 403) return e.message || "You do not have permission to manage expenses.";
      if (e.status === 409) return e.message || "This expense was changed by another user.";
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

  const loadExpenses = useCallback(async (path?: string) => {
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
  }, [buildListPath, toUserMessage]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

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

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingExpense(null);
  };

  const openEdit = (expense: Expense) => {
    setError(null);
    setSuccess(null);
    setEditingExpense(expense);
    setForm({
      amount: expense.amount,
      expense_date: expense.expense_date,
      category: expense.category ?? "",
      description: expense.description ?? "",
      vendor: expense.vendor ?? "",
      merchant_reference: expense.merchant_reference ?? "",
      project_code: expense.project_code ?? "",
      cost_center: expense.cost_center ?? "",
      source_account: expense.source_account ?? "",
    });
    setIsAddOpen(true);
  };

  const saveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.category.trim()) {
      setError("Category is required.");
      return;
    }
    if (!form.project_code.trim() && !form.cost_center.trim()) {
      setError("Project code or cost center is required.");
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const body = new FormData();
      body.append("amount", form.amount);
      body.append("expense_date", form.expense_date);
      body.append("category", form.category.trim());
      body.append("description", form.description.trim());
      body.append("vendor", form.vendor.trim());
      body.append("merchant_reference", form.merchant_reference.trim());
      body.append("project_code", form.project_code.trim());
      body.append("cost_center", form.cost_center.trim());
      body.append("source_account", form.source_account.trim());
      if (editingExpense) body.append("updated_at", editingExpense.updated_at);

      const path = editingExpense ? `/expenses/${editingExpense.id}/` : "/expenses/";
      const method = editingExpense ? "PATCH" : "POST";
      const saved = await apiRequest<Expense>(path, { method, body });
      if (editingExpense) {
        setExpenses((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
        setSuccess("Expense updated.");
      } else {
        setExpenses((prev) => [saved, ...prev]);
        setSuccess("Expense created.");
      }
      resetForm();
      setIsAddOpen(false);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save expense"));
    } finally {
      setIsSaving(false);
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
            <p className="text-sm text-gray-500">Create, import, and export operational spending records.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setExportOpen(true)}>
              Export
            </Button>
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <Button
              type="button"
              onClick={() => {
                resetForm();
                setIsAddOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Expense
            </Button>
          </div>
        </div>

        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {success ? <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div> : null}

        <div className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-5">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vendor, category, project..." />
          <Input value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} placeholder="Category" />
          <Input value={sourceAccountFilter} onChange={(e) => setSourceAccountFilter(e.target.value)} placeholder="Source account" />
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
                  <td className="px-4 py-6 text-gray-500" colSpan={7}>Loading...</td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={7}>No expenses found.</td>
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
                      <div>{expense.source_account || "-"}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={() => openEdit(expense)}>Edit</Button>
                        <Button type="button" variant="destructive" onClick={() => void deleteExpense(expense)}>Delete</Button>
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

        <Dialog open={isAddOpen} onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) resetForm();
        }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingExpense ? "Edit Expense" : "Add Expense"}</DialogTitle>
            </DialogHeader>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={saveExpense}>
              <div className="space-y-2">
                <Label htmlFor="exp_amount">Amount</Label>
                <Input id="exp_amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_date">Expense Date</Label>
                <Input id="exp_date" type="date" value={form.expense_date} onChange={(e) => setForm((prev) => ({ ...prev, expense_date: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_category">Category</Label>
                <Input id="exp_category" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_vendor">Vendor</Label>
                <Input id="exp_vendor" value={form.vendor} onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_project">Project Code</Label>
                <Input id="exp_project" value={form.project_code} onChange={(e) => setForm((prev) => ({ ...prev, project_code: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_cost">Cost Center</Label>
                <Input id="exp_cost" value={form.cost_center} onChange={(e) => setForm((prev) => ({ ...prev, cost_center: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_reference">Reference</Label>
                <Input id="exp_reference" value={form.merchant_reference} onChange={(e) => setForm((prev) => ({ ...prev, merchant_reference: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp_source_account">Source Account</Label>
                <Input
                  id="exp_source_account"
                  list="expense_source_accounts"
                  value={form.source_account}
                  onChange={(e) => setForm((prev) => ({ ...prev, source_account: e.target.value }))}
                  placeholder="petty1"
                />
                <datalist id="expense_source_accounts">
                  <option value="petty1" />
                  <option value="petty2" />
                </datalist>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="exp_desc">Description</Label>
                <textarea
                  id="exp_desc"
                  className="min-h-[100px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editingExpense ? "Save Changes" : "Create Expense"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Export Expenses</DialogTitle></DialogHeader>
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
                    <input
                      type="checkbox"
                      checked={!!exportFields[field]}
                      onChange={(e) => setExportFields((prev) => ({ ...prev, [field]: e.target.checked }))}
                    />
                    {field}
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button>
                <Button type="button" onClick={() => void handleExport()}>Download</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Import Expenses</DialogTitle></DialogHeader>
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
                  <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Close</Button>
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
