"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminSettingsModule } from "@/components/AdminSettingsModule";
import { LogoUploadField } from "@/components/LogoUploadField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { apiRequest, getAuthUser, getErrorMessage, hasAdminSettingsAccess, resolveMediaUrl } from "@/lib/api";
import { uploadLogoFile, validateLogoFile, type LogoUploadScope } from "../../lib/logoUpload";

type Currency = {
  id: number;
  code: string;
  name: string;
  symbol: string | null;
  decimal_places: number;
};

type UserSettings = {
  id: number;
  country: string | null;
  currency: number | null;
  currency_code?: string;
  language: string;
  date_format: string;
  number_format: string;
  notifications: Record<string, unknown>;
  invoice_template: Record<string, unknown>;
  receipt_template: Record<string, unknown>;
  updated_at: string;
};

type EffectiveSettingsResponse = {
  effective: {
    country: string | null;
    language: string;
    date_format: string;
    number_format: string;
    currency_code: string;
    currency: { code: string; symbol: string | null; decimal_places: number } | null;
    templates: {
      global_appearance: Record<string, unknown>;
      invoice_template: Record<string, unknown>;
      receipt_template: Record<string, unknown>;
    };
  };
  global: Record<string, unknown>;
  user: UserSettings | null;
};

type SocialConnection = {
  provider: string;
  label: string;
  connected: boolean;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  linked_at: string | null;
  last_login_at: string | null;
};

type UserLogoScope = Extract<LogoUploadScope, "invoice_template" | "receipt_template">;
const EMPTY_UPLOAD_FLAGS: Record<UserLogoScope, boolean> = {
  invoice_template: false,
  receipt_template: false,
};
const EMPTY_UPLOAD_PROGRESS: Record<UserLogoScope, number> = {
  invoice_template: 0,
  receipt_template: 0,
};
const EMPTY_UPLOAD_ERRORS: Record<UserLogoScope, string | null> = {
  invoice_template: null,
  receipt_template: null,
};
const EMPTY_UPLOAD_PREVIEWS: Record<UserLogoScope, string> = {
  invoice_template: "",
  receipt_template: "",
};

