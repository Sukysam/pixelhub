"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus, Search, Trash2 } from "lucide-react";
import { API_BASE_URL, ApiError, apiRequest, getAuthToken, getErrorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

interface Customer {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
}

interface Item {
  id: number;
  type: "product" | "service";
  name: string;
  sku: string | null;
  description: string | null;
  unit_price: number;
  tax_rate: number;
  tax_category: string;
  unit_of_measure: string;
}

type ItemApi = Omit<Item, "unit_price" | "tax_rate"> & {
  unit_price: string | number;
  tax_rate: string | number;
};

type InvoiceListItem = {
  id: number;
  invoice_number: string;
  customer: number;
  issue_date: string;
  due_date: string | null;
  status: "Draft" | "Sent" | "Paid" | "Overdue";
  subtotal: string;
  tax_total: string;
  total_amount: string;
  updated_at: string;
};

type InvoiceItemResponse = {
  id: number;
  invoice: number;
  item: number;
  description: string | null;
  unit_of_measure: string | null;
  quantity: number;
  unit_price: string;
  tax_rate: string | null;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
  updated_at: string;
};

type InvoiceResponse = {
  id: number;
  invoice_number: string;
  customer: number;
  status: InvoiceListItem["status"];
  subtotal: string;
  tax_total: string;
  total_amount: string;
  updated_at: string;
  invoice_items: InvoiceItemResponse[];
};

type PaymentTx = {
  id: number;
  provider: "bank_transfer" | "opay" | "flutterwave" | "paystack";
  status: string;
  reference: string;
  payment_url: string | null;
};

type SavedInvoiceView = {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  is_default: boolean;
};

type DeliveryChannel = "print" | "email" | "whatsapp";
type DeliveryFormat = "pdf" | "html" | "text";
type InvoiceSummaryMode = "create" | "view";
type PaymentMode = "cash" | "bank_transfer" | "card_manual" | "card_gateway";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string) {
  const s = value.trim().replace(/[\s().-]/g, "");
  if (!s) return false;
  return /^\+?[0-9]{7,15}$/.test(s);
}

function whatsappPhoneDigits(value: string): string {
  const s = value.trim().replace(/[^\d+]/g, "");
  if (!s) return "";
  return s.startsWith("+") ? s.slice(1).replace(/\D/g, "") : s.replace(/\D/g, "");
}

function whatsappShareUrl(text: string, phone: string): string {
  const msg = String(text ?? "").trim();
  const digits = whatsappPhoneDigits(phone);
  const params = new URLSearchParams();
  if (msg) params.set("text", msg);
  return digits ? `https://wa.me/${digits}?${params.toString()}` : `https://wa.me/?${params.toString()}`;
}

function normalizeItem(raw: ItemApi): Item {
  return {
    ...raw,
    unit_price: typeof raw.unit_price === "number" ? raw.unit_price : Number(raw.unit_price),
    tax_rate: typeof raw.tax_rate === "number" ? raw.tax_rate : Number(raw.tax_rate),
  };
}

interface LineItem {
  id: number;
  itemId: number | null;
  quantity: string;
  taxRateOverride: string;
}

