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
import { useI18n } from "@/lib/i18n";

type ItemType = "product" | "service";

interface Item {
  id: number;
  type: ItemType;
  name: string;
  category: string;
  sku: string | null;
  description: string | null;
  unit_price: number;
  stock_quantity: number;
  updated_at: string;
}

type ItemApi = Omit<Item, "unit_price"> & { unit_price: string | number };

function normalizeItem(raw: ItemApi): Item {
  return {
    ...raw,
    unit_price: typeof raw.unit_price === "number" ? raw.unit_price : Number(raw.unit_price),
  };
}

type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export default function InventoryPage() {
  const { t } = useI18n();
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const money = useMemo(() => new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode || "NGN" }), [currencyCode]);
  const [items, setItems] = useState<Item[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{
    type: ItemType;
    name: string;
    category: string;
    sku: string | null;
    description: string | null;
    unit_price: string;
    stock_quantity: string;
  }>({
    type: "product",
    name: "",
    category: "General",
    sku: null,
    description: null,
    unit_price: "0",
    stock_quantity: "0",
  });
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  const exportableFields = useMemo(
    () => [
      "type",
      "sku",
      "name",
      "category",
      "description",
      "unit_price",
      "tax_rate",
      "tax_category",
      "unit_of_measure",
      "stock_quantity",
      "created_at",
      "updated_at",
    ],
    []
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx" | "pdf">("csv");
  const [exportCreatedFrom, setExportCreatedFrom] = useState("");
  const [exportCreatedTo, setExportCreatedTo] = useState("");
  const [exportFieldSelection, setExportFieldSelection] = useState<Record<string, boolean>>(() => {
    const defaults = new Set(["type", "sku", "name", "category", "unit_price", "tax_rate", "stock_quantity", "updated_at"]);
    const next: Record<string, boolean> = {};
    for (const f of exportableFields) next[f] = defaults.has(f);
    return next;
  });

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDryRun, setImportDryRun] = useState(false);
  const [importRollbackOnError, setImportRollbackOnError] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported?: number; rows?: number; errors?: unknown[]; error_log_token?: string } | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ effective: { currency_code: string } }>("/settings/effective/")
      .then((res) => {
        if (!cancelled) setCurrencyCode(res?.effective?.currency_code || "NGN");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [newItem, setNewItem] = useState<{
    type: ItemType;
    name: string;
    category: string;
    sku: string;
    description: string;
    unit_price: string;
    stock_quantity: string;
  }>({
    type: "product",
    name: "",
    category: "General",
    sku: "",
    description: "",
    unit_price: "",
    stock_quantity: "0",
  });

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 403) return t("forbidden");
      if (e.status === 409) return t("conflict");
    }
    return getErrorMessage(e, fallback);
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiRequest<Paginated<ItemApi>>("/items/?page=1");
        if (!cancelled) {
          setItems(data.results.map(normalizeItem));
          setNextUrl(data.next);
          setSelectedIds({});
        }
      } catch (e: unknown) {
        if (!cancelled) setError(toUserMessage(e, "Failed to load inventory"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toUserMessage]);

  const loadMore = async () => {
    if (!nextUrl) return;
    try {
      setLoading(true);
      setError(null);
      const data = await apiRequest<Paginated<ItemApi>>(nextUrl);
      setItems((prev) => [...prev, ...data.results.map(normalizeItem)]);
      setNextUrl(data.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more items"));
    } finally {
      setLoading(false);
    }
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();

    const unitPrice = Number(newItem.unit_price);
    const stockQuantity = newItem.type === "service" ? 0 : Number(newItem.stock_quantity);

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setError("Unit price must be a valid number >= 0");
      return;
    }
    if (!newItem.category.trim()) {
      setError("Category is required");
      return;
    }
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
      setError("Stock quantity must be a valid number >= 0");
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      const created = await apiRequest<ItemApi>("/items/", {
        method: "POST",
        body: JSON.stringify({
          type: newItem.type,
          name: newItem.name.trim(),
          category: newItem.category.trim(),
          sku: newItem.sku.trim() || null,
          description: newItem.description.trim() || null,
          unit_price: unitPrice,
          stock_quantity: stockQuantity,
        }),
      });
      setItems((prev) => [normalizeItem(created), ...prev]);
      setNewItem({
        type: "product",
        name: "",
        category: "General",
        sku: "",
        description: "",
        unit_price: "",
        stock_quantity: "0",
      });
      setIsAddOpen(false);
      setSuccess(t("saved"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to create item"));
    }
  };

  const startEdit = (it: Item) => {
    setError(null);
    setSuccess(null);
    setEditingId(it.id);
    setEditDraft({
      type: it.type,
      name: it.name,
      category: it.category,
      sku: it.sku,
      description: it.description,
      unit_price: String(it.unit_price),
      stock_quantity: String(it.stock_quantity),
    });
  };

  const requestSave = () => {
    if (editingId === null) return;
    if (!editDraft.name.trim()) {
      setError(t("nameRequired"));
      return;
    }
    const unitPrice = Number(editDraft.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setError(t("unitPriceInvalid"));
      return;
    }
    if (!editDraft.category.trim()) {
      setError("Category is required");
      return;
    }
    const stockQuantity = editDraft.type === "service" ? 0 : Number(editDraft.stock_quantity);
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0 || !Number.isInteger(stockQuantity)) {
      setError(t("stockQuantityInvalid"));
      return;
    }
    setConfirmSaveOpen(true);
  };

  const confirmSave = async () => {
    if (editingId === null) return;
    const current = items.find((i) => i.id === editingId);
    if (!current) return;
    const unitPrice = Number(editDraft.unit_price);
    const stockQuantity = editDraft.type === "service" ? 0 : Number(editDraft.stock_quantity);
    try {
      setError(null);
      setSuccess(null);
      const updated = await apiRequest<ItemApi>(`/items/${editingId}/`, {
        method: "PATCH",
        body: JSON.stringify({
          type: editDraft.type,
          name: editDraft.name.trim(),
          category: editDraft.category.trim(),
          sku: (editDraft.sku ?? "").trim() || null,
          description: (editDraft.description ?? "").trim() || null,
          unit_price: unitPrice,
          stock_quantity: stockQuantity,
          updated_at: current.updated_at,
        }),
      });
      const normalized = normalizeItem(updated);
      setItems((prev) => prev.map((i) => (i.id === normalized.id ? normalized : i)));
      setEditingId(null);
      setConfirmSaveOpen(false);
      setSuccess(t("saved"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save item"));
      setConfirmSaveOpen(false);
    }
  };

  const requestDelete = (id: number) => {
    setError(null);
    setSuccess(null);
    setPendingDeleteId(id);
    setConfirmDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (pendingDeleteId === null) return;
    const current = items.find((i) => i.id === pendingDeleteId);
    if (!current) return;
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<void>(`/items/${pendingDeleteId}/?updated_at=${encodeURIComponent(current.updated_at)}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((i) => i.id !== pendingDeleteId));
      setSelectedIds((prev) => {
        const next = { ...prev };
        delete next[pendingDeleteId];
        return next;
      });
      setConfirmDeleteOpen(false);
      setPendingDeleteId(null);
      setSuccess(t("deleted"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to delete item"));
      setConfirmDeleteOpen(false);
    }
  };

  const selectedList = Object.entries(selectedIds)
    .filter(([, v]) => v)
    .map(([k]) => Number(k));

  const confirmBulkDelete = async () => {
    if (selectedList.length === 0) return;
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<{ deleted: number }>("/items/bulk_delete/", {
        method: "POST",
        body: JSON.stringify({ ids: selectedList }),
      });
      setItems((prev) => prev.filter((i) => !selectedIds[i.id]));
      setSelectedIds({});
      setConfirmBulkDeleteOpen(false);
      setSuccess(t("deleted"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to bulk delete items"));
      setConfirmBulkDeleteOpen(false);
    }
  };

  const onExportInventory = async () => {
    const selectedFields = exportableFields.filter((f) => exportFieldSelection[f]);
    if (selectedFields.length === 0) {
      setError("Select at least one field to export");
      return;
    }
    try {
      setError(null);
      setSuccess(null);
      const params = new URLSearchParams();
      params.set("file_format", exportFormat);
      params.set("fields", selectedFields.join(","));
      if (exportCreatedFrom.trim()) params.set("created_from", exportCreatedFrom.trim());
      if (exportCreatedTo.trim()) params.set("created_to", exportCreatedTo.trim());
      await downloadWithAuth(`/items/export/?${params.toString()}`);
      setExportOpen(false);
      setSuccess("Export started.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to export inventory"));
    }
  };

  const onImportInventory = async () => {
    if (!importFile) {
      setError("Select a file to import");
      return;
    }
    try {
      setImporting(true);
      setError(null);
      setSuccess(null);
      setImportResult(null);
      const form = new FormData();
      form.append("file", importFile);
      form.append("dry_run", importDryRun ? "true" : "false");
      form.append("rollback_on_error", importRollbackOnError ? "true" : "false");
      const res = await apiRequest<{ imported?: number; rows?: number; errors?: unknown[]; error_log_token?: string }>("/items/import/", {
        method: "POST",
        body: form,
      });
      setImportResult(res);
      setSuccess(importDryRun ? "Validation complete." : "Import complete.");
    } catch (e: unknown) {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "error_log_token" in (e.details as any)) {
        setImportResult(e.details as any);
      }
      setError(toUserMessage(e, "Failed to import inventory"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Inventory</h1>
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Product/Service
          </Button>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {success}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setExportOpen(true)} disabled={loading}>
            Export
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={loading}>
            Import
          </Button>
          <Button
            variant="destructive"
            disabled={selectedList.length === 0}
            onClick={() => setConfirmBulkDeleteOpen(true)}
          >
            {t("deleteSelected")} ({selectedList.length})
          </Button>
        </div>

        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Export Inventory</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="inventory_export_format">Format</Label>
                <Select
                  id="inventory_export_format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value === "pdf" ? "pdf" : e.target.value === "xlsx" ? "xlsx" : "csv")}
                >
                  <option value="csv">CSV</option>
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="pdf">PDF</option>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="inventory_export_created_from">Created From</Label>
                  <Input id="inventory_export_created_from" type="date" value={exportCreatedFrom} onChange={(e) => setExportCreatedFrom(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="inventory_export_created_to">Created To</Label>
                  <Input id="inventory_export_created_to" type="date" value={exportCreatedTo} onChange={(e) => setExportCreatedTo(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Fields</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {exportableFields.map((f) => (
                    <label key={f} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!exportFieldSelection[f]}
                        onChange={(e) => setExportFieldSelection((p) => ({ ...p, [f]: e.target.checked }))}
                      />
                      <span>{f}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setExportOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={() => void onExportInventory()} disabled={loading}>
                  Export
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Import Inventory</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="inventory_import_file">File (.csv or .xlsx)</Label>
                <Input
                  id="inventory_import_file"
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button variant="outline" onClick={() => void downloadWithAuth("/items/import_template/?file_format=xlsx")} disabled={importing}>
                Download template
              </Button>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={importDryRun} onChange={(e) => setImportDryRun(e.target.checked)} />
                  <span>Dry run (validate only)</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={importRollbackOnError}
                    onChange={(e) => setImportRollbackOnError(e.target.checked)}
                  />
                  <span>Rollback on any error</span>
                </label>
              </div>
              {importResult ? (
                <div className="rounded-md border px-3 py-2 text-sm">
                  <div>Rows: {String(importResult.rows ?? "")}</div>
                  {"imported" in importResult ? <div>Imported: {String(importResult.imported ?? "")}</div> : null}
                  {Array.isArray(importResult.errors) && importResult.errors.length ? <div>Errors: {String(importResult.errors.length)}</div> : null}
                </div>
              ) : null}
              {importResult?.error_log_token ? (
                <Button
                  variant="outline"
                  onClick={() => void downloadWithAuth(`/imports/error-log/${importResult.error_log_token}/`)}
                  disabled={importing}
                >
                  Download Error Log
                </Button>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
                  Close
                </Button>
                <Button onClick={() => void onImportInventory()} disabled={importing}>
                  {importing ? "Importing..." : importDryRun ? "Validate" : "Import"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selectedList.length === items.length}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const next: Record<number, boolean> = {};
                      for (const it of items) next[it.id] = checked;
                      setSelectedIds(next);
                    }}
                  />
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SKU
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stock
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={9}>
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={9}>
                    No items yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                const isLowStock = item.type === "product" && item.stock_quantity < 5;
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={!!selectedIds[item.id]}
                        onChange={(e) => setSelectedIds((p) => ({ ...p, [item.id]: e.target.checked }))}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {editingId === item.id ? (
                        <Input value={editDraft.name} onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))} />
                      ) : (
                        item.name
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {editingId === item.id ? (
                        <Select
                          value={editDraft.type}
                          onChange={(e) => {
                            const v = e.target.value;
                            const nextType: ItemType = v === "service" ? "service" : "product";
                            setEditDraft((p) => ({
                              ...p,
                              type: nextType,
                              stock_quantity: nextType === "service" ? "0" : p.stock_quantity,
                            }));
                          }}
                        >
                          <option value="product">Product</option>
                          <option value="service">Service</option>
                        </Select>
                      ) : (
                        (item.type === "product" ? "Product" : "Service")
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {editingId === item.id ? (
                        <Input value={editDraft.sku ?? ""} onChange={(e) => setEditDraft((p) => ({ ...p, sku: e.target.value || null }))} />
                      ) : (
                        item.sku || "-"
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {editingId === item.id ? (
                        <Input value={editDraft.category} onChange={(e) => setEditDraft((p) => ({ ...p, category: e.target.value }))} />
                      ) : (
                        item.category
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {editingId === item.id ? (
                        <Input
                          value={editDraft.description ?? ""}
                          onChange={(e) => setEditDraft((p) => ({ ...p, description: e.target.value || null }))}
                        />
                      ) : (
                        item.description || "-"
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {editingId === item.id ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editDraft.unit_price}
                          onChange={(e) => setEditDraft((p) => ({ ...p, unit_price: e.target.value }))}
                        />
                      ) : (
                        money.format(Number.isFinite(item.unit_price) ? item.unit_price : 0)
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {item.type === "service" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          N/A
                        </span>
                      ) : (
                        editingId === item.id ? (
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={editDraft.stock_quantity}
                            onChange={(e) => setEditDraft((p) => ({ ...p, stock_quantity: e.target.value }))}
                          />
                        ) : (
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              isLowStock ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
                            }`}
                          >
                            {item.stock_quantity} in stock
                          </span>
                        )
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {editingId === item.id ? (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={requestSave}>
                            {t("save")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                            {t("cancel")}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEdit(item)}>
                            {t("edit")}
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => requestDelete(item.id)}>
                            {t("delete")}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {nextUrl ? (
        <div className="flex justify-center mt-4">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {t("loadMore")}
          </Button>
        </div>
      ) : null}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Product or Service</DialogTitle>
          </DialogHeader>
          <form onSubmit={addItem} className="p-6 pt-0 space-y-4">
            <div>
              <Label>Type</Label>
              <Select
                value={newItem.type}
                onChange={(e) => {
                  const type = e.target.value as ItemType;
                  setNewItem((prev) => ({
                    ...prev,
                    type,
                    stock_quantity: type === "service" ? "0" : prev.stock_quantity,
                  }));
                }}
              >
                <option value="product">Product</option>
                <option value="service">Service</option>
              </Select>
            </div>

            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newItem.name}
                onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>

            <div>
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={newItem.category}
                onChange={(e) => setNewItem((prev) => ({ ...prev, category: e.target.value }))}
                required
              />
            </div>

            <div>
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                value={newItem.sku}
                onChange={(e) => setNewItem((prev) => ({ ...prev, sku: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={newItem.description}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="unit_price">Unit Price</Label>
                <Input
                  id="unit_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newItem.unit_price}
                  onChange={(e) =>
                    setNewItem((prev) => ({ ...prev, unit_price: e.target.value }))
                  }
                  required
                />
              </div>

              {newItem.type === "product" ? (
                <div>
                  <Label htmlFor="stock_quantity">Stock Quantity</Label>
                  <Input
                    id="stock_quantity"
                    type="number"
                    min="0"
                    step="1"
                    value={newItem.stock_quantity}
                    onChange={(e) =>
                      setNewItem((prev) => ({ ...prev, stock_quantity: e.target.value }))
                    }
                    required
                  />
                </div>
              ) : (
                <div className="flex items-end">
                  <div className="w-full text-sm text-gray-500">
                    Stock is not tracked for services.
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmSaveOpen} onOpenChange={setConfirmSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmSaveTitle")}</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">{t("confirmSaveBody")}</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmSaveOpen(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={confirmSave}>{t("confirm")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">{t("confirmDeleteBody")}</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                {t("confirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmBulkDeleteOpen} onOpenChange={setConfirmBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">{t("confirmDeleteBody")}</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmBulkDeleteOpen(false)}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" onClick={confirmBulkDelete}>
                {t("confirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