function localeFor(language: string, country: string | null) {
  const lang = (language || "en").toLowerCase();
  const cc = (country || "").toUpperCase();
  if (cc) return `${lang}-${cc}`;
  return lang;
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="space-y-6">
            <div className="text-sm text-gray-600">Loading…</div>
          </div>
        </DashboardLayout>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const authUser = getAuthUser();
  const isAdmin = hasAdminSettingsAccess(authUser);
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>([]);

  const [form, setForm] = useState<UserSettings | null>(null);
  const [globalAppearance, setGlobalAppearance] = useState<Record<string, unknown>>({});
  const [logoUploading, setLogoUploading] = useState<Record<UserLogoScope, boolean>>(EMPTY_UPLOAD_FLAGS);
  const [logoProgress, setLogoProgress] = useState<Record<UserLogoScope, number>>(EMPTY_UPLOAD_PROGRESS);
  const [logoErrors, setLogoErrors] = useState<Record<UserLogoScope, string | null>>(EMPTY_UPLOAD_ERRORS);
  const [logoPreviews, setLogoPreviews] = useState<Record<UserLogoScope, string>>(EMPTY_UPLOAD_PREVIEWS);

  const load = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const [effective, currencyList, social] = await Promise.all([
        apiRequest<EffectiveSettingsResponse>("/settings/effective/"),
        apiRequest<Currency[]>("/currencies/"),
        apiRequest<{ results: SocialConnection[] }>("/auth/social/connections/"),
      ]);
      setCurrencies(currencyList);
      setSocialConnections(social.results);
      setGlobalAppearance(effective.effective.templates.global_appearance || {});
      if (!effective.user) {
        setForm(null);
        return;
      }
      setForm(effective.user);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to load settings"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      Object.values(logoPreviews).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, [logoPreviews]);

  useEffect(() => {
    const linkedProvider = (searchParams.get("socialLinked") || "").trim();
    if (!linkedProvider) return;
    const label = linkedProvider.charAt(0).toUpperCase() + linkedProvider.slice(1);
    setSuccess(`${label} account linked successfully.`);
  }, [searchParams]);

  const currencyOptions = useMemo(() => currencies.slice().sort((a, b) => a.code.localeCompare(b.code)), [currencies]);

  const selectedCurrencyCode = useMemo(() => {
    if (!form) return "";
    const match = currencies.find((c) => c.id === form.currency);
    return match?.code ?? "";
  }, [currencies, form]);

  const locale = useMemo(() => localeFor(form?.language ?? "en", form?.country ?? null), [form?.country, form?.language]);

  const previewInvoice = useMemo(() => {
    const invoiceTemplate = (form?.invoice_template ?? {}) as Record<string, unknown>;
    const primary = (invoiceTemplate.primary_color as string) || (globalAppearance.primary_color as string) || "#1a4d8e";
    const font = (invoiceTemplate.font_family as string) || (globalAppearance.font_family as string) || "Helvetica";
    const logoUrlRaw = (invoiceTemplate.logo_url as string) || (globalAppearance.logo_url as string) || "";
    const logoUrl = resolveMediaUrl(logoUrlRaw);
    const showDesc = Boolean(invoiceTemplate.show_item_description);
    const footerText = (invoiceTemplate.footer_text as string) || (globalAppearance.invoice_footer_text as string) || "Thank you for your business!";
    const companyName = (globalAppearance.company_name as string) || authUser?.company_name || "PXL-HUB INVOICE";
    const companyTagline = (globalAppearance.company_tagline as string) || "";
    const currencyCode = selectedCurrencyCode || "USD";
    const nf = new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode });
    const df = new Intl.DateTimeFormat(locale);
    const today = new Date();
    const items = [
      { name: "Service A", description: "Consulting", qty: 1, unit: 250, total: 250 },
      { name: "Product B", description: "Hardware", qty: 2, unit: 75, total: 150 },
    ];
    const subtotal = 400;
    const tax = 0;
    const total = 400;
    return { primary, font, logoUrl, showDesc, footerText, companyName, companyTagline, nf, df, today, items, subtotal, tax, total };
  }, [authUser?.company_name, form?.invoice_template, globalAppearance, locale, selectedCurrencyCode]);

  const previewReceipt = useMemo(() => {
    const receiptTemplate = (form?.receipt_template ?? {}) as Record<string, unknown>;
    const primary = (receiptTemplate.primary_color as string) || (globalAppearance.primary_color as string) || "#1a4d8e";
    const font = (receiptTemplate.font_family as string) || (globalAppearance.font_family as string) || "Helvetica";
    const logoUrlRaw = (receiptTemplate.logo_url as string) || (globalAppearance.logo_url as string) || "";
    const logoUrl = resolveMediaUrl(logoUrlRaw);
    const showItems = receiptTemplate.show_items !== false;
    const showDesc = Boolean(receiptTemplate.show_item_description);
    const companyName = (globalAppearance.company_name as string) || authUser?.company_name || "PXL-HUB INVOICE";
    const companyTagline = (globalAppearance.company_tagline as string) || "";
    const titleText = (receiptTemplate.header_text as string) || "Receipt";
    const footerText = (receiptTemplate.footer_text as string) || (globalAppearance.receipt_footer_text as string) || "Thank you!";
    const currencyCode = selectedCurrencyCode || "USD";
    const nf = new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode });
    const df = new Intl.DateTimeFormat(locale);
    const today = new Date();
    const items = [
      { name: "Service A", description: "Consulting", qty: 1, unit: 250, total: 250 },
      { name: "Product B", description: "Hardware", qty: 2, unit: 75, total: 150 },
    ];
    const paid = 400;
    return { primary, font, logoUrl, showItems, showDesc, companyName, companyTagline, titleText, footerText, nf, df, today, items, paid };
  }, [authUser?.company_name, form?.receipt_template, globalAppearance, locale, selectedCurrencyCode]);

  const setScopedPreview = useCallback((scope: UserLogoScope, nextUrl: string) => {
    setLogoPreviews((prev) => {
      const current = prev[scope];
      if (current && current.startsWith("blob:") && current !== nextUrl) URL.revokeObjectURL(current);
      return { ...prev, [scope]: nextUrl };
    });
  }, []);

  const onPickTemplateLogo = useCallback(
    async (scope: UserLogoScope, files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const validationError = validateLogoFile(file);
      setLogoErrors((prev) => ({ ...prev, [scope]: validationError }));
      if (validationError) return;

      setScopedPreview(scope, URL.createObjectURL(file));
      setLogoUploading((prev) => ({ ...prev, [scope]: true }));
      setLogoProgress((prev) => ({ ...prev, [scope]: 0 }));

      try {
        const data = await uploadLogoFile({
          endpointPath: "/settings/logo/upload/",
          file,
          scope,
          onProgress: (progress) => {
            setLogoProgress((prev) => ({ ...prev, [scope]: progress }));
          },
        });
        const previewUrl = resolveMediaUrl(data.logo_thumbnail_url ?? data.thumbnail_url ?? data.logo_url);
        setScopedPreview(scope, previewUrl);
        setForm((prev) => {
          if (!prev) return prev;
          const fieldName = scope === "invoice_template" ? "invoice_template" : "receipt_template";
          return {
            ...prev,
            [fieldName]: {
              ...(prev[fieldName] || {}),
              logo_url: data.logo_url,
              logo_thumbnail_url: data.logo_thumbnail_url ?? data.thumbnail_url,
            },
          };
        });
      } catch (e: unknown) {
        setLogoErrors((prev) => ({ ...prev, [scope]: getErrorMessage(e, "Logo upload failed") }));
      } finally {
        setLogoUploading((prev) => ({ ...prev, [scope]: false }));
      }
    },
    [setScopedPreview]
  );

  const onSave = async () => {
    if (!form) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await apiRequest<UserSettings>("/settings/me/", {
        method: "PATCH",
        body: JSON.stringify({
          country: form.country,
          currency: form.currency,
          language: form.language,
          date_format: form.date_format,
          number_format: form.number_format,
          notifications: form.notifications,
          invoice_template: form.invoice_template,
          receipt_template: form.receipt_template,
        }),
      });
      setConfirmOpen(false);
      await load();
      setSuccess("Settings updated.");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to save settings"));
    } finally {
      setSaving(false);
    }
  };

  const startSocialLink = (provider: "google" | "facebook") => {
    setError(null);
    setSuccess(null);
    window.location.assign(
      `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api"}/auth/${provider}/start/?intent=link&remember=1`
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-600 mt-1">Personal preferences and invoice/receipt customization.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={!form || loading} onClick={() => load()}>
              Refresh
            </Button>
            <Button type="button" disabled={!form || loading} onClick={() => setConfirmOpen(true)}>
              Save Changes
            </Button>
          </div>
        </div>

        {success ? <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">{success}</div> : null}
        {error ? <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div> : null}

        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : !form ? (
          <div className="text-sm text-gray-600">Unable to load user settings.</div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                <Card>
                <CardHeader>
                  <CardTitle>Connected Accounts</CardTitle>
                  <CardDescription>Link Google or Facebook so you can sign in with either provider on the same profile.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {socialConnections.map((connection) => (
                    <div key={connection.provider} className="flex items-center justify-between gap-4 rounded-md border border-gray-200 px-4 py-3">
                      <div>
                        <div className="font-medium text-gray-900">{connection.label}</div>
                        <div className="text-sm text-gray-600">
                          {connection.connected
                            ? connection.email || connection.display_name || "Connected"
                            : "Not connected"}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant={connection.connected ? "outline" : "default"}
                        onClick={() => startSocialLink(connection.provider as "google" | "facebook")}
                      >
                        {connection.connected ? "Reconnect" : "Connect"}
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

                <Card>
                <CardHeader>
                  <CardTitle>Preferences</CardTitle>
                  <CardDescription>Language, formats, and notifications.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="country">Country</Label>
                      <Select
                        id="country"
                        value={form.country ?? ""}
                        onChange={(e) => setForm({ ...form, country: e.target.value || null })}
                      >
                        <option value="">Auto-detect</option>
                        <option value="US">United States</option>
                        <option value="GB">United Kingdom</option>
                        <option value="DE">Germany</option>
                        <option value="FR">France</option>
                        <option value="JP">Japan</option>
                        <option value="CA">Canada</option>
                        <option value="AU">Australia</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="currency">Currency</Label>
                      <Select
                        id="currency"
                        value={form.currency ?? ""}
                        onChange={(e) => setForm({ ...form, currency: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Default</option>
                        {currencyOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} {c.symbol ? `(${c.symbol})` : ""}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="language">Language</Label>
                      <Select id="language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                        <option value="en">English</option>
                        <option value="es">Español</option>
                        <option value="fr">Français</option>
                        <option value="de">Deutsch</option>
                        <option value="ja">日本語</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="date_format">Date Format</Label>
                      <Select
                        id="date_format"
                        value={form.date_format}
                        onChange={(e) => setForm({ ...form, date_format: e.target.value })}
                      >
                        <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                        <option value="DD.MM.YYYY">DD.MM.YYYY</option>
                        <option value="YYYY/MM/DD">YYYY/MM/DD</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="number_format">Number Format</Label>
                      <Select
                        id="number_format"
                        value={form.number_format}
                        onChange={(e) => setForm({ ...form, number_format: e.target.value })}
                      >
                        <option value="1,234.56">1,234.56</option>
                        <option value="1.234,56">1.234,56</option>
                        <option value="1 234,56">1 234,56</option>
                        <option value="1,234">1,234</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="notif_email">Notifications</Label>
                      <div className="mt-2 space-y-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            id="notif_email"
                            type="checkbox"
                            className="h-4 w-4"
                            checked={Boolean((form.notifications as Record<string, unknown>).email)}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                notifications: { ...(form.notifications || {}), email: e.target.checked },
                              })
                            }
                          />
                          Email
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={Boolean((form.notifications as Record<string, unknown>).in_app)}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                notifications: { ...(form.notifications || {}), in_app: e.target.checked },
                              })
                            }
                          />
                          In-app
                        </label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

                <Card>
                <CardHeader>
                  <CardTitle>Invoice Template</CardTitle>
                  <CardDescription>Logo, colors, and layout options.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <LogoUploadField
                      id="inv_logo_upload"
                      label="Invoice Logo"
                      helpText="Upload a JPG, PNG, SVG, or WebP logo up to 5MB for invoice documents."
                      previewUrl={
                        logoPreviews.invoice_template ||
                        resolveMediaUrl(
                          String(
                            (form.invoice_template as Record<string, unknown>).logo_thumbnail_url ??
                              (form.invoice_template as Record<string, unknown>).logo_url ??
                              ""
                          )
                        )
                      }
                      previewAlt="Invoice logo preview"
                      error={logoErrors.invoice_template}
                      uploading={logoUploading.invoice_template}
                      progress={logoProgress.invoice_template}
                      onFilesSelected={(files) => onPickTemplateLogo("invoice_template", files)}
                    />
                    <div>
                      <Label htmlFor="inv_primary">Primary Color</Label>
                      <div className="flex gap-2">
                        <Input
                          id="inv_primary"
                          type="color"
                          value={String((form.invoice_template as Record<string, unknown>).primary_color ?? "#1a4d8e")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              invoice_template: { ...(form.invoice_template || {}), primary_color: e.target.value },
                            })
                          }
                          aria-label="Primary color"
                        />
                        <Input
                          value={String((form.invoice_template as Record<string, unknown>).primary_color ?? "#1a4d8e")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              invoice_template: { ...(form.invoice_template || {}), primary_color: e.target.value },
                            })
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="inv_font">Font</Label>
                      <Select
                        id="inv_font"
                        value={String((form.invoice_template as Record<string, unknown>).font_family ?? "Helvetica")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            invoice_template: { ...(form.invoice_template || {}), font_family: e.target.value },
                          })
                        }
                      >
                        <option value="Helvetica">Helvetica</option>
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Courier New">Courier New</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="inv_layout">Layout</Label>
                      <Select
                        id="inv_layout"
                        value={String((form.invoice_template as Record<string, unknown>).layout ?? "classic")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            invoice_template: { ...(form.invoice_template || {}), layout: e.target.value },
                          })
                        }
                      >
                        <option value="classic">Classic</option>
                        <option value="compact">Compact</option>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={Boolean((form.invoice_template as Record<string, unknown>).show_item_description)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            invoice_template: { ...(form.invoice_template || {}), show_item_description: e.target.checked },
                          })
                        }
                      />
                      Show item descriptions
                    </label>
                    <Label htmlFor="inv_footer">Invoice Footer Text</Label>
                    <Input
                      id="inv_footer"
                      value={String((form.invoice_template as Record<string, unknown>).footer_text ?? "")}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          invoice_template: { ...(form.invoice_template || {}), footer_text: e.target.value },
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Receipt Template</CardTitle>
                  <CardDescription>Header/footer text, numbering, and item display.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="rcpt_header">Header Text</Label>
                      <Input
                        id="rcpt_header"
                        value={String((form.receipt_template as Record<string, unknown>).header_text ?? "")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            receipt_template: { ...(form.receipt_template || {}), header_text: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="rcpt_footer">Receipt Footer Text</Label>
                      <Input
                        id="rcpt_footer"
                        value={String((form.receipt_template as Record<string, unknown>).footer_text ?? "")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            receipt_template: { ...(form.receipt_template || {}), footer_text: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="rcpt_numbering">Numbering Format</Label>
                      <Input
                        id="rcpt_numbering"
                        value={String((form.receipt_template as Record<string, unknown>).numbering_format ?? "RCPT-{id}")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            receipt_template: { ...(form.receipt_template || {}), numbering_format: e.target.value },
                          })
                        }
                      />
                      <div className="text-xs text-gray-500 mt-1">Use {"{id}"} or {"{invoice_number}"} placeholders.</div>
                    </div>
                    <LogoUploadField
                      id="rcpt_logo_upload"
                      label="Receipt Logo"
                      helpText="Upload a JPG, PNG, SVG, or WebP logo up to 5MB for receipt documents."
                      previewUrl={
                        logoPreviews.receipt_template ||
                        resolveMediaUrl(
                          String(
                            (form.receipt_template as Record<string, unknown>).logo_thumbnail_url ??
                              (form.receipt_template as Record<string, unknown>).logo_url ??
                              ""
                          )
                        )
                      }
                      previewAlt="Receipt logo preview"
                      error={logoErrors.receipt_template}
                      uploading={logoUploading.receipt_template}
                      progress={logoProgress.receipt_template}
                      onFilesSelected={(files) => onPickTemplateLogo("receipt_template", files)}
                    />
                    <div>
                      <Label htmlFor="rcpt_primary">Primary Color</Label>
                      <div className="flex gap-2">
                        <Input
                          id="rcpt_primary"
                          type="color"
                          value={String((form.receipt_template as Record<string, unknown>).primary_color ?? "#1a4d8e")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              receipt_template: { ...(form.receipt_template || {}), primary_color: e.target.value },
                            })
                          }
                          aria-label="Primary color"
                        />
                        <Input
                          value={String((form.receipt_template as Record<string, unknown>).primary_color ?? "#1a4d8e")}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              receipt_template: { ...(form.receipt_template || {}), primary_color: e.target.value },
                            })
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="rcpt_font">Font</Label>
                      <Select
                        id="rcpt_font"
                        value={String((form.receipt_template as Record<string, unknown>).font_family ?? "Helvetica")}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            receipt_template: { ...(form.receipt_template || {}), font_family: e.target.value },
                          })
                        }
                      >
                        <option value="Helvetica">Helvetica</option>
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Courier New">Courier New</option>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={(form.receipt_template as Record<string, unknown>).show_items !== false}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            receipt_template: { ...(form.receipt_template || {}), show_items: e.target.checked },
                          })
                        }
                      />
                      Show items
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={Boolean((form.receipt_template as Record<string, unknown>).show_item_description)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            receipt_template: { ...(form.receipt_template || {}), show_item_description: e.target.checked },
                          })
                        }
                      />
                      Show item descriptions
                    </label>
                  </div>
                </CardContent>
              </Card>
              </div>

              <div className="space-y-6">
                <Card>
                <CardHeader>
                  <CardTitle>Invoice Preview</CardTitle>
                  <CardDescription>Updates as you change template settings.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className="border rounded-lg p-4 bg-white"
                    style={{ fontFamily: previewInvoice.font, borderColor: "#e5e7eb" }}
                    aria-label="Invoice preview"
                  >
                    <div className="flex items-start justify-between gap-4 border-b pb-3">
                      <div>
                        {previewInvoice.logoUrl ? (
                          <img src={previewInvoice.logoUrl} alt="Invoice logo" className="h-10 w-auto mb-2" />
                        ) : null}
                        <div className="text-xl font-bold" style={{ color: previewInvoice.primary }}>
                          {previewInvoice.companyName}
                        </div>
                        <div className="text-xs text-gray-600">{previewInvoice.companyTagline}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold" style={{ color: previewInvoice.primary }}>
                          INVOICE
                        </div>
                        <div className="text-sm text-gray-700">#INV-0001</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="font-semibold" style={{ color: previewInvoice.primary }}>
                          Bill To
                        </div>
                        <div>Sample Customer</div>
                        <div className="text-gray-600">customer@example.com</div>
                      </div>
                      <div className="text-right">
                        <div>
                          <span className="font-semibold">Issue Date:</span> {previewInvoice.df.format(previewInvoice.today)}
                        </div>
                        <div>
                          <span className="font-semibold">Status:</span> Draft
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left bg-gray-50">
                            <th className="p-2">Item</th>
                            <th className="p-2 text-center">Qty</th>
                            <th className="p-2 text-right">Unit</th>
                            <th className="p-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewInvoice.items.map((it) => (
                            <tr key={it.name} className="border-b">
                              <td className="p-2">
                                <div>{it.name}</div>
                                {previewInvoice.showDesc ? <div className="text-xs text-gray-600">{it.description}</div> : null}
                              </td>
                              <td className="p-2 text-center">{it.qty}</td>
                              <td className="p-2 text-right">{previewInvoice.nf.format(it.unit)}</td>
                              <td className="p-2 text-right">{previewInvoice.nf.format(it.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 ml-auto w-64 text-sm">
                      <div className="flex justify-between py-1">
                        <span>Subtotal</span>
                        <span>{previewInvoice.nf.format(previewInvoice.subtotal)}</span>
                      </div>
                      {previewInvoice.tax > 0 ? (
                        <div className="flex justify-between py-1">
                          <span>Tax</span>
                          <span>{previewInvoice.nf.format(previewInvoice.tax)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between py-2 mt-2 border-t font-bold" style={{ color: previewInvoice.primary }}>
                        <span>Total</span>
                        <span>{previewInvoice.nf.format(previewInvoice.total)}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t text-xs text-gray-600 text-center">{previewInvoice.footerText}</div>
                  </div>
                </CardContent>
              </Card>

                <Card>
                <CardHeader>
                  <CardTitle>Receipt Preview</CardTitle>
                  <CardDescription>Updates as you change template settings.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className="border rounded-lg p-4 bg-white"
                    style={{ fontFamily: previewReceipt.font, borderColor: "#e5e7eb" }}
                    aria-label="Receipt preview"
                  >
                    <div className="flex items-start justify-between gap-4 border-b pb-3">
                      <div>
                        {previewReceipt.logoUrl ? (
                          <img src={previewReceipt.logoUrl} alt="Receipt logo" className="h-10 w-auto mb-2" />
                        ) : null}
                        <div className="text-xl font-bold" style={{ color: previewReceipt.primary }}>
                          {previewReceipt.companyName}
                        </div>
                        <div className="text-xs text-gray-600">{previewReceipt.companyTagline}</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">{previewReceipt.titleText}</div>
                      </div>
                      <div className="text-right text-sm">
                        <div>
                          <span className="font-semibold">Receipt:</span> RCPT-0001
                        </div>
                        <div>
                          <span className="font-semibold">Date:</span> {previewReceipt.df.format(previewReceipt.today)}
                        </div>
                        <div>
                          <span className="font-semibold">Invoice:</span> #INV-0001
                        </div>
                      </div>
                    </div>

                    {previewReceipt.showItems ? (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left bg-gray-50">
                              <th className="p-2">Item</th>
                              <th className="p-2 text-center">Qty</th>
                              <th className="p-2 text-right">Unit</th>
                              <th className="p-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewReceipt.items.map((it) => (
                              <tr key={it.name} className="border-b">
                                <td className="p-2">
                                  <div>{it.name}</div>
                                  {previewReceipt.showDesc ? <div className="text-xs text-gray-600">{it.description}</div> : null}
                                </td>
                                <td className="p-2 text-center">{it.qty}</td>
                                <td className="p-2 text-right">{previewReceipt.nf.format(it.unit)}</td>
                                <td className="p-2 text-right">{previewReceipt.nf.format(it.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    <div className="mt-4 ml-auto w-64 text-sm">
                      <div className="flex justify-between py-2 border-t font-bold" style={{ color: previewReceipt.primary }}>
                        <span>Amount Paid</span>
                        <span>{previewReceipt.nf.format(previewReceipt.paid)}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t text-xs text-gray-600 text-center">{previewReceipt.footerText}</div>
                  </div>
                </CardContent>
              </Card>
              </div>
            </div>

            {isAdmin ? <AdminSettingsModule /> : null}
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Save settings?</DialogTitle>
            <DialogDescription>Your invoice and receipt templates will be updated immediately.</DialogDescription>
          </DialogHeader>
          <div className="p-6 pt-0 flex justify-end gap-2">
            <Button type="button" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
