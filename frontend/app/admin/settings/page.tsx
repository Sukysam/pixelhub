"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { apiRequest, getAuthToken, getAuthUser, getErrorMessage, resolveMediaUrl } from "@/lib/api";

type Currency = {
  id: number;
  code: string;
  name: string;
  symbol: string | null;
  decimal_places: number;
};

type ExchangeRate = {
  id: number;
  base_code: string;
  quote_code: string;
  rate: string;
  as_of: string;
};

type GlobalSettings = {
  id: number;
  singleton_key: string;
  default_currency: number | null;
  tax_configuration: Record<string, unknown>;
  appearance: Record<string, unknown>;
  tax_identification_number: string | null;
  allow_user_overrides: boolean;
  updated_by: number | null;
  updated_at: string;
};

type AdminUser = {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
};

export default function AdminSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-xl w-full">
            <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
            <div className="text-sm text-gray-600 mt-2">Loading…</div>
          </div>
        </div>
      }
    >
      <AdminSettingsInner />
    </Suspense>
  );
}

function AdminSettingsInner() {
  const user = getAuthUser();
  const roles = user?.roles ?? [];
  const isAdmin = roles.includes("admin");
  const isStaffOrAdmin = roles.includes("staff") || roles.includes("admin");
  const readOnly = !isAdmin;
  const isAdminRef = useRef(isAdmin);
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<"global" | "users" | "fx">("global");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);

  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);
  const [globalValidationError, setGlobalValidationError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", email: "", is_staff: false, is_active: true });

  const [newRate, setNewRate] = useState({ base_code: "USD", quote_code: "EUR", rate: "" });
  const [savingRate, setSavingRate] = useState(false);

  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  useEffect(() => {
    const t = (searchParams.get("tab") || "").toLowerCase();
    if (t === "users" && isAdmin) setTab("users");
    else if (t === "fx" && isStaffOrAdmin) setTab("fx");
    else if (t === "global" && isStaffOrAdmin) setTab("global");
  }, [isAdmin, isStaffOrAdmin, searchParams]);

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const currencyList = await apiRequest<Currency[]>("/currencies/");
      setCurrencies(currencyList);
      const gs = await apiRequest<GlobalSettings>("/settings/global/");
      setGlobalSettings(gs);
      const fxRes = await apiRequest<ExchangeRate[]>("/exchange-rates/");
      setRates(fxRes);
      if (isAdminRef.current) {
        const usersRes = await apiRequest<{ results: AdminUser[] }>("/admin/users/?page=1");
        setUsers(usersRes.results);
      } else {
        setUsers([]);
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to load admin settings"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isStaffOrAdmin) void loadAll();
    else setLoading(false);
  }, [isStaffOrAdmin, loadAll]);

  const currencyOptions = useMemo(() => currencies.slice().sort((a, b) => a.code.localeCompare(b.code)), [currencies]);

  const onSaveGlobal = async () => {
    if (!globalSettings) return;
    if (!isAdmin) {
      setGlobalValidationError("You have read-only access. Contact an admin to make changes.");
      return;
    }
    setError(null);
    setGlobalSuccess(null);
    setGlobalValidationError(null);
    setLogoUploadError(null);

    const primary = String(globalSettings.appearance?.primary_color ?? "").trim();
    if (primary && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(primary)) {
      setGlobalValidationError("Primary color must be a valid hex color (e.g. #1a4d8e).");
      return;
    }

    const rateRaw = globalSettings.tax_configuration?.default_rate;
    if (rateRaw != null && String(rateRaw).trim() !== "") {
      const rateNum = Number(rateRaw);
      if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
        setGlobalValidationError("Default tax rate must be a number between 0 and 100.");
        return;
      }
    }

    if (!globalSettings.default_currency) {
      setGlobalValidationError("Default currency is required.");
      return;
    }

    const taxId = String(globalSettings.tax_identification_number ?? "").trim();
    if (taxId && taxId.length > 100) {
      setGlobalValidationError("Tax identification number must be 100 characters or less.");
      return;
    }

    setSavingGlobal(true);
    try {
      await apiRequest<GlobalSettings>("/settings/global/", {
        method: "PUT",
        body: JSON.stringify({
          default_currency: globalSettings.default_currency,
          allow_user_overrides: globalSettings.allow_user_overrides,
          tax_configuration: globalSettings.tax_configuration,
          appearance: globalSettings.appearance,
          tax_identification_number: taxId ? taxId : null,
        }),
      });
      await loadAll();
      setGlobalSuccess("Global settings saved.");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to save global settings"));
    } finally {
      setSavingGlobal(false);
    }
  };

  const uploadLogo = async (file: File) => {
    if (!isAdmin) throw new Error("Not authorized");
    setLogoUploadError(null);
    setLogoUploading(true);
    setLogoProgress(0);

    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const isJpeg = type === "image/jpeg" || type === "image/jpg" || name.endsWith(".jpg") || name.endsWith(".jpeg");
    const isPng = type === "image/png" || name.endsWith(".png");
    const isSvg = type === "image/svg+xml" || name.endsWith(".svg");
    if (!(isJpeg || isPng || isSvg)) {
      setLogoUploadError("Unsupported file type. Only JPG, PNG, SVG are allowed.");
      setLogoUploading(false);
      return;
    }

    const maxBytes = 2_000_000;
    if (file.size > maxBytes) {
      setLogoUploadError("File too large. Maximum size is 2MB.");
      setLogoUploading(false);
      return;
    }

    const form = new FormData();
    form.append("file", file, file.name);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const token = getAuthToken();
      xhr.open("POST", `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api"}/admin/logo/upload/`);
      xhr.withCredentials = true;
      if (token) xhr.setRequestHeader("Authorization", `Token ${token}`);
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        setLogoProgress(Math.round((evt.loaded / evt.total) * 100));
      };
      xhr.onload = () => {
        try {
          const ok = xhr.status >= 200 && xhr.status < 300;
          const data = xhr.responseText ? (JSON.parse(xhr.responseText) as { logo_url: string; thumbnail_url: string }) : null;
          if (!ok || !data?.logo_url) {
            reject(new Error("Upload failed"));
            return;
          }
          if (globalSettings) {
            setGlobalSettings({
              ...globalSettings,
              appearance: { ...globalSettings.appearance, logo_url: data.logo_url, logo_thumbnail_url: data.thumbnail_url },
            });
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(form);
    }).catch((e: unknown) => {
      setLogoUploadError(getErrorMessage(e, "Upload failed"));
      throw e;
    }).finally(() => {
      setLogoUploading(false);
    });
  };

  const onPickLogo = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!globalSettings) return;
    const file = files[0];
    try {
      await uploadLogo(file);
    } catch {
      // errors are surfaced via state
    } finally {
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const onToggleUser = async (u: AdminUser, patch: Partial<Pick<AdminUser, "is_active" | "is_staff">>) => {
    if (!isAdmin) {
      setError("You do not have permission to modify admin settings.");
      return;
    }
    setError(null);
    try {
      await apiRequest<{ updated: boolean }>("/admin/users/", {
        method: "PATCH",
        body: JSON.stringify({ id: u.id, ...patch }),
      });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...patch } : x)));
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to update user"));
    }
  };

  const onCreateUser = async () => {
    if (!isAdmin) {
      setError("You do not have permission to modify admin settings.");
      return;
    }
    setError(null);
    setCreatingUser(true);
    try {
      await apiRequest<{ id: number; created: boolean }>("/admin/users/", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setCreateUserOpen(false);
      setNewUser({ username: "", password: "", email: "", is_staff: false, is_active: true });
      await loadAll();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to create user"));
    } finally {
      setCreatingUser(false);
    }
  };

  const onCreateRate = async () => {
    if (!isAdmin) {
      setError("You do not have permission to modify admin settings.");
      return;
    }
    setError(null);
    setSavingRate(true);
    try {
      const created = await apiRequest<ExchangeRate>("/exchange-rates/", {
        method: "POST",
        body: JSON.stringify({ ...newRate }),
      });
      setRates((prev) => [created, ...prev].sort((a, b) => (a.base_code + a.quote_code).localeCompare(b.base_code + b.quote_code)));
      setNewRate({ base_code: "USD", quote_code: "EUR", rate: "" });
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to create exchange rate"));
    } finally {
      setSavingRate(false);
    }
  };

  const onUpdateRate = async (r: ExchangeRate, rateValue: string) => {
    if (!isAdmin) {
      setError("You do not have permission to modify admin settings.");
      return;
    }
    setError(null);
    try {
      const updated = await apiRequest<ExchangeRate>(`/exchange-rates/${r.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ rate: rateValue }),
      });
      setRates((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to update rate"));
    }
  };

  const onDeleteRate = async (r: ExchangeRate) => {
    if (!isAdmin) {
      setError("You do not have permission to modify admin settings.");
      return;
    }
    setError(null);
    try {
      await apiRequest<void>(`/exchange-rates/${r.id}/`, { method: "DELETE" });
      setRates((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to delete rate"));
    }
  };

  if (!isStaffOrAdmin) {
    return (
      <DashboardLayout>
        <div className="max-w-xl space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
          <p className="text-sm text-gray-600">You do not have permission to view admin settings.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
            <p className="text-sm text-gray-600 mt-1">System-wide configuration, user management, and exchange rates.</p>
          </div>
          <Button type="button" disabled={loading} onClick={() => void loadAll()}>
            Refresh
          </Button>
        </div>

        {readOnly ? (
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" role="status" aria-live="polite">
            Read-only access: you can view these settings, but only admins can change them.
          </div>
        ) : null}
        {error ? <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div> : null}
        {globalValidationError ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{globalValidationError}</div>
        ) : null}
        {globalSuccess ? (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">{globalSuccess}</div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {isStaffOrAdmin ? (
            <Button type="button" onClick={() => setTab("global")} disabled={tab === "global"}>
              Global
            </Button>
          ) : null}
          {isAdmin ? (
            <Button type="button" onClick={() => setTab("users")} disabled={tab === "users"}>
              Users
            </Button>
          ) : null}
          {isStaffOrAdmin ? (
            <Button type="button" onClick={() => setTab("fx")} disabled={tab === "fx"}>
              FX Rates
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : tab === "global" && globalSettings ? (
          <Card>
            <CardHeader>
              <CardTitle>Global Settings</CardTitle>
              <CardDescription>Defaults for currency, tax, and appearance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="default_currency">Default Currency</Label>
                  <Select
                    id="default_currency"
                    value={globalSettings.default_currency ?? ""}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, default_currency: e.target.value ? Number(e.target.value) : null })}
                    disabled={readOnly}
                  >
                    <option value="">None</option>
                    {currencyOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} {c.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label htmlFor="allow_overrides">User Overrides</Label>
                  <div className="mt-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        id="allow_overrides"
                        type="checkbox"
                        className="h-4 w-4"
                        checked={globalSettings.allow_user_overrides}
                        onChange={(e) => setGlobalSettings({ ...globalSettings, allow_user_overrides: e.target.checked })}
                        disabled={readOnly}
                      />
                      Allow users to customize templates and currency
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="company_name">Company Name</Label>
                  <Input
                    id="company_name"
                    value={String(globalSettings.appearance.company_name ?? "")}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, company_name: e.target.value } })}
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="company_tagline">Company Tagline</Label>
                  <Input
                    id="company_tagline"
                    value={String(globalSettings.appearance.company_tagline ?? "")}
                    onChange={(e) =>
                      setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, company_tagline: e.target.value } })
                    }
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="tax_identification_number">Tax identification number</Label>
                  <Input
                    id="tax_identification_number"
                    value={String(globalSettings.tax_identification_number ?? "")}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, tax_identification_number: e.target.value })}
                    autoComplete="off"
                    disabled={readOnly}
                  />
                  <div className="text-xs text-gray-500 mt-1">Visible and editable only to admin users.</div>
                </div>
                <div>
                  <Label htmlFor="logo_upload">Logo</Label>
                  {logoUploadError ? (
                    <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{logoUploadError}</div>
                  ) : null}
                  <input
                    id="logo_upload"
                    ref={logoInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={(e) => void onPickLogo(e.target.files)}
                    disabled={logoUploading || readOnly}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    className={`mt-2 border-2 border-dashed rounded-md p-4 bg-white text-sm text-gray-700 ${readOnly ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                    onClick={() => {
                      if (readOnly) return;
                      logoInputRef.current?.click();
                    }}
                    onKeyDown={(e) => {
                      if (readOnly) return;
                      if (e.key === "Enter" || e.key === " ") logoInputRef.current?.click();
                    }}
                    onDragOver={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      e.stopPropagation();
                      void onPickLogo(e.dataTransfer.files);
                    }}
                    aria-label="Upload logo"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">Drag & drop or click to upload</div>
                        <div className="text-xs text-gray-500">JPG, PNG, SVG • max 2MB • auto-compressed and thumbnailed</div>
                      </div>
                      {String((globalSettings.appearance as Record<string, unknown>).logo_thumbnail_url ?? "") ? (
                        <img
                          src={resolveMediaUrl(String((globalSettings.appearance as Record<string, unknown>).logo_thumbnail_url))}
                          alt="Logo thumbnail"
                          className="h-12 w-12 rounded border object-contain bg-white"
                        />
                      ) : String(globalSettings.appearance.logo_url ?? "") ? (
                        <img
                          src={resolveMediaUrl(String(globalSettings.appearance.logo_url))}
                          alt="Logo"
                          className="h-12 w-12 rounded border object-contain bg-white"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded border bg-gray-50" />
                      )}
                    </div>
                    {logoUploading ? (
                      <div className="mt-3">
                        <div className="h-2 w-full rounded bg-gray-100 overflow-hidden">
                          <div className="h-full bg-blue-600" style={{ width: `${logoProgress}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-gray-500">Uploading… {logoProgress}%</div>
                      </div>
                    ) : null}
                  </div>
                  {String(globalSettings.appearance.logo_url ?? "") ? (
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setGlobalSettings({
                            ...globalSettings,
                            appearance: { ...globalSettings.appearance, logo_url: "", logo_thumbnail_url: "" },
                          })
                        }
                        disabled={readOnly}
                      >
                        Remove Logo
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="primary_color">Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="primary_color"
                      type="color"
                      value={String(globalSettings.appearance.primary_color ?? "#1a4d8e")}
                      onChange={(e) =>
                        setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, primary_color: e.target.value } })
                      }
                      aria-label="Primary color"
                      disabled={readOnly}
                    />
                    <Input
                      value={String(globalSettings.appearance.primary_color ?? "#1a4d8e")}
                      onChange={(e) =>
                        setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, primary_color: e.target.value } })
                      }
                      disabled={readOnly}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="invoice_footer">Invoice Footer Text</Label>
                  <Input
                    id="invoice_footer"
                    value={String(globalSettings.appearance.invoice_footer_text ?? "")}
                    onChange={(e) =>
                      setGlobalSettings({
                        ...globalSettings,
                        appearance: { ...globalSettings.appearance, invoice_footer_text: e.target.value },
                      })
                    }
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="receipt_footer">Receipt Footer Text</Label>
                  <Input
                    id="receipt_footer"
                    value={String(globalSettings.appearance.receipt_footer_text ?? "")}
                    onChange={(e) =>
                      setGlobalSettings({
                        ...globalSettings,
                        appearance: { ...globalSettings.appearance, receipt_footer_text: e.target.value },
                      })
                    }
                    disabled={readOnly}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="tax_type">Tax Type</Label>
                  <Select
                    id="tax_type"
                    value={String(globalSettings.tax_configuration.type ?? "")}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, tax_configuration: { ...globalSettings.tax_configuration, type: e.target.value } })}
                    disabled={readOnly}
                  >
                    <option value="">Default</option>
                    <option value="vat">VAT</option>
                    <option value="gst">GST</option>
                    <option value="sales_tax">Sales Tax</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tax_rate">Default Tax Rate (%)</Label>
                  <Input
                    id="tax_rate"
                    value={String(globalSettings.tax_configuration.default_rate ?? "")}
                    onChange={(e) =>
                      setGlobalSettings({
                        ...globalSettings,
                        tax_configuration: { ...globalSettings.tax_configuration, default_rate: e.target.value },
                      })
                    }
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="tax_inclusive">Tax Inclusive Pricing</Label>
                  <div className="mt-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        id="tax_inclusive"
                        type="checkbox"
                        className="h-4 w-4"
                        checked={Boolean(globalSettings.tax_configuration.inclusive)}
                        onChange={(e) =>
                          setGlobalSettings({
                            ...globalSettings,
                            tax_configuration: { ...globalSettings.tax_configuration, inclusive: e.target.checked },
                          })
                        }
                        disabled={readOnly}
                      />
                      Treat prices as tax-inclusive by default
                    </label>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="button" onClick={onSaveGlobal} disabled={savingGlobal || readOnly}>
                {savingGlobal ? "Saving…" : "Save Global Settings"}
              </Button>
            </CardFooter>
          </Card>
        ) : tab === "users" ? (
          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <CardDescription>Open the dedicated admin user management workspace for account, role, and audit controls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {readOnly ? <div className="text-sm text-gray-700">You do not have permission to view or manage users.</div> : null}
              <div className="flex justify-between gap-3">
                <div className="text-sm text-gray-600">Advanced role assignment, password resets, and audit logs now live in the dedicated admin user management page.</div>
                <a
                  href="/admin/users"
                  className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ${readOnly ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-gray-900 text-white hover:bg-gray-800"}`}
                >
                  Open User Management
                </a>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left bg-gray-50">
                      <th className="p-2">Username</th>
                      <th className="p-2">Email</th>
                      <th className="p-2 text-center">Active</th>
                      <th className="p-2 text-center">Staff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b">
                        <td className="p-2">{u.username}</td>
                        <td className="p-2">{u.email}</td>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={u.is_active}
                            onChange={(e) => onToggleUser(u, { is_active: e.target.checked })}
                            aria-label={`Toggle active for ${u.username}`}
                            disabled={readOnly}
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={u.is_staff}
                            onChange={(e) => onToggleUser(u, { is_staff: e.target.checked })}
                            aria-label={`Toggle staff for ${u.username}`}
                            disabled={readOnly || u.is_superuser}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : tab === "fx" ? (
          <Card>
            <CardHeader>
              <CardTitle>Exchange Rates</CardTitle>
              <CardDescription>Manage currency conversion rates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <Label htmlFor="fx_base">Base</Label>
                  <Input
                    id="fx_base"
                    value={newRate.base_code}
                    onChange={(e) => setNewRate({ ...newRate, base_code: e.target.value.toUpperCase() })}
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="fx_quote">Quote</Label>
                  <Input
                    id="fx_quote"
                    value={newRate.quote_code}
                    onChange={(e) => setNewRate({ ...newRate, quote_code: e.target.value.toUpperCase() })}
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="fx_rate">Rate</Label>
                  <Input id="fx_rate" value={newRate.rate} onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })} disabled={readOnly} />
                </div>
                <Button type="button" onClick={onCreateRate} disabled={savingRate || !newRate.rate || readOnly}>
                  {savingRate ? "Saving…" : "Add Rate"}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left bg-gray-50">
                      <th className="p-2">Pair</th>
                      <th className="p-2">Rate</th>
                      <th className="p-2">As Of</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="p-2">
                          {r.base_code}/{r.quote_code}
                        </td>
                        <td className="p-2">
                          <Input
                            value={String(r.rate)}
                            onChange={(e) => setRates((prev) => prev.map((x) => (x.id === r.id ? { ...x, rate: e.target.value } : x)))}
                            onBlur={(e) => onUpdateRate(r, e.target.value)}
                            aria-label={`Rate for ${r.base_code}/${r.quote_code}`}
                            disabled={readOnly}
                          />
                        </td>
                        <td className="p-2 text-gray-600">{new Date(r.as_of).toLocaleString()}</td>
                        <td className="p-2 text-right">
                          <Button type="button" onClick={() => onDeleteRate(r)} disabled={readOnly}>
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
              <DialogDescription>Creates a new account with optional staff access.</DialogDescription>
          </DialogHeader>
          <div className="p-6 pt-0 space-y-4">
            <div>
              <Label htmlFor="new_username">Username</Label>
              <Input id="new_username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} disabled={readOnly} />
            </div>
            <div>
              <Label htmlFor="new_email">Email</Label>
              <Input id="new_email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} disabled={readOnly} />
            </div>
            <div>
              <Label htmlFor="new_password">Password</Label>
              <Input
                id="new_password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                disabled={readOnly}
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={newUser.is_active}
                  onChange={(e) => setNewUser({ ...newUser, is_active: e.target.checked })}
                  disabled={readOnly}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={newUser.is_staff}
                  onChange={(e) => setNewUser({ ...newUser, is_staff: e.target.checked })}
                  disabled={readOnly}
                />
                Staff
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setCreateUserOpen(false)} disabled={creatingUser}>
                Cancel
              </Button>
              <Button type="button" onClick={onCreateUser} disabled={readOnly || creatingUser || !newUser.username || !newUser.password}>
                {creatingUser ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