function parsePositiveInt(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseTaxRate(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function luhnOk(value: string) {
  const digits = (value || "").replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function calcLineTotals(unitPrice: number, qty: number, taxRate: number) {
  const lineSubtotal = unitPrice * qty;
  const lineTax = (lineSubtotal * taxRate) / 100;
  const lineTotal = lineSubtotal + lineTax;
  return { lineSubtotal, lineTax, lineTotal };
}

export default function InvoicesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const money = useMemo(() => new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode || "NGN" }), [currencyCode]);
  const formatMoney = useCallback((value: number): string => {
    if (!Number.isFinite(value)) return money.format(0);
    return money.format(value);
  }, [money]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersNext, setCustomersNext] = useState<string | null>(null);
  const [inventoryItems, setInventoryItems] = useState<Item[]>([]);
  const [itemsNext, setItemsNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingInvoice, setSavingInvoice] = useState(false);

  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [invoicesNext, setInvoicesNext] = useState<string | null>(null);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Record<number, boolean>>({});
  const [invoiceEditingId, setInvoiceEditingId] = useState<number | null>(null);
  const [filterInvoiceNumber, setFilterInvoiceNumber] = useState("");
  const [filterStatus, setFilterStatus] = useState<InvoiceListItem["status"] | "">("");
  const [filterCustomer, setFilterCustomer] = useState<number | "">("");
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState("");
  const [filterIssueDateTo, setFilterIssueDateTo] = useState("");
  const [filterDueDateFrom, setFilterDueDateFrom] = useState("");
  const [filterDueDateTo, setFilterDueDateTo] = useState("");
  const [filterTotalMin, setFilterTotalMin] = useState("");
  const [filterTotalMax, setFilterTotalMax] = useState("");
  const [savedViews, setSavedViews] = useState<SavedInvoiceView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<number | "">("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [saveViewDefault, setSaveViewDefault] = useState(false);
  const [invoiceEditDraft, setInvoiceEditDraft] = useState<{ status: InvoiceListItem["status"]; due_date: string }>({
    status: "Draft",
    due_date: "",
  });
  const [confirmInvoiceSaveOpen, setConfirmInvoiceSaveOpen] = useState(false);
  const [confirmInvoiceDeleteOpen, setConfirmInvoiceDeleteOpen] = useState(false);

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
  const [pendingInvoiceDeleteId, setPendingInvoiceDeleteId] = useState<number | null>(null);
  const [confirmInvoiceBulkDeleteOpen, setConfirmInvoiceBulkDeleteOpen] = useState(false);

  const invoiceExportableFields = useMemo(
    () => [
      "invoice_number",
      "customer_name",
      "customer_email",
      "status",
      "issue_date",
      "due_date",
      "subtotal",
      "tax_total",
      "total_amount",
      "updated_at",
    ],
    []
  );
  const [invoiceExportOpen, setInvoiceExportOpen] = useState(false);
  const [invoiceExportFormat, setInvoiceExportFormat] = useState<"csv" | "xlsx" | "pdf">("csv");
  const [invoiceExportFieldSelection, setInvoiceExportFieldSelection] = useState<Record<string, boolean>>(() => {
    const defaults = new Set(["invoice_number", "customer_name", "status", "issue_date", "due_date", "subtotal", "tax_total", "total_amount"]);
    const next: Record<string, boolean> = {};
    for (const f of invoiceExportableFields) next[f] = defaults.has(f);
    return next;
  });

  const [invoiceImportOpen, setInvoiceImportOpen] = useState(false);
  const [invoiceImportFile, setInvoiceImportFile] = useState<File | null>(null);
  const [invoiceImportDryRun, setInvoiceImportDryRun] = useState(false);
  const [invoiceImportRollbackOnError, setInvoiceImportRollbackOnError] = useState(true);
  const [invoiceImporting, setInvoiceImporting] = useState(false);
  const [invoiceImportResult, setInvoiceImportResult] = useState<
    | {
        imported_invoices?: number;
        imported_invoice_items?: number;
        rows?: number;
        errors?: unknown[];
        error_log_token?: string;
      }
    | null
  >(null);

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

  const [selectedCustomer, setSelectedCustomer] = useState<number | "">("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const [invoiceSummaryOpen, setInvoiceSummaryOpen] = useState(false);
  const [invoiceSummaryLoading, setInvoiceSummaryLoading] = useState(false);
  const [invoiceSummaryError, setInvoiceSummaryError] = useState<string | null>(null);
  const [invoiceSummaryInvoice, setInvoiceSummaryInvoice] = useState<InvoiceResponse | null>(null);
  const [invoiceSummaryConfirming, setInvoiceSummaryConfirming] = useState(false);
  const [invoiceSummaryCancelling, setInvoiceSummaryCancelling] = useState(false);
  const [invoiceSummaryPaying, setInvoiceSummaryPaying] = useState(false);
  const [invoiceSummaryMode, setInvoiceSummaryMode] = useState<InvoiceSummaryMode>("create");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<number | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("card_gateway");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentProvider, setPaymentProvider] = useState<PaymentTx["provider"]>("paystack");
  const [paymentEmail, setPaymentEmail] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpMonth, setCardExpMonth] = useState("");
  const [cardExpYear, setCardExpYear] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardAuthCode, setCardAuthCode] = useState("");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [rowPaymentInvoiceId, setRowPaymentInvoiceId] = useState<number | null>(null);
  const [lastPaymentTx, setLastPaymentTx] = useState<PaymentTx | null>(null);
  const paymentAttemptRef = useRef(0);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendChannel, setSendChannel] = useState<DeliveryChannel>("email");
  const [sendFormat, setSendFormat] = useState<DeliveryFormat>("pdf");
  const [sendToEmail, setSendToEmail] = useState("");
  const [sendToPhone, setSendToPhone] = useState("");
  const [sendPrinterName, setSendPrinterName] = useState("");
  const [sendingDoc, setSendingDoc] = useState(false);
  const [sendEmailTouched, setSendEmailTouched] = useState(false);
  const [sendPhoneTouched, setSendPhoneTouched] = useState(false);
  const [sendEmailAutoFilled, setSendEmailAutoFilled] = useState(false);
  const [sendPhoneAutoFilled, setSendPhoneAutoFilled] = useState(false);
  const [sendEmailWarning, setSendEmailWarning] = useState<string | null>(null);
  const [sendPhoneWarning, setSendPhoneWarning] = useState<string | null>(null);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerLineId, setPickerLineId] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState("");

  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [addItemTargetLineId, setAddItemTargetLineId] = useState<number | null>(null);
  const [creatingItem, setCreatingItem] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<{
    type: "product" | "service";
    name: string;
    sku: string;
    unit_price: string;
    tax_category: string;
    tax_rate: string;
    description: string;
    unit_of_measure: string;
  }>({
    type: "product",
    name: "",
    sku: "",
    unit_price: "",
    tax_category: "standard",
    tax_rate: "0",
    description: "",
    unit_of_measure: "pcs",
  });

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 403) {
        return e.message || "You do not have permission to save invoice records. Please check your role or contact an administrator.";
      }
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
        const [cust, items, inv, views] = await Promise.all([
          apiRequest<Paginated<Customer>>("/customers/?page=1"),
          apiRequest<Paginated<ItemApi>>("/items/?page=1"),
          apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1"),
          apiRequest<{ results: SavedInvoiceView[] }>("/invoices/views/"),
        ]);
        if (cancelled) return;
        setCustomers(cust.results);
        setCustomersNext(cust.next);
        setInventoryItems(items.results.map(normalizeItem));
        setItemsNext(items.next);
        if (cust.results.length > 0) setSelectedCustomer(cust.results[0].id);
        setInvoices(inv.results);
        setInvoicesNext(inv.next);
        setSelectedInvoiceIds({});
        setSavedViews(views.results || []);
      } catch (e: unknown) {
        if (!cancelled) setError(toUserMessage(e, "Failed to load invoice data"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toUserMessage]);

  const loadMoreInvoices = async () => {
    if (!invoicesNext) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<Paginated<InvoiceListItem>>(invoicesNext);
      setInvoices((p) => [...p, ...res.results]);
      setInvoicesNext(res.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more invoices"));
    } finally {
      setLoading(false);
    }
  };

  const loadMoreCustomers = async () => {
    if (!customersNext) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<Paginated<Customer>>(customersNext);
      setCustomers((p) => [...p, ...res.results]);
      setCustomersNext(res.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more customers"));
    } finally {
      setLoading(false);
    }
  };

  const loadMoreItems = async () => {
    if (!itemsNext) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<Paginated<ItemApi>>(itemsNext);
      setInventoryItems((p) => [...p, ...res.results.map(normalizeItem)]);
      setItemsNext(res.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more items"));
    } finally {
      setLoading(false);
    }
  };

  const currentInvoiceFilterObject = useMemo(() => {
    return {
      invoice_number: filterInvoiceNumber.trim(),
      status: filterStatus,
      customer: filterCustomer === "" ? "" : String(filterCustomer),
      issue_date_from: filterIssueDateFrom,
      issue_date_to: filterIssueDateTo,
      due_date_from: filterDueDateFrom,
      due_date_to: filterDueDateTo,
      total_min: filterTotalMin.trim(),
      total_max: filterTotalMax.trim(),
    } as Record<string, unknown>;
  }, [
    filterCustomer,
    filterDueDateFrom,
    filterDueDateTo,
    filterInvoiceNumber,
    filterIssueDateFrom,
    filterIssueDateTo,
    filterStatus,
    filterTotalMax,
    filterTotalMin,
  ]);

  const invoicesUrlForFilters = useCallback((filters: Record<string, unknown>, page = 1) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    for (const [k, v] of Object.entries(filters)) {
      if (v == null) continue;
      const s = String(v).trim();
      if (!s) continue;
      params.set(k, s);
    }
    return `/invoices/?${params.toString()}`;
  }, []);

  const refreshSavedViews = useCallback(async () => {
    const res = await apiRequest<{ results: SavedInvoiceView[] }>("/invoices/views/");
    setSavedViews(res.results || []);
  }, []);

  const applyInvoiceFilters = useCallback(
    async (filters: Record<string, unknown>) => {
      try {
        setLoading(true);
        setError(null);
        const url = invoicesUrlForFilters(filters, 1);
        const inv = await apiRequest<Paginated<InvoiceListItem>>(url);
        setInvoices(inv.results);
        setInvoicesNext(inv.next);
        setSelectedInvoiceIds({});
        setInvoiceEditingId(null);
      } catch (e: unknown) {
        setError(toUserMessage(e, "Failed to load invoices"));
      } finally {
        setLoading(false);
      }
    },
    [invoicesUrlForFilters, toUserMessage]
  );

  const onSearchInvoices = async () => {
    setSelectedViewId("");
    await applyInvoiceFilters(currentInvoiceFilterObject);
  };

  const onClearInvoiceFilters = async () => {
    setFilterInvoiceNumber("");
    setFilterStatus("");
    setFilterCustomer("");
    setFilterIssueDateFrom("");
    setFilterIssueDateTo("");
    setFilterDueDateFrom("");
    setFilterDueDateTo("");
    setFilterTotalMin("");
    setFilterTotalMax("");
    setSelectedViewId("");
    await applyInvoiceFilters({});
  };

  const onExportInvoices = () => {
    setInvoiceExportOpen(true);
  };

  const doExportInvoices = async () => {
    const selectedFields = invoiceExportableFields.filter((f) => invoiceExportFieldSelection[f]);
    if (selectedFields.length === 0) {
      setError("Select at least one field to export");
      return;
    }
    try {
      setError(null);
      setSuccess(null);
      const params = new URLSearchParams();
      params.set("file_format", invoiceExportFormat);
      params.set("fields", selectedFields.join(","));
      for (const [k, v] of Object.entries(currentInvoiceFilterObject)) {
        if (v == null) continue;
        const s = String(v).trim();
        if (!s) continue;
        params.set(k, s);
      }
      await downloadWithAuth(`/invoices/export/?${params.toString()}`);
      setInvoiceExportOpen(false);
      setSuccess("Export started.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to export invoices"));
    }
  };

  const doImportInvoices = async () => {
    if (!invoiceImportFile) {
      setError("Select a file to import");
      return;
    }
    try {
      setInvoiceImporting(true);
      setError(null);
      setSuccess(null);
      setInvoiceImportResult(null);
      const form = new FormData();
      form.append("file", invoiceImportFile);
      form.append("dry_run", invoiceImportDryRun ? "true" : "false");
      form.append("rollback_on_error", invoiceImportRollbackOnError ? "true" : "false");
      const res = await apiRequest<{
        imported_invoices?: number;
        imported_invoice_items?: number;
        rows?: number;
        errors?: unknown[];
        error_log_token?: string;
      }>("/invoices/import/", { method: "POST", body: form });
      setInvoiceImportResult(res);
      setSuccess(invoiceImportDryRun ? "Validation complete." : "Import complete.");
      await applyInvoiceFilters(currentInvoiceFilterObject);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "error_log_token" in (e.details as any)) {
        setInvoiceImportResult(e.details as any);
      }
      setError(toUserMessage(e, "Failed to import invoices"));
    } finally {
      setInvoiceImporting(false);
    }
  };

  const applySavedView = async (view: SavedInvoiceView) => {
    const f = view.filters || {};
    setFilterInvoiceNumber(String(f.invoice_number ?? ""));
    setFilterStatus((String(f.status ?? "") as InvoiceListItem["status"] | "") || "");
    const rawCustomer = String(f.customer ?? "");
    setFilterCustomer(rawCustomer ? Number(rawCustomer) : "");
    setFilterIssueDateFrom(String(f.issue_date_from ?? ""));
    setFilterIssueDateTo(String(f.issue_date_to ?? ""));
    setFilterDueDateFrom(String(f.due_date_from ?? ""));
    setFilterDueDateTo(String(f.due_date_to ?? ""));
    setFilterTotalMin(String(f.total_min ?? ""));
    setFilterTotalMax(String(f.total_max ?? ""));
    setSelectedViewId(view.id);
    await applyInvoiceFilters(f as Record<string, unknown>);
  };

  const onCreateSavedView = async () => {
    const name = saveViewName.trim();
    if (!name) {
      setError("View name is required");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await apiRequest("/invoices/views/", {
        method: "POST",
        body: JSON.stringify({ name, filters: currentInvoiceFilterObject, is_default: saveViewDefault }),
      });
      setSaveViewOpen(false);
      setSaveViewName("");
      setSaveViewDefault(false);
      await refreshSavedViews();
      setSuccess("View saved.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save view"));
    } finally {
      setLoading(false);
    }
  };

  const onDeleteSavedView = async () => {
    if (!selectedViewId) return;
    try {
      setLoading(true);
      setError(null);
      await apiRequest(`/invoices/views/${selectedViewId}/`, { method: "DELETE" });
      setSelectedViewId("");
      await refreshSavedViews();
      setSuccess("View deleted.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to delete view"));
    } finally {
      setLoading(false);
    }
  };

  const selectedInvoiceList = Object.entries(selectedInvoiceIds)
    .filter(([, v]) => v)
    .map(([k]) => Number(k));

  const startInvoiceEdit = (inv: InvoiceListItem) => {
    setError(null);
    setSuccess(null);
    setInvoiceEditingId(inv.id);
    setInvoiceEditDraft({
      status: inv.status,
      due_date: inv.due_date ?? "",
    });
  };

  const requestInvoiceSave = () => {
    if (invoiceEditingId === null) return;
    setConfirmInvoiceSaveOpen(true);
  };

  const confirmInvoiceSave = async () => {
    if (invoiceEditingId === null) return;
    const current = invoices.find((i) => i.id === invoiceEditingId);
    if (!current) return;
    try {
      setError(null);
      setSuccess(null);
      const updated = await apiRequest<InvoiceListItem>(`/invoices/${invoiceEditingId}/`, {
        method: "PATCH",
        body: JSON.stringify({
          status: invoiceEditDraft.status,
          due_date: invoiceEditDraft.due_date || null,
          updated_at: current.updated_at,
        }),
      });
      setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setInvoiceEditingId(null);
      setConfirmInvoiceSaveOpen(false);
      setSuccess(t("saved"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save invoice"));
      setConfirmInvoiceSaveOpen(false);
    }
  };

  const requestInvoiceDelete = (id: number) => {
    setError(null);
    setSuccess(null);
    setPendingInvoiceDeleteId(id);
    setConfirmInvoiceDeleteOpen(true);
  };

  const confirmInvoiceDelete = async () => {
    if (pendingInvoiceDeleteId === null) return;
    const current = invoices.find((i) => i.id === pendingInvoiceDeleteId);
    if (!current) return;
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<void>(`/invoices/${pendingInvoiceDeleteId}/?updated_at=${encodeURIComponent(current.updated_at)}`, {
        method: "DELETE",
      });
      setInvoices((prev) => prev.filter((i) => i.id !== pendingInvoiceDeleteId));
      setSelectedInvoiceIds((prev) => {
        const next = { ...prev };
        delete next[pendingInvoiceDeleteId];
        return next;
      });
      setConfirmInvoiceDeleteOpen(false);
      setPendingInvoiceDeleteId(null);
      setSuccess(t("deleted"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to delete invoice"));
      setConfirmInvoiceDeleteOpen(false);
    }
  };

  const confirmInvoiceBulkDelete = async () => {
    if (selectedInvoiceList.length === 0) return;
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<{ deleted: number }>("/invoices/bulk_delete/", {
        method: "POST",
        body: JSON.stringify({ ids: selectedInvoiceList }),
      });
      setInvoices((prev) => prev.filter((i) => !selectedInvoiceIds[i.id]));
      setSelectedInvoiceIds({});
      setConfirmInvoiceBulkDeleteOpen(false);
      setSuccess(t("deleted"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to bulk delete invoices"));
      setConfirmInvoiceBulkDeleteOpen(false);
    }
  };

  const itemsById = useMemo(() => {
    const map = new Map<number, Item>();
    for (const i of inventoryItems) map.set(i.id, i);
    return map;
  }, [inventoryItems]);

  const filteredInventory = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return inventoryItems;
    return inventoryItems.filter((i) => {
      const haystack = `${i.name} ${i.sku ?? ""} ${i.description ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [inventoryItems, itemSearch]);

  const computed = useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;
    let grandTotal = 0;

    for (const li of lineItems) {
      if (!li.itemId) continue;
      const qty = parsePositiveInt(li.quantity);
      if (!qty) continue;
      const item = itemsById.get(li.itemId);
      if (!item) continue;
      const effectiveTaxRate =
        li.taxRateOverride.trim() !== "" ? parseTaxRate(li.taxRateOverride) : item.tax_rate;
      const taxRate = effectiveTaxRate ?? 0;
      const { lineSubtotal, lineTax, lineTotal } = calcLineTotals(item.unit_price, qty, taxRate);
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      grandTotal += lineTotal;
    }

    return { subtotal, taxTotal, grandTotal };
  }, [itemsById, lineItems]);

  const addLineItem = () => {
    const li: LineItem = { id: Date.now(), itemId: null, quantity: "1", taxRateOverride: "" };
    setLineItems((prev) => [...prev, li]);
    setPickerLineId(li.id);
    setIsPickerOpen(true);
  };

  const updateLineItem = (id: number, patch: Partial<LineItem>) => {
    setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  };

  const removeLineItem = (id: number) => {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  };

  const openPicker = (lineId: number) => {
    setPickerLineId(lineId);
    setIsPickerOpen(true);
  };

  const openAddNewItem = (lineId: number) => {
    setNewItemError(null);
    setAddItemTargetLineId(lineId);
    setIsAddItemOpen(true);
  };

  const createAndAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewItemError(null);
    setError(null);
    setSuccess(null);

    const name = newItem.name.trim();
    if (!name) {
      setNewItemError("Item name is required");
      return;
    }
    const unitPrice = Number(newItem.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setNewItemError("Unit price must be a number >= 0");
      return;
    }
    const taxRate = parseTaxRate(newItem.tax_rate);
    if (taxRate === null) {
      setNewItemError("Tax rate must be a number between 0 and 100");
      return;
    }
    const taxCategory = newItem.tax_category.trim();
    if (!taxCategory) {
      setNewItemError("Tax category is required");
      return;
    }
    const uom = newItem.unit_of_measure.trim();
    if (!uom) {
      setNewItemError("Unit of measure is required");
      return;
    }

    try {
      setCreatingItem(true);
      const created = await apiRequest<ItemApi>("/items/", {
        method: "POST",
        body: JSON.stringify({
          type: newItem.type,
          name,
          sku: newItem.sku.trim() || null,
          unit_price: unitPrice,
          tax_rate: taxRate,
          tax_category: taxCategory,
          unit_of_measure: uom,
          description: newItem.description.trim() || null,
        }),
      });

      const normalized = normalizeItem(created);
      setInventoryItems((prev) => [normalized, ...prev]);

      if (addItemTargetLineId !== null) {
        updateLineItem(addItemTargetLineId, { itemId: normalized.id });
      }

      setIsAddItemOpen(false);
      setAddItemTargetLineId(null);
      setNewItem({
        type: "product",
        name: "",
        sku: "",
        unit_price: "",
        tax_category: "standard",
        tax_rate: "0",
        description: "",
        unit_of_measure: "pcs",
      });
      setSuccess("Item created and added to invoice.");
    } catch (e: unknown) {
      setNewItemError(toUserMessage(e, "Failed to create item"));
    } finally {
      setCreatingItem(false);
    }
  };

  const saveInvoice = async () => {
    setError(null);
    setSuccess(null);
    if (!selectedCustomer) {
      setError("Please select a customer");
      return;
    }
    if (lineItems.length === 0) {
      setError("Please add at least one line item");
      return;
    }

    const normalizedLines: Array<{ item: number; quantity: number; tax_rate?: number }> = [];
    for (const li of lineItems) {
      if (!li.itemId) {
        setError("Please select an item for each line");
        return;
      }
      const qty = parsePositiveInt(li.quantity);
      if (!qty) {
        setError("Quantity must be a whole number >= 1");
        return;
      }
      const override = li.taxRateOverride.trim() !== "" ? parseTaxRate(li.taxRateOverride) : null;
      if (li.taxRateOverride.trim() !== "" && override === null) {
        setError("Tax rate override must be a number between 0 and 100");
        return;
      }

      const payloadLine: { item: number; quantity: number; tax_rate?: number } = {
        item: li.itemId,
        quantity: qty,
      };
      if (override !== null) payloadLine.tax_rate = override;
      normalizedLines.push(payloadLine);
    }

    try {
      setInvoiceSummaryError(null);
      setInvoiceSummaryInvoice(null);
      setInvoiceSummaryMode("create");
      setInvoiceSummaryOpen(true);
      setInvoiceSummaryLoading(true);
      setSavingInvoice(true);
      const created = await apiRequest<InvoiceResponse>("/invoices/", {
        method: "POST",
        body: JSON.stringify({
          customer: selectedCustomer,
          status: "Draft",
          items: normalizedLines,
        }),
      });
      setInvoiceSummaryInvoice(created);
    } catch (e: unknown) {
      const msg = toUserMessage(e, "Failed to save invoice");
      setInvoiceSummaryError(msg);
      setError(msg);
      setInvoiceSummaryOpen(false);
    } finally {
      setInvoiceSummaryLoading(false);
      setSavingInvoice(false);
    }
  };

  const confirmInvoiceSummarySave = async (alsoNavigateToPayment: boolean) => {
    if (!invoiceSummaryInvoice) return;
    try {
      setInvoiceSummaryConfirming(true);
      setInvoiceSummaryError(null);
      const inv = await apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1");
      setInvoices(inv.results);
      setInvoicesNext(inv.next);
      setSelectedInvoiceIds({});
      setLineItems([]);
      setSuccess(`Invoice ${invoiceSummaryInvoice.invoice_number} saved.`);
      setInvoiceSummaryOpen(false);
      if (alsoNavigateToPayment) {
        router.push(`/receipts?invoice=${encodeURIComponent(String(invoiceSummaryInvoice.id))}&open=1`);
      }
    } catch (e: unknown) {
      setInvoiceSummaryError(toUserMessage(e, "Failed to refresh invoices"));
    } finally {
      setInvoiceSummaryConfirming(false);
    }
  };

  const cancelInvoiceSummary = async () => {
    if (invoiceSummaryLoading) return;
    if (!invoiceSummaryInvoice) {
      setInvoiceSummaryOpen(false);
      return;
    }
    if (invoiceSummaryMode !== "create") {
      setInvoiceSummaryOpen(false);
      return;
    }
    try {
      setInvoiceSummaryCancelling(true);
      setInvoiceSummaryError(null);
      await apiRequest<void>(`/invoices/${invoiceSummaryInvoice.id}/?updated_at=${encodeURIComponent(invoiceSummaryInvoice.updated_at)}`, {
        method: "DELETE",
      });
      setSuccess("Invoice save cancelled.");
      const inv = await apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1");
      setInvoices(inv.results);
      setInvoicesNext(inv.next);
      setSelectedInvoiceIds({});
      setInvoiceSummaryOpen(false);
    } catch (e: unknown) {
      setInvoiceSummaryError(toUserMessage(e, "Failed to discard invoice. You may need to delete it from the invoice list."));
    } finally {
      setInvoiceSummaryCancelling(false);
    }
  };

  const openSendInvoice = () => {
    if (!invoiceSummaryInvoice) return;
    setSendChannel("email");
    setSendFormat("pdf");
    setSendToEmail("");
    setSendToPhone("");
    setSendPrinterName("");
    setSendEmailTouched(false);
    setSendPhoneTouched(false);
    setSendEmailAutoFilled(false);
    setSendPhoneAutoFilled(false);
    setSendEmailWarning(null);
    setSendPhoneWarning(null);
    setSendOpen(true);
  };

  useEffect(() => {
    if (!sendOpen) return;
    if (!invoiceSummaryInvoice) return;
    const cust = customers.find((c) => c.id === invoiceSummaryInvoice.customer);
    if (!cust) return;

    if (sendChannel === "email") {
      const raw = (cust.email ?? "").trim();
      if (!sendEmailTouched && !sendToEmail.trim()) {
        if (raw && isValidEmail(raw)) {
          setSendToEmail(raw);
          setSendEmailAutoFilled(true);
          setSendEmailWarning(null);
        } else if (raw) {
          setSendEmailAutoFilled(false);
          setSendEmailWarning("Customer email is invalid. Please enter manually.");
        }
      }
    }

    if (sendChannel === "whatsapp") {
      const raw = (cust.phone ?? "").trim();
      if (!sendPhoneTouched && !sendToPhone.trim()) {
        if (raw && isValidPhone(raw)) {
          setSendToPhone(raw);
          setSendPhoneAutoFilled(true);
          setSendPhoneWarning(null);
        } else if (raw) {
          setSendPhoneAutoFilled(false);
          setSendPhoneWarning("Customer phone is invalid. Please enter manually.");
        }
      }
    }
  }, [customers, invoiceSummaryInvoice, sendChannel, sendEmailTouched, sendOpen, sendPhoneTouched, sendToEmail, sendToPhone]);

  const openInvoiceDetails = async (invoiceId: number) => {
    setInvoiceSummaryError(null);
    setInvoiceSummaryInvoice(null);
    setInvoiceSummaryMode("view");
    setInvoiceSummaryOpen(true);
    setInvoiceSummaryLoading(true);
    try {
      const inv = await apiRequest<InvoiceResponse>(`/invoices/${invoiceId}/`);
      setInvoiceSummaryInvoice(inv);
    } catch (e: unknown) {
      const msg = toUserMessage(e, "Failed to load invoice");
      setInvoiceSummaryError(msg);
      setInvoiceSummaryOpen(false);
    } finally {
      setInvoiceSummaryLoading(false);
    }
  };

  const openPaymentForInvoice = (invoiceId: number) => {
    setPaymentInvoiceId(invoiceId);
    setPaymentMode("card_gateway");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentAmount("");
    setPaymentReference("");
    setPaymentProvider("paystack");
    setPaymentEmail("");
    setPaymentPhone("");
    setCardNumber("");
    setCardExpMonth("");
    setCardExpYear("");
    setCardCvv("");
    setCardAuthCode("");
    setLastPaymentTx(null);
    setPaymentOpen(true);
  };

  const startPayment = async () => {
    if (paymentProcessing) return;
    if (!paymentInvoiceId) return;
    setError(null);
    setSuccess(null);
    setInvoiceSummaryError(null);
    paymentAttemptRef.current += 1;
    const idem = `pay-${paymentInvoiceId}-${paymentAttemptRef.current}`;
    try {
      setPaymentProcessing(true);
      setRowPaymentInvoiceId(paymentInvoiceId);
      if (paymentMode === "cash" || paymentMode === "bank_transfer" || paymentMode === "card_manual") {
        const amount = Number(paymentAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          setError("Amount must be a valid number > 0");
          return;
        }
        if (!paymentDate) {
          setError("Transaction date is required");
          return;
        }
        if (paymentMode === "bank_transfer" && !paymentReference.trim()) {
          setError("Reference number is required for bank transfers");
          return;
        }

        let reference_number: string | null = null;
        let payment_method: "Cash" | "Bank Transfer" | "Card" = "Cash";
        if (paymentMode === "cash") {
          payment_method = "Cash";
          reference_number = null;
        } else if (paymentMode === "bank_transfer") {
          payment_method = "Bank Transfer";
          reference_number = paymentReference.trim();
        } else {
          payment_method = "Card";
          const expMonth = Number(cardExpMonth);
          const expYear = Number(cardExpYear);
          const cvvDigits = (cardCvv || "").replace(/\D/g, "");
          if (!luhnOk(cardNumber)) {
            setError("Invalid card number");
            return;
          }
          if (!Number.isFinite(expMonth) || expMonth < 1 || expMonth > 12) {
            setError("Invalid expiry month");
            return;
          }
          if (!Number.isFinite(expYear) || expYear < 2000 || expYear > 2100) {
            setError("Invalid expiry year");
            return;
          }
          const now = new Date();
          const cutoff = new Date(expYear, expMonth - 1, 1);
          cutoff.setMonth(cutoff.getMonth() + 1);
          if (cutoff <= now) {
            setError("Card has expired");
            return;
          }
          if (!(cvvDigits.length === 3 || cvvDigits.length === 4)) {
            setError("Invalid CVV");
            return;
          }
          if (!cardAuthCode.trim()) {
            setError("Authorization code is required");
            return;
          }
          const last4 = (cardNumber || "").replace(/\D/g, "").slice(-4);
          reference_number = `AUTH:${cardAuthCode.trim()} LAST4:${last4}`;
        }

        await apiRequest(`/invoices/${paymentInvoiceId}/pay/`, {
          method: "POST",
          headers: { "Idempotency-Key": idem },
          body: JSON.stringify({
            amount_paid: amount,
            payment_date: paymentDate,
            payment_method,
            reference_number,
          }),
        });
        setSuccess("Payment recorded.");
        setPaymentOpen(false);
        await refreshInvoicesQuietly();
      } else {
        if (paymentProvider !== "bank_transfer" && !paymentEmail.trim()) {
          setError("Email is required for online payments");
          return;
        }
        const tx = await apiRequest<PaymentTx>("/payments/transactions/", {
          method: "POST",
          headers: { "Idempotency-Key": idem },
          body: JSON.stringify({
            provider: paymentProvider,
            invoice: paymentInvoiceId,
            currency_code: currencyCode,
            email: paymentEmail.trim() || undefined,
            phone: paymentPhone.trim() || undefined,
            redirect_url: typeof window !== "undefined" ? window.location.origin + "/invoices" : undefined,
            country: "NG",
          }),
        });
        setLastPaymentTx(tx);

        if (!tx.payment_url) {
          if (paymentProvider === "bank_transfer") {
            setSuccess(`Bank transfer initiated. Use reference ${tx.reference} for reconciliation.`);
            setPaymentOpen(false);
            return;
          }
          setError("Gateway did not return a payment URL");
          return;
        }
        if (typeof window !== "undefined") window.open(tx.payment_url, "_blank", "noopener,noreferrer");
        setSuccess("Payment checkout opened. This invoice will update when payment confirms.");
      }
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to start payment"));
    } finally {
      setPaymentProcessing(false);
      setRowPaymentInvoiceId(null);
    }
  };

  const checkLastPaymentStatus = async () => {
    if (!lastPaymentTx) return;
    try {
      const updated = await apiRequest<PaymentTx>(`/payments/transactions/${lastPaymentTx.id}/verify/`, { method: "POST" });
      setLastPaymentTx(updated);
      await refreshInvoicesQuietly();
      if (updated.status === "succeeded") setSuccess("Payment confirmed.");
      else if (updated.status === "failed") setError("Payment failed.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Unable to verify payment"));
    }
  };

  const refreshInvoicesQuietly = useCallback(async () => {
    if (loading) return;
    if (invoiceEditingId !== null) return;
    try {
      const url = invoicesUrlForFilters(currentInvoiceFilterObject, 1);
      const inv = await apiRequest<Paginated<InvoiceListItem>>(url);
      setInvoices((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        return (inv.results || []).map((n) => ({ ...byId.get(n.id), ...n }));
      });
      setInvoicesNext(inv.next);
    } catch {
      return;
    }
  }, [currentInvoiceFilterObject, invoiceEditingId, invoicesUrlForFilters, loading]);

  useEffect(() => {
    const onFocus = () => void refreshInvoicesQuietly();
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshInvoicesQuietly();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(() => void refreshInvoicesQuietly(), 12000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, [refreshInvoicesQuietly]);

  const sendInvoice = async () => {
    if (!invoiceSummaryInvoice) return;
    if (sendingDoc) return;
    setInvoiceSummaryError(null);
    if (sendChannel === "email") {
      const v = sendToEmail.trim();
      if (!v) {
        setInvoiceSummaryError("Email is required");
        return;
      }
      if (!isValidEmail(v)) {
        setInvoiceSummaryError("Invalid email address");
        return;
      }
    }
    if (sendChannel === "whatsapp") {
      const v = sendToPhone.trim();
      if (v && !isValidPhone(v)) {
        setInvoiceSummaryError("Invalid phone number");
        return;
      }
    }
    if (sendChannel === "print") {
      const v = sendPrinterName.trim();
      if (!v) {
        setInvoiceSummaryError("Printer name is required");
        return;
      }
    }
    try {
      setSendingDoc(true);
      if (sendChannel === "whatsapp") {
        const share = await apiRequest<{ download_url: string }>(`/invoices/${invoiceSummaryInvoice.id}/share_link/`, {
          method: "POST",
          body: JSON.stringify({ ttl_minutes: 60 * 24 * 7 }),
        });
        const cust = customers.find((c) => c.id === invoiceSummaryInvoice.customer);
        const customerName = cust?.name?.trim() || `#${invoiceSummaryInvoice.customer}`;
        const total = formatMoney(Number(invoiceSummaryInvoice.total_amount));
        const msg = [`Invoice ${invoiceSummaryInvoice.invoice_number}`, `Customer: ${customerName}`, `Total: ${total}`, share.download_url].join("\n");
        const url = whatsappShareUrl(msg, sendToPhone.trim());
        const win = window.open(url, "_blank", "noopener,noreferrer");
        if (!win) {
          setInvoiceSummaryError("Pop-up blocked. Please allow pop-ups, then try again.");
          return;
        }
        setSuccess(`Opened WhatsApp for invoice ${invoiceSummaryInvoice.invoice_number}.`);
        setSendOpen(false);
        return;
      }

      const res = await apiRequest<{ report?: { ok: boolean; error?: { message?: string | null } | null; retry?: { recommended?: boolean; next_retry_at?: string | null } } }>(
        "/documents/deliveries/",
        {
          method: "POST",
          body: JSON.stringify({
            document_type: "invoice",
            document_id: invoiceSummaryInvoice.id,
            channel: sendChannel,
            format: sendFormat,
            to_email: sendChannel === "email" ? sendToEmail.trim() : undefined,
            printer_name: sendChannel === "print" ? sendPrinterName.trim() : undefined,
            send_now: true,
          }),
        }
      );
      if (res?.report && res.report.ok === false) {
        const msg = res.report.error?.message || "Delivery failed";
        const retryHint =
          res.report.retry?.recommended && res.report.retry?.next_retry_at ? ` Retry scheduled at ${res.report.retry.next_retry_at}.` : "";
        setInvoiceSummaryError(`${msg}.${retryHint}`.trim());
        return;
      }
      setSuccess(`Invoice ${invoiceSummaryInvoice.invoice_number} sent.`);
      setSendOpen(false);
    } catch (e: unknown) {
      setInvoiceSummaryError(toUserMessage(e, "Failed to send invoice"));
    } finally {
      setSendingDoc(false);
    }
  };

  const statusPillClass = (s: InvoiceListItem["status"]) => {
    if (s === "Paid") return "bg-green-50 text-green-800 border-green-200";
    if (s === "Overdue") return "bg-red-50 text-red-800 border-red-200";
    if (s === "Sent") return "bg-amber-50 text-amber-800 border-amber-200";
    return "bg-gray-50 text-gray-800 border-gray-200";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Create Invoice</h1>

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

        <div className="bg-white border rounded-lg p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Customer</Label>
              <Select
                value={selectedCustomer}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedCustomer(v === "" ? "" : Number(v));
                }}
                disabled={loading}
              >
                <option value="">Select a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {customersNext ? (
                <div className="mt-2">
                  <Button type="button" variant="outline" size="sm" onClick={loadMoreCustomers} disabled={loading}>
                    {t("loadMore")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Line Items</h3>
              <Button onClick={addLineItem} size="sm" disabled={loading}>
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </div>

            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Tax %</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lineItems.map((li) => {
                    const invItem = li.itemId ? itemsById.get(li.itemId) : undefined;
                    const qty = parsePositiveInt(li.quantity) ?? 0;
                    const unitPrice = invItem?.unit_price ?? 0;
                    const effectiveTaxRate =
                      li.taxRateOverride.trim() !== ""
                        ? parseTaxRate(li.taxRateOverride) ?? 0
                        : invItem?.tax_rate ?? 0;
                    const { lineTotal } = calcLineTotals(unitPrice, qty, effectiveTaxRate);

                    return (
                      <tr key={li.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => openPicker(li.id)} disabled={loading}>
                              <Search className="mr-2 h-4 w-4" />
                              {invItem ? invItem.name : "Select item"}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => openAddNewItem(li.id)} disabled={loading}>
                              Add New Item
                            </Button>
                          </div>
                          {invItem?.description ? (
                            <div className="mt-1 text-xs text-gray-500 line-clamp-2">{invItem.description}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 w-28">
                          <Input
                            type="number"
                            value={li.taxRateOverride}
                            onChange={(e) => updateLineItem(li.id, { taxRateOverride: e.target.value })}
                            placeholder={invItem ? String(invItem.tax_rate) : "0"}
                            min="0"
                            max="100"
                            step="0.01"
                            disabled={loading || !invItem}
                          />
                        </td>
                        <td className="px-4 py-3 w-28">
                          <Input
                            type="number"
                            value={li.quantity}
                            onChange={(e) => updateLineItem(li.id, { quantity: e.target.value })}
                            min="1"
                            disabled={loading}
                          />
                          {invItem ? <div className="mt-1 text-xs text-gray-500">{invItem.unit_of_measure}</div> : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="h-10 flex items-center text-sm text-gray-700">{formatMoney(unitPrice)}</div>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">{formatMoney(lineTotal)}</td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" onClick={() => removeLineItem(li.id)} disabled={loading}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-medium">{formatMoney(computed.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Tax</span>
              <span className="font-medium">{formatMoney(computed.taxTotal)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total</span>
              <span>{formatMoney(computed.grandTotal)}</span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveInvoice} disabled={loading || savingInvoice}>
              {savingInvoice ? "Saving..." : "Save Invoice"}
            </Button>
          </div>
        </div>

        <div className="bg-white border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-gray-900">Manage Invoices</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={onExportInvoices} disabled={loading}>
                Export
              </Button>
              <Button variant="outline" onClick={() => setInvoiceImportOpen(true)} disabled={loading}>
                Import
              </Button>
              <Button
                variant="destructive"
                disabled={selectedInvoiceList.length === 0}
                onClick={() => setConfirmInvoiceBulkDeleteOpen(true)}
              >
                {t("deleteSelected")} ({selectedInvoiceList.length})
              </Button>
            </div>
          </div>

          <Dialog open={invoiceExportOpen} onOpenChange={setInvoiceExportOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Export Invoices</DialogTitle>
                <DialogDescription>Exports the current filtered invoice list.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="invoice_export_format">Format</Label>
                  <Select
                    id="invoice_export_format"
                    value={invoiceExportFormat}
                    onChange={(e) => setInvoiceExportFormat(e.target.value === "pdf" ? "pdf" : e.target.value === "xlsx" ? "xlsx" : "csv")}
                  >
                    <option value="csv">CSV</option>
                    <option value="xlsx">Excel (.xlsx)</option>
                    <option value="pdf">PDF</option>
                  </Select>
                </div>
                <div>
                  <Label>Fields</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {invoiceExportableFields.map((f) => (
                      <label key={f} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!invoiceExportFieldSelection[f]}
                          onChange={(e) => setInvoiceExportFieldSelection((p) => ({ ...p, [f]: e.target.checked }))}
                        />
                        <span>{f}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setInvoiceExportOpen(false)} disabled={loading}>
                    Cancel
                  </Button>
                  <Button onClick={() => void doExportInvoices()} disabled={loading}>
                    Export
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={invoiceImportOpen} onOpenChange={setInvoiceImportOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Import Invoices</DialogTitle>
                <DialogDescription>Upload a .csv or .xlsx with invoice line items.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="invoice_import_file">File (.csv or .xlsx)</Label>
                  <Input id="invoice_import_file" type="file" accept=".csv,.xlsx" onChange={(e) => setInvoiceImportFile(e.target.files?.[0] ?? null)} />
                </div>
                <Button variant="outline" onClick={() => void downloadWithAuth("/invoices/import_template/?file_format=xlsx")} disabled={invoiceImporting}>
                  Download template
                </Button>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={invoiceImportDryRun} onChange={(e) => setInvoiceImportDryRun(e.target.checked)} />
                    <span>Dry run (validate only)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={invoiceImportRollbackOnError}
                      onChange={(e) => setInvoiceImportRollbackOnError(e.target.checked)}
                    />
                    <span>Rollback on any error</span>
                  </label>
                </div>
                {invoiceImportResult ? (
                  <div className="rounded-md border px-3 py-2 text-sm">
                    <div>Rows: {String(invoiceImportResult.rows ?? "")}</div>
                    {"imported_invoices" in invoiceImportResult ? <div>Imported invoices: {String(invoiceImportResult.imported_invoices ?? "")}</div> : null}
                    {"imported_invoice_items" in invoiceImportResult ? (
                      <div>Imported line items: {String(invoiceImportResult.imported_invoice_items ?? "")}</div>
                    ) : null}
                    {Array.isArray(invoiceImportResult.errors) && invoiceImportResult.errors.length ? (
                      <div>Errors: {String(invoiceImportResult.errors.length)}</div>
                    ) : null}
                  </div>
                ) : null}
                {invoiceImportResult?.error_log_token ? (
                  <Button variant="outline" onClick={() => void downloadWithAuth(`/imports/error-log/${invoiceImportResult.error_log_token}/`)} disabled={invoiceImporting}>
                    Download Error Log
                  </Button>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setInvoiceImportOpen(false)} disabled={invoiceImporting}>
                    Close
                  </Button>
                  <Button onClick={() => void doImportInvoices()} disabled={invoiceImporting}>
                    {invoiceImporting ? "Importing..." : invoiceImportDryRun ? "Validate" : "Import"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="filter_invoice_number">Invoice Number</Label>
                <Input
                  id="filter_invoice_number"
                  value={filterInvoiceNumber}
                  onChange={(e) => setFilterInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-2026-0001"
                  disabled={loading}
                />
              </div>
              <div>
                <Label htmlFor="filter_status">Status</Label>
                <Select id="filter_status" value={filterStatus} onChange={(e) => setFilterStatus((e.target.value as InvoiceListItem["status"]) || "")} disabled={loading}>
                  <option value="">All</option>
                  <option value="Draft">Draft</option>
                  <option value="Sent">Sent</option>
                  <option value="Paid">Paid</option>
                  <option value="Overdue">Overdue</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="filter_customer">Customer</Label>
                <Select
                  id="filter_customer"
                  value={filterCustomer === "" ? "" : String(filterCustomer)}
                  onChange={(e) => setFilterCustomer(e.target.value ? Number(e.target.value) : "")}
                  disabled={loading}
                >
                  <option value="">All</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="filter_total_min">Amount</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    id="filter_total_min"
                    type="number"
                    step="0.01"
                    value={filterTotalMin}
                    onChange={(e) => setFilterTotalMin(e.target.value)}
                    placeholder="Min"
                    disabled={loading}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={filterTotalMax}
                    onChange={(e) => setFilterTotalMax(e.target.value)}
                    placeholder="Max"
                    disabled={loading}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="filter_issue_from">Issue Date</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    id="filter_issue_from"
                    type="date"
                    value={filterIssueDateFrom}
                    onChange={(e) => setFilterIssueDateFrom(e.target.value)}
                    disabled={loading}
                  />
                  <Input type="date" value={filterIssueDateTo} onChange={(e) => setFilterIssueDateTo(e.target.value)} disabled={loading} />
                </div>
              </div>
              <div>
                <Label htmlFor="filter_due_from">Due Date</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    id="filter_due_from"
                    type="date"
                    value={filterDueDateFrom}
                    onChange={(e) => setFilterDueDateFrom(e.target.value)}
                    disabled={loading}
                  />
                  <Input type="date" value={filterDueDateTo} onChange={(e) => setFilterDueDateTo(e.target.value)} disabled={loading} />
                </div>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="saved_view">Saved View</Label>
                <div className="flex flex-wrap gap-2">
                  <Select
                    id="saved_view"
                    value={selectedViewId === "" ? "" : String(selectedViewId)}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : "";
                      if (!v) {
                        setSelectedViewId("");
                        return;
                      }
                      const found = savedViews.find((sv) => sv.id === v);
                      if (found) void applySavedView(found);
                    }}
                    disabled={loading}
                  >
                    <option value="">None</option>
                    {savedViews.map((sv) => (
                      <option key={sv.id} value={sv.id}>
                        {sv.name}
                      </option>
                    ))}
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setSaveViewOpen(true)} disabled={loading}>
                    Save View
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void onDeleteSavedView()} disabled={loading || !selectedViewId}>
                    Delete View
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onExportInvoices} disabled={loading}>
                Export CSV
              </Button>
              <Button type="button" variant="outline" onClick={() => void onClearInvoiceFilters()} disabled={loading}>
                Clear
              </Button>
              <Button type="button" onClick={() => void onSearchInvoices()} disabled={loading}>
                <Search className="mr-2 h-4 w-4" />
                Search
              </Button>
            </div>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={invoices.length > 0 && selectedInvoiceList.length === invoices.length}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const next: Record<number, boolean> = {};
                        for (const inv of invoices) next[inv.id] = checked;
                        setSelectedInvoiceIds(next);
                      }}
                    />
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Invoice #</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Due</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invoices.length === 0 ? (
                  <tr>
                    <td className="px-6 py-6 text-sm text-gray-500" colSpan={7}>
                      No invoices yet.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => {
                    const customerName = customers.find((c) => c.id === inv.customer)?.name ?? `#${inv.customer}`;
                    const isPaid = inv.status === "Paid";
                    const isRowPaying = rowPaymentInvoiceId === inv.id;
                    return (
                      <tr key={inv.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={!!selectedInvoiceIds[inv.id]}
                            onChange={(e) => setSelectedInvoiceIds((p) => ({ ...p, [inv.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-4 py-4 text-sm font-medium text-gray-900">{inv.invoice_number}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">{customerName}</td>
                        <td className="px-4 py-4 text-sm">
                          {invoiceEditingId === inv.id ? (
                            <Select
                              value={invoiceEditDraft.status}
                              onChange={(e) =>
                                setInvoiceEditDraft((p) => ({
                                  ...p,
                                  status: (e.target.value as InvoiceListItem["status"]) || "Draft",
                                }))
                              }
                            >
                              <option value="Draft">Draft</option>
                              <option value="Sent">Sent</option>
                              <option value="Paid">Paid</option>
                              <option value="Overdue">Overdue</option>
                            </Select>
                          ) : (
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusPillClass(inv.status)}`} aria-label={`Status: ${inv.status}`}>
                              {inv.status}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          {invoiceEditingId === inv.id ? (
                            <Input
                              type="date"
                              value={invoiceEditDraft.due_date}
                              onChange={(e) => setInvoiceEditDraft((p) => ({ ...p, due_date: e.target.value }))}
                            />
                          ) : (
                            inv.due_date ?? "-"
                          )}
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-gray-900">
                          {formatMoney(Number(inv.total_amount))}
                        </td>
                        <td className="px-4 py-4 text-sm">
                          {invoiceEditingId === inv.id ? (
                            <div className="flex gap-2">
                              <Button size="sm" onClick={requestInvoiceSave}>
                                {t("save")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setInvoiceEditingId(null)}>
                                {t("cancel")}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-col sm:flex-row gap-2">
                              {isPaid ? (
                                <Button
                                  size="sm"
                                  onClick={() => void openInvoiceDetails(inv.id)}
                                  aria-label={`View invoice ${inv.invoice_number}`}
                                  disabled={isRowPaying}
                                >
                                  View Invoice
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => openPaymentForInvoice(inv.id)}
                                  aria-label={`Make payment for invoice ${inv.invoice_number}`}
                                  disabled={isRowPaying}
                                  aria-busy={isRowPaying}
                                >
                                  {isRowPaying ? "Processing..." : "Make Payment"}
                                </Button>
                              )}
                              <Button size="sm" variant="outline" onClick={() => startInvoiceEdit(inv)} disabled={isRowPaying}>
                                {t("edit")}
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => requestInvoiceDelete(inv.id)} disabled={isRowPaying}>
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

          {invoicesNext ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMoreInvoices} disabled={loading}>
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        open={saveViewOpen}
        onOpenChange={(open) => {
          setSaveViewOpen(open);
          if (!open) {
            setSaveViewName("");
            setSaveViewDefault(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Invoice View</DialogTitle>
            <DialogDescription>Save the current filters for quick access.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="save_view_name">Name</Label>
              <Input id="save_view_name" value={saveViewName} onChange={(e) => setSaveViewName(e.target.value)} placeholder="e.g. Unpaid this month" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={saveViewDefault} onChange={(e) => setSaveViewDefault(e.target.checked)} className="h-4 w-4" />
              Make this my default view
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSaveViewOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void onCreateSavedView()} disabled={loading}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isPickerOpen}
        onOpenChange={(open) => {
          setIsPickerOpen(open);
          if (!open) {
            setPickerLineId(null);
            setItemSearch("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search by name, SKU, description..." />
            <div className="max-h-[50vh] overflow-auto border rounded-md divide-y">
              {filteredInventory.length === 0 ? (
                <div className="p-3 text-sm text-gray-600">No items found.</div>
              ) : (
                filteredInventory.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="w-full text-left p-3 hover:bg-gray-50"
                    onClick={() => {
                      if (pickerLineId === null) return;
                      updateLineItem(pickerLineId, { itemId: i.id });
                      setIsPickerOpen(false);
                      setPickerLineId(null);
                      setItemSearch("");
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {i.name} {i.type === "service" ? "(Service)" : ""}
                        </div>
                        <div className="text-xs text-gray-500">
                          {i.sku ? `SKU: ${i.sku} • ` : ""}Tax {i.tax_rate}% • {i.unit_of_measure}
                        </div>
                      </div>
                      <div className="text-sm font-semibold">{formatMoney(i.unit_price)}</div>
                    </div>
                    {i.description ? <div className="mt-1 text-xs text-gray-500 line-clamp-2">{i.description}</div> : null}
                  </button>
                ))
              )}
            </div>
            {itemsNext ? (
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={loadMoreItems} disabled={loading}>
                  {t("loadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAddItemOpen}
        onOpenChange={(open) => {
          setIsAddItemOpen(open);
          if (!open) {
            setAddItemTargetLineId(null);
            setNewItemError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Item</DialogTitle>
          </DialogHeader>
          {newItemError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{newItemError}</div>
          ) : null}
          <form className="space-y-4" onSubmit={createAndAddItem}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select
                  value={newItem.type}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewItem((p) => ({ ...p, type: v === "service" ? "service" : "product" }));
                  }}
                  disabled={creatingItem}
                >
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </Select>
              </div>
              <div>
                <Label>SKU / Code</Label>
                <Input value={newItem.sku} onChange={(e) => setNewItem((p) => ({ ...p, sku: e.target.value }))} placeholder="Optional" disabled={creatingItem} />
              </div>
            </div>

            <div>
              <Label>Item Name</Label>
              <Input value={newItem.name} onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))} disabled={creatingItem} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Unit Price</Label>
                <Input type="number" min="0" step="0.01" value={newItem.unit_price} onChange={(e) => setNewItem((p) => ({ ...p, unit_price: e.target.value }))} disabled={creatingItem} />
              </div>
              <div>
                <Label>Tax Category</Label>
                <Input value={newItem.tax_category} onChange={(e) => setNewItem((p) => ({ ...p, tax_category: e.target.value }))} disabled={creatingItem} />
              </div>
              <div>
                <Label>Tax Rate (%)</Label>
                <Input type="number" min="0" max="100" step="0.01" value={newItem.tax_rate} onChange={(e) => setNewItem((p) => ({ ...p, tax_rate: e.target.value }))} disabled={creatingItem} />
              </div>
            </div>

            <div>
              <Label>Unit of Measure</Label>
              <Input value={newItem.unit_of_measure} onChange={(e) => setNewItem((p) => ({ ...p, unit_of_measure: e.target.value }))} disabled={creatingItem} />
            </div>

            <div>
              <Label>Description</Label>
              <Input value={newItem.description} onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))} placeholder="Optional" disabled={creatingItem} />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsAddItemOpen(false)} disabled={creatingItem}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingItem}>
                {creatingItem ? "Saving..." : "Save Item"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmInvoiceSaveOpen} onOpenChange={setConfirmInvoiceSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmSaveTitle")}</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">{t("confirmSaveBody")}</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmInvoiceSaveOpen(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={confirmInvoiceSave}>{t("confirm")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmInvoiceDeleteOpen} onOpenChange={setConfirmInvoiceDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">
              {t("confirmDeleteBody")} This will also delete invoice line items and receipts.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmInvoiceDeleteOpen(false)}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" onClick={confirmInvoiceDelete}>
                {t("confirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmInvoiceBulkDeleteOpen} onOpenChange={setConfirmInvoiceBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">{t("confirmDeleteBody")}</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmInvoiceBulkDeleteOpen(false)}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" onClick={confirmInvoiceBulkDelete}>
                {t("confirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={invoiceSummaryOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (invoiceSummaryLoading || invoiceSummaryConfirming || invoiceSummaryCancelling || invoiceSummaryPaying) return;
            if (invoiceSummaryMode === "create") void cancelInvoiceSummary();
            else setInvoiceSummaryOpen(false);
            return;
          }
          setInvoiceSummaryOpen(true);
        }}
      >
        <DialogContent className="max-w-2xl" aria-label="Invoice summary">
          <DialogHeader>
            <DialogTitle>Invoice Summary</DialogTitle>
            <DialogDescription>
              Review invoice details before proceeding.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            {invoiceSummaryError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert" aria-live="polite">
                {invoiceSummaryError}
              </div>
            ) : null}

            {invoiceSummaryLoading ? (
              <div className="text-sm text-gray-700">Saving invoice…</div>
            ) : invoiceSummaryInvoice ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border bg-gray-50 px-3 py-2">
                    <div className="text-xs text-gray-500">Invoice #</div>
                    <div className="font-medium">{invoiceSummaryInvoice.invoice_number}</div>
                  </div>
                  <div className="rounded-md border bg-gray-50 px-3 py-2">
                    <div className="text-xs text-gray-500">Client</div>
                    <div className="font-medium">
                      {customers.find((c) => c.id === invoiceSummaryInvoice.customer)?.name ?? `#${invoiceSummaryInvoice.customer}`}
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Qty</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {invoiceSummaryInvoice.invoice_items.map((li) => {
                        const itemName = itemsById.get(li.item)?.name ?? `Item #${li.item}`;
                        return (
                          <tr key={li.id}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">{itemName}</div>
                              {li.description ? <div className="text-xs text-gray-500">{li.description}</div> : null}
                            </td>
                            <td className="px-4 py-3">{li.quantity}</td>
                            <td className="px-4 py-3">{formatMoney(Number(li.unit_price))}</td>
                            <td className="px-4 py-3 font-medium">{formatMoney(Number(li.line_total))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-medium">{formatMoney(Number(invoiceSummaryInvoice.subtotal))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax</span>
                    <span className="font-medium">{formatMoney(Number(invoiceSummaryInvoice.tax_total))}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total Due</span>
                    <span>{formatMoney(Number(invoiceSummaryInvoice.total_amount))}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void cancelInvoiceSummary()}
                disabled={invoiceSummaryLoading || invoiceSummaryConfirming || invoiceSummaryCancelling || invoiceSummaryPaying}
              >
                {invoiceSummaryMode === "create" ? (invoiceSummaryCancelling ? "Cancelling..." : "Cancel") : "Close"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={openSendInvoice}
                disabled={!invoiceSummaryInvoice || invoiceSummaryLoading || invoiceSummaryConfirming || invoiceSummaryCancelling || invoiceSummaryPaying}
              >
                Send
              </Button>
              {invoiceSummaryMode === "create" ? (
                <>
                  <Button
                    type="button"
                    onClick={() => void confirmInvoiceSummarySave(false)}
                    disabled={!invoiceSummaryInvoice || invoiceSummaryLoading || invoiceSummaryConfirming || invoiceSummaryCancelling || invoiceSummaryPaying}
                  >
                    {invoiceSummaryConfirming ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      if (!invoiceSummaryInvoice) return;
                      try {
                        setInvoiceSummaryPaying(true);
                        await confirmInvoiceSummarySave(true);
                      } finally {
                        setInvoiceSummaryPaying(false);
                      }
                    }}
                    disabled={!invoiceSummaryInvoice || invoiceSummaryLoading || invoiceSummaryConfirming || invoiceSummaryCancelling || invoiceSummaryPaying}
                  >
                    {invoiceSummaryPaying ? "Opening..." : "Make Payment"}
                  </Button>
                </>
              ) : invoiceSummaryInvoice && invoiceSummaryInvoice.status !== "Paid" ? (
                <Button
                  type="button"
                  onClick={() => openPaymentForInvoice(invoiceSummaryInvoice.id)}
                  disabled={invoiceSummaryLoading || invoiceSummaryConfirming || invoiceSummaryCancelling || invoiceSummaryPaying}
                >
                  Make Payment
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make Payment</DialogTitle>
            <DialogDescription>Select a payment method to pay this invoice.</DialogDescription>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)} disabled={paymentProcessing}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card_manual">Card (Manual)</option>
                <option value="card_gateway">Card (Online)</option>
              </Select>
            </div>

            {paymentMode === "cash" || paymentMode === "bank_transfer" || paymentMode === "card_manual" ? (
              <>
                <div>
                  <Label htmlFor="pay_amount">Amount</Label>
                  <Input
                    id="pay_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    disabled={paymentProcessing}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="pay_date">Transaction Date</Label>
                  <Input id="pay_date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} disabled={paymentProcessing} required />
                </div>
              </>
            ) : null}

            {paymentMode === "bank_transfer" ? (
              <div>
                <Label htmlFor="pay_ref">Transfer Reference</Label>
                <Input id="pay_ref" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} disabled={paymentProcessing} required />
              </div>
            ) : null}

            {paymentMode === "card_manual" ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="card_number">Card Number</Label>
                  <Input id="card_number" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} disabled={paymentProcessing} inputMode="numeric" autoComplete="cc-number" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="card_exp_month">Exp Month</Label>
                    <Input id="card_exp_month" value={cardExpMonth} onChange={(e) => setCardExpMonth(e.target.value)} disabled={paymentProcessing} inputMode="numeric" autoComplete="cc-exp-month" />
                  </div>
                  <div>
                    <Label htmlFor="card_exp_year">Exp Year</Label>
                    <Input id="card_exp_year" value={cardExpYear} onChange={(e) => setCardExpYear(e.target.value)} disabled={paymentProcessing} inputMode="numeric" autoComplete="cc-exp-year" />
                  </div>
                  <div>
                    <Label htmlFor="card_cvv">CVV</Label>
                    <Input id="card_cvv" value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} disabled={paymentProcessing} inputMode="numeric" autoComplete="cc-csc" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="card_auth">Authorization Code</Label>
                  <Input id="card_auth" value={cardAuthCode} onChange={(e) => setCardAuthCode(e.target.value)} disabled={paymentProcessing} required />
                </div>
              </div>
            ) : null}

            {paymentMode === "card_gateway" ? (
              <>
                <div>
                  <Label>Gateway</Label>
                  <Select value={paymentProvider} onChange={(e) => setPaymentProvider(e.target.value as PaymentTx["provider"])} disabled={paymentProcessing}>
                    <option value="paystack">Paystack</option>
                    <option value="flutterwave">Flutterwave</option>
                    <option value="opay">OPay</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="pay_email">Customer Email</Label>
                  <Input id="pay_email" value={paymentEmail} onChange={(e) => setPaymentEmail(e.target.value)} disabled={paymentProcessing} required={paymentProvider !== "bank_transfer"} />
                </div>
                <div>
                  <Label htmlFor="pay_phone">Customer Phone</Label>
                  <Input id="pay_phone" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} disabled={paymentProcessing} placeholder="Optional" />
                </div>
              </>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPaymentOpen(false)} disabled={paymentProcessing}>
                Cancel
              </Button>
              {paymentMode === "card_gateway" && lastPaymentTx ? (
                <Button variant="outline" onClick={() => void checkLastPaymentStatus()} disabled={paymentProcessing}>
                  Check Status
                </Button>
              ) : null}
              <Button onClick={() => void startPayment()} disabled={paymentProcessing} aria-busy={paymentProcessing}>
                {paymentProcessing ? "Processing..." : paymentMode === "card_gateway" ? "Open Checkout" : "Record Payment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Invoice</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div>
              <Label htmlFor="send_channel">Channel</Label>
              <Select
                id="send_channel"
                value={sendChannel}
                onChange={(e) => {
                  const next = e.target.value as DeliveryChannel;
                  setSendChannel(next);
                  if (next === "whatsapp") setSendFormat("pdf");
                }}
                disabled={sendingDoc}
              >
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp (opens app/web)</option>
                <option value="print">Print</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="send_format">Format</Label>
              <Select id="send_format" value={sendFormat} onChange={(e) => setSendFormat(e.target.value as DeliveryFormat)} disabled={sendingDoc || sendChannel === "whatsapp"}>
                <option value="pdf">PDF</option>
                <option value="html">HTML</option>
                <option value="text">Text</option>
              </Select>
            </div>
            {sendChannel === "email" ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="send_email">To Email</Label>
                  <span
                    className={`text-xs ${
                      sendEmailAutoFilled ? "text-green-700" : sendToEmail.trim() ? "text-gray-600" : "text-amber-700"
                    }`}
                  >
                    {sendEmailAutoFilled ? "Auto-filled" : sendToEmail.trim() ? "Manual" : "Required"}
                  </span>
                </div>
                <Input
                  id="send_email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={sendToEmail}
                  onChange={(e) => {
                    setSendEmailTouched(true);
                    setSendEmailAutoFilled(false);
                    setSendEmailWarning(null);
                    setSendToEmail(e.target.value);
                  }}
                  disabled={sendingDoc}
                />
                {sendEmailWarning ? <div className="mt-1 text-xs text-amber-700">{sendEmailWarning}</div> : null}
                {sendToEmail.trim() && !isValidEmail(sendToEmail) ? <div className="mt-1 text-xs text-red-700">Invalid email format</div> : null}
              </div>
            ) : null}
            {sendChannel === "whatsapp" ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="send_phone">To Phone</Label>
                  <span
                    className={`text-xs ${
                      sendPhoneAutoFilled ? "text-green-700" : sendToPhone.trim() ? "text-gray-600" : "text-gray-600"
                    }`}
                  >
                    {sendPhoneAutoFilled ? "Auto-filled" : sendToPhone.trim() ? "Manual" : "Optional"}
                  </span>
                </div>
                <Input
                  id="send_phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={sendToPhone}
                  onChange={(e) => {
                    setSendPhoneTouched(true);
                    setSendPhoneAutoFilled(false);
                    setSendPhoneWarning(null);
                    setSendToPhone(e.target.value);
                  }}
                  disabled={sendingDoc}
                  placeholder="Optional (e.g. +2348012345678)"
                />
                <div className="mt-1 text-xs text-gray-600">
                  Clicking Send will open WhatsApp (mobile app or WhatsApp Web) with a pre-filled message and download link. You will send it manually.
                </div>
                {sendPhoneWarning ? <div className="mt-1 text-xs text-amber-700">{sendPhoneWarning}</div> : null}
                {sendToPhone.trim() && !isValidPhone(sendToPhone) ? <div className="mt-1 text-xs text-red-700">Invalid phone format</div> : null}
              </div>
            ) : null}
            {sendChannel === "print" ? (
              <div>
                <Label htmlFor="send_printer">Printer Name</Label>
                <Input id="send_printer" value={sendPrinterName} onChange={(e) => setSendPrinterName(e.target.value)} disabled={sendingDoc} />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sendingDoc}>
                Cancel
              </Button>
              <Button onClick={() => void sendInvoice()} disabled={sendingDoc} aria-busy={sendingDoc}>
                {sendingDoc ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
