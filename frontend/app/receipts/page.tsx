"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { ApiError, apiRequest, downloadWithAuth, getErrorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };
type InvoiceListItem = { id: number; invoice_number: string; total_amount: string; status: string; updated_at: string };
type ReceiptListItem = {
  id: number;
  invoice: number;
  amount_paid: string;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  updated_at: string;
};

type PaymentTx = {
  id: number;
  provider: "bank_transfer" | "opay" | "flutterwave" | "paystack";
  status: string;
  reference: string;
  payment_url: string | null;
};

type DeliveryChannel = "print" | "email" | "whatsapp";
type DeliveryFormat = "pdf" | "html" | "text";

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

function telegramShareUrl(text: string): string {
  const params = new URLSearchParams();
  if (text.trim()) params.set("text", text.trim());
  return `https://t.me/share/url?${params.toString()}`;
}

function mailtoShareUrl(subject: string, body: string): string {
  const params = new URLSearchParams();
  if (subject.trim()) params.set("subject", subject.trim());
  if (body.trim()) params.set("body", body.trim());
  return `mailto:?${params.toString()}`;
}

export default function ReceiptsPage() {
  const { t } = useI18n();
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const money = useMemo(() => new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode || "NGN" }), [currencyCode]);
  const [prefillInvoiceId, setPrefillInvoiceId] = useState<number | null>(null);
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [invoicesNext, setInvoicesNext] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptListItem[]>([]);
  const [receiptsNext, setReceiptsNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState<string | null>(null);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [gatewayProvider, setGatewayProvider] = useState<PaymentTx["provider"]>("paystack");
  const [gatewayEmail, setGatewayEmail] = useState("");
  const [gatewayPhone, setGatewayPhone] = useState("");
  const [gatewayProcessing, setGatewayProcessing] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTargetReceiptId, setSendTargetReceiptId] = useState<number | null>(null);
  const [sendChannel, setSendChannel] = useState<DeliveryChannel>("email");
  const [sendFormat, setSendFormat] = useState<DeliveryFormat>("pdf");
  const [sendToEmail, setSendToEmail] = useState("");
  const [sendToPhone, setSendToPhone] = useState("");
  const [sendPrinterName, setSendPrinterName] = useState("");
  const [sendEmailSubject, setSendEmailSubject] = useState("");
  const [sendEmailMessage, setSendEmailMessage] = useState("");
  const [sendingDoc, setSendingDoc] = useState(false);
  const [sendEmailTouched, setSendEmailTouched] = useState(false);
  const [sendPhoneTouched, setSendPhoneTouched] = useState(false);
  const [sendEmailAutoFilled, setSendEmailAutoFilled] = useState(false);
  const [sendPhoneAutoFilled, setSendPhoneAutoFilled] = useState(false);
  const [sendEmailWarning, setSendEmailWarning] = useState<string | null>(null);
  const [sendPhoneWarning, setSendPhoneWarning] = useState<string | null>(null);
  const [sendCustomerContact, setSendCustomerContact] = useState<{ email: string | null; phone: string | null } | null>(null);
  const [sendAutoFillLoading, setSendAutoFillLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareTargetReceiptId, setShareTargetReceiptId] = useState<number | null>(null);
  const [savingDocumentId, setSavingDocumentId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{
    invoice: string;
    amount_paid: string;
    payment_date: string;
    payment_method: string;
    reference_number: string;
  }>({ invoice: "", amount_paid: "", payment_date: "", payment_method: "Cash", reference_number: "" });
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const [confirmRecordOpen, setConfirmRecordOpen] = useState(false);
  const [pendingRecord, setPendingRecord] = useState<{
    invoiceId: number;
    amount: number;
    payment_date: string;
    payment_method: string;
    reference_number: string | null;
  } | null>(null);
  const [confirmGatewayOpen, setConfirmGatewayOpen] = useState(false);
  const [pendingGateway, setPendingGateway] = useState<{
    invoiceId: number;
    amount: number | null;
    provider: PaymentTx["provider"];
    email: string | null;
    phone: string | null;
  } | null>(null);

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

  const [form, setForm] = useState({
    invoice: "",
    amount_paid: "",
    payment_date: "",
    payment_method: "Cash",
    reference_number: "",
  });

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 403) {
        return e.message || "You do not have permission to save receipt records. Please check your role or contact an administrator.";
      }
      if (e.status === 409) return t("conflict");
    }
    return getErrorMessage(e, fallback);
  }, [t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const open = sp.get("open") === "1";
    const rawId = sp.get("invoice");
    const n = rawId ? Number(rawId) : NaN;
    const id = Number.isFinite(n) && Number.isInteger(n) && n >= 1 ? n : null;
    setPrefillOpen(open);
    setPrefillInvoiceId(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [inv, rec] = await Promise.all([
          apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1"),
          apiRequest<Paginated<ReceiptListItem>>("/receipts/?page=1"),
        ]);
        if (cancelled) return;
        setInvoices(inv.results);
        setInvoicesNext(inv.next);
        setReceipts(rec.results);
        setReceiptsNext(rec.next);
        setSelectedIds({});
        if (prefillOpen && prefillInvoiceId && inv.results.some((x) => x.id === prefillInvoiceId)) {
          const invRow = inv.results.find((x) => x.id === prefillInvoiceId);
          setForm((p) => ({ ...p, invoice: String(prefillInvoiceId), payment_date: p.payment_date || new Date().toISOString().slice(0, 10) }));
          if (invRow) setForm((p) => ({ ...p, amount_paid: invRow.total_amount }));
          setIsAddOpen(true);
        } else if (inv.results.length > 0) {
          setForm((p) => ({ ...p, invoice: String(inv.results[0].id), payment_date: p.payment_date || new Date().toISOString().slice(0, 10) }));
        }
      } catch (e: unknown) {
        if (!cancelled) setError(toUserMessage(e, "Failed to load receipts"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefillInvoiceId, prefillOpen, toUserMessage]);

  const loadMoreReceipts = async () => {
    if (!receiptsNext) return;
    try {
      setLoading(true);
      setError(null);
      const data = await apiRequest<Paginated<ReceiptListItem>>(receiptsNext);
      setReceipts((prev) => [...prev, ...data.results]);
      setReceiptsNext(data.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more receipts"));
    } finally {
      setLoading(false);
    }
  };

  const loadMoreInvoices = async () => {
    if (!invoicesNext) return;
    try {
      setLoading(true);
      setError(null);
      const data = await apiRequest<Paginated<InvoiceListItem>>(invoicesNext);
      setInvoices((prev) => [...prev, ...data.results]);
      setInvoicesNext(data.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more invoices"));
    } finally {
      setLoading(false);
    }
  };

  const requestRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (processingPayment) return;
    setError(null);
    setSuccess(null);
    if (!form.invoice) {
      setError("Please select an invoice");
      return;
    }
    const invoiceId = Number(form.invoice);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      setError("Please select an invoice");
      return;
    }
    const amount = Number(form.amount_paid);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount paid must be a valid number > 0");
      return;
    }
    if (!form.payment_date) {
      setError("Transaction date is required");
      return;
    }
    if ((form.payment_method === "Card" || form.payment_method === "Bank Transfer") && !form.reference_number.trim()) {
      setError("Reference number is required for Card and Bank Transfer payments");
      return;
    }
    if (form.payment_method === "Card") {
      const digits = form.reference_number.replace(/\D/g, "");
      if (digits.length >= 12) {
        setError("Do not store card numbers. Use an authorization/reference code instead.");
        return;
      }
    }
    setPendingRecord({
      invoiceId,
      amount,
      payment_date: form.payment_date,
      payment_method: form.payment_method,
      reference_number: form.reference_number.trim() ? form.reference_number.trim() : null,
    });
    setConfirmRecordOpen(true);
  };

  const confirmRecordPayment = async () => {
    if (!pendingRecord) return;
    if (processingPayment) return;
    try {
      setProcessingPayment(true);
      const idem =
        paymentIdempotencyKey ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      setPaymentIdempotencyKey(idem);
      const created = await apiRequest<ReceiptListItem>(`/invoices/${pendingRecord.invoiceId}/pay/`, {
        method: "POST",
        headers: { "Idempotency-Key": idem },
        body: JSON.stringify({
          amount_paid: pendingRecord.amount,
          payment_date: pendingRecord.payment_date,
          payment_method: pendingRecord.payment_method,
          reference_number: pendingRecord.reference_number,
        }),
      });
      setReceipts((prev) => [created, ...prev]);
      setForm({ invoice: String(pendingRecord.invoiceId), amount_paid: "", payment_date: pendingRecord.payment_date, payment_method: "Cash", reference_number: "" });
      setConfirmRecordOpen(false);
      setPendingRecord(null);
      setIsAddOpen(false);
      setSuccess("Payment processed and receipt generated.");
      setPaymentIdempotencyKey(null);
      const inv = await apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1");
      setInvoices(inv.results);
      setInvoicesNext(inv.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to process payment"));
    } finally {
      setProcessingPayment(false);
    }
  };

  const requestGatewayPayment = () => {
    if (gatewayProcessing) return;
    setError(null);
    setSuccess(null);
    if (!form.invoice) {
      setError("Please select an invoice");
      return;
    }
    const amount = form.amount_paid.trim() ? Number(form.amount_paid) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      setError("Amount must be a valid number > 0");
      return;
    }
    if (gatewayProvider !== "bank_transfer" && !gatewayEmail.trim()) {
      setError("Email is required for online payments");
      return;
    }
    const invoiceId = Number(form.invoice);
    setPendingGateway({
      invoiceId,
      amount: amount === null ? null : amount,
      provider: gatewayProvider,
      email: gatewayEmail.trim() ? gatewayEmail.trim() : null,
      phone: gatewayPhone.trim() ? gatewayPhone.trim() : null,
    });
    setConfirmGatewayOpen(true);
  };

  const confirmGatewayPayment = async () => {
    if (!pendingGateway) return;
    const idem = (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
      setGatewayProcessing(true);
      const tx = await apiRequest<PaymentTx>("/payments/transactions/", {
        method: "POST",
        headers: { "Idempotency-Key": idem },
        body: JSON.stringify({
          provider: pendingGateway.provider,
          invoice: pendingGateway.invoiceId,
          amount: pendingGateway.amount === null ? undefined : pendingGateway.amount,
          currency_code: currencyCode,
          email: pendingGateway.email || undefined,
          phone: pendingGateway.phone || undefined,
          redirect_url: typeof window !== "undefined" ? window.location.origin + "/receipts" : undefined,
          country: "NG",
        }),
      });
      if (!tx.payment_url) {
        if (pendingGateway.provider === "bank_transfer") {
          setSuccess(`Bank transfer initiated. Use reference ${tx.reference} for reconciliation.`);
          setConfirmGatewayOpen(false);
          setPendingGateway(null);
          setGatewayOpen(false);
          return;
        }
        setError("Gateway did not return a payment URL");
        return;
      }
      if (typeof window !== "undefined") window.open(tx.payment_url, "_blank", "noopener,noreferrer");
      setSuccess("Payment checkout opened. The receipt will be generated after confirmation.");
      setConfirmGatewayOpen(false);
      setPendingGateway(null);
      setGatewayOpen(false);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to start online payment"));
    } finally {
      setGatewayProcessing(false);
    }
  };

  const openSendReceipt = (receiptId: number) => {
    setSendTargetReceiptId(receiptId);
    setSendChannel("email");
    setSendFormat("pdf");
    setSendToEmail("");
    setSendToPhone("");
    setSendPrinterName("");
    setSendEmailSubject("Receipt {document_number} from {company_name}");
    setSendEmailMessage(
      "Hello {customer_name},\n\nPlease find your {document_type} attached from {company_name}.\n\nDownload link: {download_url}\n"
    );
    setSendEmailTouched(false);
    setSendPhoneTouched(false);
    setSendEmailAutoFilled(false);
    setSendPhoneAutoFilled(false);
    setSendEmailWarning(null);
    setSendPhoneWarning(null);
    setSendCustomerContact(null);
    setSendOpen(true);
    void (async () => {
      const r = receipts.find((x) => x.id === receiptId);
      if (!r) return;
      setSendAutoFillLoading(true);
      try {
        const inv = await apiRequest<{ customer: number }>(`/invoices/${r.invoice}/`);
        const cust = await apiRequest<{ email: string | null; phone: string | null }>(`/customers/${inv.customer}/`);
        const email = (cust.email ?? "").trim() || null;
        const phone = (cust.phone ?? "").trim() || null;
        setSendCustomerContact({ email, phone });
      } catch {
        setSendCustomerContact(null);
      } finally {
        setSendAutoFillLoading(false);
      }
    })();
  };

  useEffect(() => {
    if (!sendOpen) return;
    if (!sendCustomerContact) return;

    if (sendChannel === "email") {
      const raw = (sendCustomerContact.email ?? "").trim();
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
      const raw = (sendCustomerContact.phone ?? "").trim();
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
  }, [sendChannel, sendCustomerContact, sendEmailTouched, sendOpen, sendPhoneTouched, sendToEmail, sendToPhone]);

  const buildReceiptShareText = (receiptId: number, downloadUrl: string) => {
    const receipt = receipts.find((r) => r.id === receiptId);
    const invoice = receipt ? invoices.find((i) => i.id === receipt.invoice) : null;
    const invoiceNumber = invoice?.invoice_number || (receipt ? `#${receipt.invoice}` : "");
    const amountPaid = receipt ? money.format(Number(receipt.amount_paid)) : "";
    return [`Receipt RCPT-${receiptId}`, invoiceNumber ? `Invoice: ${invoiceNumber}` : "", amountPaid ? `Amount paid: ${amountPaid}` : "", downloadUrl]
      .filter(Boolean)
      .join("\n");
  };

  const openShareReceipt = async (receiptId: number) => {
    if (shareLoading) return;
    setError(null);
    setSuccess(null);
    setShareLoading(true);
    try {
      const share = await apiRequest<{ download_url: string; expires_at?: string | null }>(`/receipts/${receiptId}/share_link/`, {
        method: "POST",
        body: JSON.stringify({ ttl_minutes: 60 * 24 * 7 }),
      });
      setShareTargetReceiptId(receiptId);
      setShareLink(share.download_url);
      setShareExpiresAt(share.expires_at ?? null);
      setShareOpen(true);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to generate share link"));
    } finally {
      setShareLoading(false);
    }
  };

  const shareReceiptVia = async (platform: "copy" | "whatsapp" | "telegram" | "email") => {
    if (!shareLink || !shareTargetReceiptId) return;
    const text = buildReceiptShareText(shareTargetReceiptId, shareLink);
    if (platform === "copy") {
      await navigator.clipboard.writeText(shareLink);
      setSuccess("Share link copied.");
      return;
    }
    const url =
      platform === "whatsapp"
        ? whatsappShareUrl(text, "")
        : platform === "telegram"
          ? telegramShareUrl(text)
          : mailtoShareUrl(`Receipt RCPT-${shareTargetReceiptId}`, text);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      setError("Pop-up blocked. Please allow pop-ups, then try again.");
      return;
    }
    setSuccess(`Opened ${platform === "email" ? "email" : platform} sharing.`);
  };

  const saveReceiptPdf = async (receiptId: number) => {
    if (savingDocumentId === receiptId) return;
    setError(null);
    setSuccess(null);
    setSavingDocumentId(receiptId);
    try {
      const saved = await apiRequest<{ download_url: string }>(
        "/documents/saved/",
        {
          method: "POST",
          body: JSON.stringify({
            document_type: "receipt",
            document_id: receiptId,
            label: `RCPT-${receiptId}`,
          }),
        }
      );
      await downloadWithAuth(saved.download_url, `receipt_${receiptId}.pdf`);
      setSuccess("Receipt saved and backed up.");
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save receipt PDF"));
    } finally {
      setSavingDocumentId(null);
    }
  };

  const sendReceipt = async () => {
    if (sendingDoc) return;
    if (!sendTargetReceiptId) return;
    setError(null);
    setSuccess(null);
    if (sendChannel === "email") {
      const v = sendToEmail.trim();
      if (!v) {
        setError("Email is required");
        return;
      }
      if (!isValidEmail(v)) {
        setError("Invalid email address");
        return;
      }
    }
    if (sendChannel === "whatsapp") {
      const v = sendToPhone.trim();
      if (v && !isValidPhone(v)) {
        setError("Invalid phone number");
        return;
      }
    }
    if (sendChannel === "print") {
      const v = sendPrinterName.trim();
      if (!v) {
        setError("Printer name is required");
        return;
      }
    }
    try {
      setSendingDoc(true);
      if (sendChannel === "whatsapp") {
        const share = await apiRequest<{ download_url: string }>(`/receipts/${sendTargetReceiptId}/share_link/`, {
          method: "POST",
          body: JSON.stringify({ ttl_minutes: 60 * 24 * 7 }),
        });
        const msg = buildReceiptShareText(sendTargetReceiptId, share.download_url);
        const url = whatsappShareUrl(msg, sendToPhone.trim());
        const win = window.open(url, "_blank", "noopener,noreferrer");
        if (!win) {
          setError("Pop-up blocked. Please allow pop-ups, then try again.");
          return;
        }
        setSuccess("Opened WhatsApp for receipt.");
        setSendOpen(false);
        return;
      }

      const res = await apiRequest<{ report?: { ok: boolean; error?: { message?: string | null } | null; retry?: { recommended?: boolean; next_retry_at?: string | null } } }>(
        "/documents/deliveries/",
        {
          method: "POST",
          body: JSON.stringify({
            document_type: "receipt",
            document_id: sendTargetReceiptId,
            channel: sendChannel,
            format: sendFormat,
            to_email: sendChannel === "email" ? sendToEmail.trim() : undefined,
            printer_name: sendChannel === "print" ? sendPrinterName.trim() : undefined,
            email_subject_template: sendChannel === "email" ? sendEmailSubject : undefined,
            email_message_template: sendChannel === "email" ? sendEmailMessage : undefined,
            send_now: true,
          }),
        }
      );
      if (res?.report && res.report.ok === false) {
        const msg = res.report.error?.message || "Delivery failed";
        const retryHint =
          res.report.retry?.recommended && res.report.retry?.next_retry_at ? ` Retry scheduled at ${res.report.retry.next_retry_at}.` : "";
        setError(`${msg}.${retryHint}`.trim());
        return;
      }
      setSuccess("Receipt sent.");
      setSendOpen(false);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to send receipt"));
    } finally {
      setSendingDoc(false);
    }
  };

  const selectedList = Object.entries(selectedIds)
    .filter(([, v]) => v)
    .map(([k]) => Number(k));

  const startEdit = (r: ReceiptListItem) => {
    setError(null);
    setSuccess(null);
    setEditingId(r.id);
    setEditDraft({
      invoice: String(r.invoice),
      amount_paid: r.amount_paid,
      payment_date: r.payment_date,
      payment_method: r.payment_method,
      reference_number: r.reference_number ?? "",
    });
  };

  const requestSave = () => {
    if (editingId === null) return;
    const amount = Number(editDraft.amount_paid);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t("amountPaidInvalid"));
      return;
    }
    setConfirmSaveOpen(true);
  };

  const confirmSave = async () => {
    if (editingId === null) return;
    const current = receipts.find((r) => r.id === editingId);
    if (!current) return;
    const amount = Number(editDraft.amount_paid);
    try {
      setError(null);
      setSuccess(null);
      const updated = await apiRequest<ReceiptListItem>(`/receipts/${editingId}/`, {
        method: "PATCH",
        body: JSON.stringify({
          invoice: Number(editDraft.invoice),
          amount_paid: amount,
          payment_date: editDraft.payment_date,
          payment_method: editDraft.payment_method,
          reference_number: editDraft.reference_number || null,
          updated_at: current.updated_at,
        }),
      });
      setReceipts((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditingId(null);
      setConfirmSaveOpen(false);
      setSuccess(t("saved"));
      const inv = await apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1");
      setInvoices(inv.results);
      setInvoicesNext(inv.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save receipt"));
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
    const current = receipts.find((r) => r.id === pendingDeleteId);
    if (!current) return;
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<void>(`/receipts/${pendingDeleteId}/?updated_at=${encodeURIComponent(current.updated_at)}`, {
        method: "DELETE",
      });
      setReceipts((prev) => prev.filter((r) => r.id !== pendingDeleteId));
      setSelectedIds((prev) => {
        const next = { ...prev };
        delete next[pendingDeleteId];
        return next;
      });
      setConfirmDeleteOpen(false);
      setPendingDeleteId(null);
      setSuccess(t("deleted"));
      const inv = await apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1");
      setInvoices(inv.results);
      setInvoicesNext(inv.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to delete receipt"));
      setConfirmDeleteOpen(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (selectedList.length === 0) return;
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<{ deleted: number }>("/receipts/bulk_delete/", {
        method: "POST",
        body: JSON.stringify({ ids: selectedList }),
      });
      setReceipts((prev) => prev.filter((r) => !selectedIds[r.id]));
      setSelectedIds({});
      setConfirmBulkDeleteOpen(false);
      setSuccess(t("deleted"));
      const inv = await apiRequest<Paginated<InvoiceListItem>>("/invoices/?page=1");
      setInvoices(inv.results);
      setInvoicesNext(inv.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to bulk delete receipts"));
      setConfirmBulkDeleteOpen(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Receipts</h1>
          <Button
            onClick={() => {
              setForm((p) => ({ ...p, payment_date: p.payment_date || new Date().toISOString().slice(0, 10) }));
              setIsAddOpen(true);
            }}
            disabled={loading || invoices.length === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Record Payment
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
          <Button
            variant="destructive"
            disabled={selectedList.length === 0}
            onClick={() => setConfirmBulkDeleteOpen(true)}
          >
            {t("deleteSelected")} ({selectedList.length})
          </Button>
        </div>

        <div className="border rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={receipts.length > 0 && selectedList.length === receipts.length}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const next: Record<number, boolean> = {};
                      for (const r of receipts) next[r.id] = checked;
                      setSelectedIds(next);
                    }}
                  />
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={7}>
                    Loading...
                  </td>
                </tr>
              ) : receipts.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={7}>
                    No receipts yet.
                  </td>
                </tr>
              ) : (
                receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={!!selectedIds[r.id]}
                        onChange={(e) => setSelectedIds((p) => ({ ...p, [r.id]: e.target.checked }))}
                      />
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {editingId === r.id ? (
                        <Select value={editDraft.invoice} onChange={(e) => setEditDraft((p) => ({ ...p, invoice: e.target.value }))}>
                          {invoices.map((inv) => (
                            <option key={inv.id} value={String(inv.id)}>
                              {inv.invoice_number} ({money.format(Number(inv.total_amount))}) - {inv.status}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        `#${r.invoice}`
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {editingId === r.id ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editDraft.amount_paid}
                          onChange={(e) => setEditDraft((p) => ({ ...p, amount_paid: e.target.value }))}
                        />
                      ) : (
                        money.format(Number(r.amount_paid))
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {editingId === r.id ? (
                        <Input
                          type="date"
                          value={editDraft.payment_date}
                          onChange={(e) => setEditDraft((p) => ({ ...p, payment_date: e.target.value }))}
                        />
                      ) : (
                        r.payment_date
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {editingId === r.id ? (
                        <Select
                          value={editDraft.payment_method}
                          onChange={(e) => setEditDraft((p) => ({ ...p, payment_method: e.target.value }))}
                        >
                          <option value="Cash">Cash</option>
                          <option value="Card">Card</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                        </Select>
                      ) : (
                        r.payment_method
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {editingId === r.id ? (
                        <Input
                          value={editDraft.reference_number}
                          onChange={(e) => setEditDraft((p) => ({ ...p, reference_number: e.target.value }))}
                        />
                      ) : (
                        r.reference_number || "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {editingId === r.id ? (
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
                          <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
                            {t("edit")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openSendReceipt(r.id)}>
                            Send
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void openShareReceipt(r.id)} disabled={shareLoading}>
                            Share
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void saveReceiptPdf(r.id)} disabled={savingDocumentId === r.id}>
                            {savingDocumentId === r.id ? "Saving PDF..." : "Save PDF"}
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => requestDelete(r.id)}>
                            {t("delete")}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {receiptsNext ? (
          <div className="flex justify-center">
            <Button variant="outline" onClick={loadMoreReceipts} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={requestRecordPayment} className="p-6 pt-0 space-y-4">
            <div>
              <Label htmlFor="invoice_select">Invoice</Label>
              <Select id="invoice_select" value={form.invoice} onChange={(e) => setForm((p) => ({ ...p, invoice: e.target.value }))} disabled={processingPayment}>
                {invoices.map((inv) => (
                  <option key={inv.id} value={String(inv.id)}>
                    {inv.invoice_number} ({money.format(Number(inv.total_amount))}) - {inv.status}
                  </option>
                ))}
              </Select>
              {invoicesNext ? (
                <div className="mt-2">
                  <Button type="button" variant="outline" size="sm" onClick={loadMoreInvoices} disabled={loading || processingPayment}>
                    {t("loadMore")}
                  </Button>
                </div>
              ) : null}
            </div>
            <div>
              <Label htmlFor="amount_paid">Amount Paid</Label>
              <Input
                id="amount_paid"
                type="number"
                min="0"
                step="0.01"
                value={form.amount_paid}
                onChange={(e) => setForm((p) => ({ ...p, amount_paid: e.target.value }))}
                required
                disabled={processingPayment}
              />
            </div>
            <div>
              <Label htmlFor="payment_date">Transaction Date</Label>
              <Input
                id="payment_date"
                type="date"
                value={form.payment_date}
                onChange={(e) => setForm((p) => ({ ...p, payment_date: e.target.value }))}
                required
                disabled={processingPayment}
              />
            </div>
            <div>
              <Label htmlFor="payment_method">Payment Method</Label>
              <Select
                id="payment_method"
                value={form.payment_method}
                onChange={(e) => setForm((p) => ({ ...p, payment_method: e.target.value }))}
                disabled={processingPayment}
              >
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="reference_number">Reference Number</Label>
              <Input
                id="reference_number"
                value={form.reference_number}
                onChange={(e) => setForm((p) => ({ ...p, reference_number: e.target.value }))}
                disabled={processingPayment}
                required={form.payment_method === "Card" || form.payment_method === "Bank Transfer"}
              />
              {form.payment_method === "Cash" ? <div className="mt-1 text-xs text-gray-500">Optional for cash payments.</div> : null}
              {form.payment_method === "Card" ? <div className="mt-1 text-xs text-gray-500">Use an authorization/reference code, not a full card number.</div> : null}
            </div>
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setGatewayOpen(true)} disabled={processingPayment}>
                Pay Online
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)} disabled={processingPayment}>
                Cancel
              </Button>
              <Button type="submit" disabled={processingPayment} aria-busy={processingPayment}>
                {processingPayment ? "Processing..." : "Process Payment"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={gatewayOpen} onOpenChange={setGatewayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay Online</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div>
              <Label htmlFor="gateway_provider">Gateway</Label>
              <Select id="gateway_provider" value={gatewayProvider} onChange={(e) => setGatewayProvider(e.target.value as PaymentTx["provider"])} disabled={gatewayProcessing}>
                <option value="paystack">Paystack</option>
                <option value="flutterwave">Flutterwave</option>
                <option value="opay">OPay</option>
                <option value="bank_transfer">Bank Transfer</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="gw_email">Customer Email</Label>
              <Input id="gw_email" value={gatewayEmail} onChange={(e) => setGatewayEmail(e.target.value)} disabled={gatewayProcessing} />
            </div>
            <div>
              <Label htmlFor="gw_phone">Customer Phone</Label>
              <Input id="gw_phone" value={gatewayPhone} onChange={(e) => setGatewayPhone(e.target.value)} disabled={gatewayProcessing} placeholder="Optional" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGatewayOpen(false)} disabled={gatewayProcessing}>
                Cancel
              </Button>
              <Button onClick={() => void requestGatewayPayment()} disabled={gatewayProcessing} aria-busy={gatewayProcessing}>
                {gatewayProcessing ? "Starting..." : "Open Checkout"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Receipt</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            {sendAutoFillLoading ? <div className="text-xs text-gray-600">Loading customer contact details…</div> : null}
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
              <div className="space-y-4">
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
                <div>
                  <Label htmlFor="send_email_subject">Subject Template</Label>
                  <Input id="send_email_subject" value={sendEmailSubject} onChange={(e) => setSendEmailSubject(e.target.value)} disabled={sendingDoc} />
                </div>
                <div>
                  <Label htmlFor="send_email_message">Message Template</Label>
                  <textarea
                    id="send_email_message"
                    value={sendEmailMessage}
                    onChange={(e) => setSendEmailMessage(e.target.value)}
                    disabled={sendingDoc}
                    className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <div className="mt-1 text-xs text-gray-600">
                    Available placeholders: {"{customer_name}"}, {"{document_number}"}, {"{company_name}"}, {"{download_url}"}
                  </div>
                </div>
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
              <Button onClick={() => void sendReceipt()} disabled={sendingDoc} aria-busy={sendingDoc}>
                {sendingDoc ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Receipt</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div>
              <Label htmlFor="share_receipt_link">Secure Link</Label>
              <Input id="share_receipt_link" value={shareLink} readOnly />
              <div className="mt-1 text-xs text-gray-600">
                {shareExpiresAt ? `Expires ${new Date(shareExpiresAt).toLocaleString()}.` : "Secure, time-limited access link."}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button variant="outline" onClick={() => void shareReceiptVia("copy")} disabled={!shareLink}>
                Copy Link
              </Button>
              <Button variant="outline" onClick={() => void shareReceiptVia("whatsapp")} disabled={!shareLink}>
                WhatsApp
              </Button>
              <Button variant="outline" onClick={() => void shareReceiptVia("telegram")} disabled={!shareLink}>
                Telegram
              </Button>
              <Button variant="outline" onClick={() => void shareReceiptVia("email")} disabled={!shareLink}>
                Email
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmRecordOpen}
        onOpenChange={(open) => {
          if (processingPayment) return;
          setConfirmRecordOpen(open);
          if (!open) setPendingRecord(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">
              {pendingRecord ? (
                <div className="space-y-1">
                  <div>
                    Invoice: {invoices.find((i) => i.id === pendingRecord.invoiceId)?.invoice_number ?? `#${pendingRecord.invoiceId}`}
                  </div>
                  <div>Amount: {money.format(pendingRecord.amount)}</div>
                  <div>Date: {pendingRecord.payment_date}</div>
                  <div>Method: {pendingRecord.payment_method}</div>
                  {pendingRecord.reference_number ? <div>Reference: {pendingRecord.reference_number}</div> : null}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmRecordOpen(false)} disabled={processingPayment}>
                Cancel
              </Button>
              <Button onClick={() => void confirmRecordPayment()} disabled={processingPayment} aria-busy={processingPayment}>
                {processingPayment ? "Processing..." : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmGatewayOpen}
        onOpenChange={(open) => {
          if (gatewayProcessing) return;
          setConfirmGatewayOpen(open);
          if (!open) setPendingGateway(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Online Payment</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div className="text-sm text-gray-700">
              {pendingGateway ? (
                <div className="space-y-1">
                  <div>
                    Invoice: {invoices.find((i) => i.id === pendingGateway.invoiceId)?.invoice_number ?? `#${pendingGateway.invoiceId}`}
                  </div>
                  {pendingGateway.amount !== null ? <div>Amount: {money.format(pendingGateway.amount)}</div> : <div>Amount: Full outstanding</div>}
                  <div>Provider: {pendingGateway.provider}</div>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmGatewayOpen(false)} disabled={gatewayProcessing}>
                Cancel
              </Button>
              <Button onClick={() => void confirmGatewayPayment()} disabled={gatewayProcessing} aria-busy={gatewayProcessing}>
                {gatewayProcessing ? "Starting..." : "Confirm"}
              </Button>
            </div>
          </div>
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
