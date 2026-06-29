"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LogoUploadField } from "@/components/LogoUploadField";
import { apiRequest, getAuthUser, getErrorMessage, hasAdminSettingsAccess, resolveMediaUrl, uploadLogoFile, validateLogoFile } from "@/lib/api";

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
  primary_role: "user" | "staff" | "admin";
  roles: string[];
  custom_roles: string[];
  full_name?: string | null;
  phone?: string | null;
  company_name?: string | null;
  invitation_status?: "pending_acceptance" | "accepted_pending_password" | "password_set" | "active" | "expired" | null;
  invitation_expires_at?: string | null;
  invitation_accepted_at?: string | null;
  last_login_at?: string | null;
};

type RoleDefinition = {
  id: number;
  name: string;
  description: string | null;
  is_system: boolean;
  permission_codes: string[];
};

type PermissionDefinition = {
  code: string;
  description: string | null;
};

type AuditLogRow = {
  id: number;
  action: string;
  object_id: string;
  content_type: string | null;
  changes: Record<string, unknown>;
  created_at: string | null;
  actor: string | null;
};

type UserForm = {
  id?: number;
  username: string;
  email: string;
  full_name: string;
  company_name: string;
  phone: string;
  is_active: boolean;
  primary_role: "user" | "staff" | "admin";
  custom_roles: string[];
  password: string;
};

type RoleDraft = {
  id?: number;
  name: string;
  description: string;
  permission_codes: string[];
};

const EMPTY_USER_FORM: UserForm = {
  username: "",
  email: "",
  full_name: "",
  company_name: "",
  phone: "",
  is_active: false,
  primary_role: "user",
  custom_roles: [],
  password: "",
};

const EMPTY_ROLE_DRAFT: RoleDraft = {
  name: "",
  description: "",
  permission_codes: [],
};

function describeUserAccessStatus(user: AdminUser) {
  if (user.is_active) return "Active";
  switch (user.invitation_status) {
    case "pending_acceptance":
      return "Invited";
    case "accepted_pending_password":
      return "Accepted - set password";
    case "expired":
      return "Invitation expired";
    default:
      return "Inactive";
  }
}

export function AdminSettingsModule() {
  const authUser = getAuthUser();
  const isAdmin = hasAdminSettingsAccess(authUser);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [globalValidationError, setGlobalValidationError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleCatalog, setRoleCatalog] = useState<RoleDefinition[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);

  const [newRate, setNewRate] = useState({ base_code: "USD", quote_code: "EUR", rate: "" });
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>(EMPTY_USER_FORM);
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(EMPTY_ROLE_DRAFT);

  const customRoles = useMemo(() => roleCatalog.filter((role) => !role.is_system), [roleCatalog]);
  const currencyOptions = useMemo(() => currencies.slice().sort((a, b) => a.code.localeCompare(b.code)), [currencies]);

  const loadAll = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const [currencyList, gs, fxRes, usersRes, rolesRes, auditRes] = await Promise.all([
        apiRequest<Currency[]>("/currencies/"),
        apiRequest<GlobalSettings>("/settings/global/"),
        apiRequest<ExchangeRate[]>("/exchange-rates/"),
        apiRequest<{ results: AdminUser[] }>("/admin/users/?page=1"),
        apiRequest<{ results: RoleDefinition[]; permissions: PermissionDefinition[] }>("/admin/roles/"),
        apiRequest<{ results: AuditLogRow[] }>("/admin/audit-logs/?page=1"),
      ]);
      setCurrencies(currencyList);
      setGlobalSettings(gs);
      setRates(fxRes);
      setUsers(usersRes.results);
      setRoleCatalog(rolesRes.results);
      setPermissionCatalog(rolesRes.permissions);
      setAuditLogs(auditRes.results);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to load administration settings"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    return () => {
      if (logoPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(logoPreviewUrl);
    };
  }, [logoPreviewUrl]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const onSaveGlobal = async () => {
    if (!globalSettings) return;
    setError(null);
    setSuccess(null);
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

    setSavingGlobal(true);
    try {
      await apiRequest<GlobalSettings>("/settings/global/", {
        method: "PUT",
        body: JSON.stringify({
          default_currency: globalSettings.default_currency,
          allow_user_overrides: globalSettings.allow_user_overrides,
          tax_configuration: globalSettings.tax_configuration,
          appearance: globalSettings.appearance,
          tax_identification_number: String(globalSettings.tax_identification_number ?? "").trim() || null,
        }),
      });
      await loadAll();
      setSuccess("Global settings saved.");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to save global settings"));
    } finally {
      setSavingGlobal(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setLogoUploadError(null);
    const validationError = validateLogoFile(file);
    if (validationError) {
      setLogoUploadError(validationError);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setLogoPreviewUrl((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return objectUrl;
    });
    setLogoUploading(true);
    setLogoProgress(0);
    await uploadLogoFile({
      endpointPath: "/admin/logo/upload/",
      file,
      scope: "global_appearance",
      onProgress: setLogoProgress,
    })
      .then((data) => {
        setGlobalSettings((prev) =>
          prev
            ? {
                ...prev,
                appearance: { ...prev.appearance, logo_url: data.logo_url, logo_thumbnail_url: data.logo_thumbnail_url ?? data.thumbnail_url },
              }
            : prev
        );
        setLogoPreviewUrl(resolveMediaUrl(data.logo_thumbnail_url ?? data.thumbnail_url ?? data.logo_url));
      })
      .catch((e: unknown) => {
        setLogoUploadError(getErrorMessage(e, "Upload failed"));
        throw e;
      })
      .finally(() => {
        setLogoUploading(false);
      });
  };

  const onPickLogo = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      await uploadLogo(files[0]);
    } catch {
      // surfaced through component state
    }
  };

  const onCreateRate = async () => {
    setError(null);
    try {
      setSavingRate(true);
      const created = await apiRequest<ExchangeRate>("/exchange-rates/", {
        method: "POST",
        body: JSON.stringify(newRate),
      });
      setRates((prev) => [created, ...prev].sort((a, b) => (a.base_code + a.quote_code).localeCompare(b.base_code + b.quote_code)));
      setNewRate({ base_code: "USD", quote_code: "EUR", rate: "" });
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to create exchange rate"));
    } finally {
      setSavingRate(false);
    }
  };

  const onUpdateRate = async (rate: ExchangeRate, nextValue: string) => {
    setError(null);
    try {
      const updated = await apiRequest<ExchangeRate>(`/exchange-rates/${rate.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ rate: nextValue }),
      });
      setRates((prev) => prev.map((row) => (row.id === rate.id ? updated : row)));
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to update exchange rate"));
    }
  };

  const onDeleteRate = async (rate: ExchangeRate) => {
    setError(null);
    try {
      await apiRequest<void>(`/exchange-rates/${rate.id}/`, { method: "DELETE" });
      setRates((prev) => prev.filter((row) => row.id !== rate.id));
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to delete exchange rate"));
    }
  };

  const openCreateUser = () => {
    setError(null);
    setSuccess(null);
    setUserForm(EMPTY_USER_FORM);
    setUserDialogOpen(true);
  };

  const openEditUser = (user: AdminUser) => {
    setError(null);
    setSuccess(null);
    setUserForm({
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name || "",
      company_name: user.company_name || "",
      phone: user.phone || "",
      is_active: user.is_active,
      primary_role: user.primary_role,
      custom_roles: user.custom_roles || [],
      password: "",
    });
    setUserDialogOpen(true);
  };

  const toggleCustomRole = (roleName: string, checked: boolean) => {
    setUserForm((prev) => ({
      ...prev,
      custom_roles: checked ? [...prev.custom_roles, roleName].sort() : prev.custom_roles.filter((name) => name !== roleName),
    }));
  };

  const submitUser = async () => {
    setError(null);
    setSuccess(null);
    if (!userForm.username.trim() || !userForm.email.trim()) {
      setError("Username and email are required.");
      return;
    }
    if (!userForm.id && userForm.password.length < 6) {
      setError("New users require a password of at least 6 characters.");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        username: userForm.username.trim(),
        email: userForm.email.trim().toLowerCase(),
        full_name: userForm.full_name.trim(),
        company_name: userForm.company_name.trim(),
        phone: userForm.phone.trim(),
        is_active: userForm.is_active,
        primary_role: userForm.primary_role,
        custom_roles: userForm.custom_roles,
        ...(userForm.password ? { [userForm.id ? "new_password" : "password"]: userForm.password } : {}),
        ...(userForm.id ? { id: userForm.id } : {}),
      };
      if (userForm.id) {
        await apiRequest("/admin/users/", { method: "PATCH", body: JSON.stringify(payload) });
        setSuccess("User updated successfully.");
      } else {
        const created = await apiRequest<{ invitation_sent?: boolean; detail?: string }>("/admin/users/", { method: "POST", body: JSON.stringify(payload) });
        setSuccess(
          created.invitation_sent
            ? "User created and invitation email sent."
            : created.detail || "User created, but the invitation email could not be delivered."
        );
      }
      setUserDialogOpen(false);
      setUserForm(EMPTY_USER_FORM);
      await loadAll();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Unable to save user"));
    } finally {
      setSaving(false);
    }
  };

  const openCreateRole = () => {
    setError(null);
    setSuccess(null);
    setRoleDraft(EMPTY_ROLE_DRAFT);
    setRoleDialogOpen(true);
  };

  const openEditRole = (role: RoleDefinition) => {
    setError(null);
    setSuccess(null);
    setRoleDraft({ id: role.id, name: role.name, description: role.description || "", permission_codes: role.permission_codes });
    setRoleDialogOpen(true);
  };

  const toggleRolePermission = (code: string, checked: boolean) => {
    setRoleDraft((prev) => ({
      ...prev,
      permission_codes: checked ? [...prev.permission_codes, code].sort() : prev.permission_codes.filter((value) => value !== code),
    }));
  };

  const submitRole = async () => {
    setError(null);
    setSuccess(null);
    if (!roleDraft.name.trim()) {
      setError("Role name is required.");
      return;
    }
    try {
      setSaving(true);
      if (roleDraft.id) {
        await apiRequest("/admin/roles/", {
          method: "PATCH",
          body: JSON.stringify({ id: roleDraft.id, description: roleDraft.description.trim(), permission_codes: roleDraft.permission_codes }),
        });
        setSuccess("Role updated successfully.");
      } else {
        await apiRequest("/admin/roles/", {
          method: "POST",
          body: JSON.stringify({
            name: roleDraft.name.trim().toLowerCase(),
            description: roleDraft.description.trim(),
            permission_codes: roleDraft.permission_codes,
          }),
        });
        setSuccess("Role created successfully.");
      }
      setRoleDialogOpen(false);
      setRoleDraft(EMPTY_ROLE_DRAFT);
      await loadAll();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Unable to save role"));
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Administration</h2>
        <p className="mt-1 text-sm text-gray-600">Admin-only controls for system configuration, user management, permissions, audit activity, and exchange rates.</p>
      </div>

      {success ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{success}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {globalValidationError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{globalValidationError}</div> : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>System Configuration</CardTitle>
              <CardDescription>Global defaults for branding, tax, document appearance, and user overrides.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadAll()} disabled={loading}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading || !globalSettings ? (
            <div className="text-sm text-gray-600">Loading administration settings…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="default_currency">Default Currency</Label>
                  <Select
                    id="default_currency"
                    value={globalSettings.default_currency ?? ""}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, default_currency: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">None</option>
                    {currencyOptions.map((currency) => (
                      <option key={currency.id} value={currency.id}>
                        {currency.code} {currency.name}
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
                      />
                      Allow users to customize templates and currency
                    </label>
                  </div>
                </div>
                <div>
                  <Label htmlFor="company_name">Company Name</Label>
                  <Input
                    id="company_name"
                    value={String(globalSettings.appearance.company_name ?? "")}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, company_name: e.target.value } })}
                  />
                </div>
                <div>
                  <Label htmlFor="company_tagline">Company Tagline</Label>
                  <Input
                    id="company_tagline"
                    value={String(globalSettings.appearance.company_tagline ?? "")}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, company_tagline: e.target.value } })}
                  />
                </div>
                <div>
                  <Label htmlFor="tax_identification_number">Tax identification number</Label>
                  <Input
                    id="tax_identification_number"
                    value={String(globalSettings.tax_identification_number ?? "")}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, tax_identification_number: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="primary_color">Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="primary_color"
                      type="color"
                      value={String(globalSettings.appearance.primary_color ?? "#1a4d8e")}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, primary_color: e.target.value } })}
                    />
                    <Input
                      value={String(globalSettings.appearance.primary_color ?? "#1a4d8e")}
                      onChange={(e) => setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, primary_color: e.target.value } })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="invoice_footer">Invoice Footer Text</Label>
                  <Input
                    id="invoice_footer"
                    value={String(globalSettings.appearance.invoice_footer_text ?? "")}
                    onChange={(e) =>
                      setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, invoice_footer_text: e.target.value } })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="receipt_footer">Receipt Footer Text</Label>
                  <Input
                    id="receipt_footer"
                    value={String(globalSettings.appearance.receipt_footer_text ?? "")}
                    onChange={(e) =>
                      setGlobalSettings({ ...globalSettings, appearance: { ...globalSettings.appearance, receipt_footer_text: e.target.value } })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="tax_type">Tax Type</Label>
                  <Select
                    id="tax_type"
                    value={String(globalSettings.tax_configuration.type ?? "")}
                    onChange={(e) => setGlobalSettings({ ...globalSettings, tax_configuration: { ...globalSettings.tax_configuration, type: e.target.value } })}
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
                      setGlobalSettings({ ...globalSettings, tax_configuration: { ...globalSettings.tax_configuration, default_rate: e.target.value } })
                    }
                  />
                </div>
              </div>

              <LogoUploadField
                id="logo_upload"
                label="Logo"
                helpText="JPG, PNG, SVG, WebP. Maximum size 5MB. Files are sanitized and stored securely."
                previewUrl={
                  logoPreviewUrl ||
                  resolveMediaUrl(
                    String((globalSettings.appearance as Record<string, unknown>).logo_thumbnail_url ?? globalSettings.appearance.logo_url ?? "")
                  )
                }
                previewAlt="Global logo preview"
                error={logoUploadError}
                uploading={logoUploading}
                progress={logoProgress}
                onFilesSelected={onPickLogo}
              />
            </>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="button" onClick={onSaveGlobal} disabled={savingGlobal || loading || !globalSettings}>
            {savingGlobal ? "Saving…" : "Save Global Settings"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exchange Rates</CardTitle>
          <CardDescription>Manage currency conversion rates used across the platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-4">
            <div>
              <Label htmlFor="fx_base">Base</Label>
              <Input id="fx_base" value={newRate.base_code} onChange={(e) => setNewRate({ ...newRate, base_code: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label htmlFor="fx_quote">Quote</Label>
              <Input id="fx_quote" value={newRate.quote_code} onChange={(e) => setNewRate({ ...newRate, quote_code: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label htmlFor="fx_rate">Rate</Label>
              <Input id="fx_rate" value={newRate.rate} onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })} />
            </div>
            <Button type="button" onClick={onCreateRate} disabled={savingRate || !newRate.rate}>
              {savingRate ? "Saving…" : "Add Rate"}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="p-2">Pair</th>
                  <th className="p-2">Rate</th>
                  <th className="p-2">As Of</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id} className="border-b">
                    <td className="p-2">
                      {rate.base_code}/{rate.quote_code}
                    </td>
                    <td className="p-2">
                      <Input
                        value={String(rate.rate)}
                        onChange={(e) => setRates((prev) => prev.map((row) => (row.id === rate.id ? { ...row, rate: e.target.value } : row)))}
                        onBlur={(e) => void onUpdateRate(rate, e.target.value)}
                        aria-label={`Rate for ${rate.base_code}/${rate.quote_code}`}
                      />
                    </td>
                    <td className="p-2 text-gray-600">{new Date(rate.as_of).toLocaleString()}</td>
                    <td className="p-2 text-right">
                      <Button type="button" variant="outline" onClick={() => void onDeleteRate(rate)}>
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

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Create invited accounts, track onboarding status, edit users, activate or deactivate access, and assign roles.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void loadAll()} disabled={loading || saving}>
                Refresh
              </Button>
              <Button type="button" onClick={openCreateRole}>
                New Role
              </Button>
              <Button type="button" onClick={openCreateUser}>
                New User
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="p-2">Username</th>
                  <th className="p-2">Email</th>
                  <th className="p-2">Role</th>
                  <th className="p-2">Company</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Last Login</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b">
                    <td className="p-2">{user.username}</td>
                    <td className="p-2">{user.email}</td>
                    <td className="p-2">
                      <div className="font-medium capitalize">{user.primary_role}</div>
                      {user.custom_roles.length > 0 ? <div className="text-xs text-gray-500">{user.custom_roles.join(", ")}</div> : null}
                    </td>
                    <td className="p-2">{user.company_name || "—"}</td>
                    <td className="p-2">
                      <div>{describeUserAccessStatus(user)}</div>
                      {!user.is_active && user.invitation_expires_at ? (
                        <div className="text-xs text-gray-500">Expires {new Date(user.invitation_expires_at).toLocaleString()}</div>
                      ) : null}
                    </td>
                    <td className="p-2">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "—"}</td>
                    <td className="p-2 text-right">
                      <Button type="button" variant="outline" onClick={() => openEditUser(user)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permission Settings</CardTitle>
          <CardDescription>Define and update granular permission bundles for non-admin roles.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {roleCatalog.map((role) => (
            <div key={role.id} className="rounded-md border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900">
                    {role.name}
                    {role.is_system ? <span className="ml-2 text-xs text-gray-500">System role</span> : null}
                  </div>
                  <div className="text-sm text-gray-600">{role.description || "No description provided."}</div>
                  <div className="mt-2 text-xs text-gray-500">{role.permission_codes.join(", ") || "No explicit permissions"}</div>
                </div>
                {!role.is_system ? (
                  <Button type="button" variant="outline" onClick={() => openEditRole(role)}>
                    Edit role
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Log</CardTitle>
          <CardDescription>Recent account changes, role changes, and login activity.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="p-2">When</th>
                  <th className="p-2">Actor</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Target</th>
                  <th className="p-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="p-2">{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
                    <td className="p-2">{row.actor || "System"}</td>
                    <td className="p-2 capitalize">{row.action}</td>
                    <td className="p-2">
                      {row.content_type}:{row.object_id}
                    </td>
                    <td className="p-2">
                      <pre className="whitespace-pre-wrap text-xs text-gray-600">{JSON.stringify(row.changes, null, 2)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{userForm.id ? "Edit User" : "Create User"}</DialogTitle>
            <DialogDescription>
              {userForm.id
                ? "Maintain account details, role assignments, and activation controls in one place."
                : "Create an invited account. The user stays inactive until they accept the invitation and set a password."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 p-6 pt-0 md:grid-cols-2">
            <div>
              <Label htmlFor="user_username">Username</Label>
              <Input id="user_username" value={userForm.username} onChange={(e) => setUserForm((prev) => ({ ...prev, username: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="user_email">Email</Label>
              <Input id="user_email" value={userForm.email} onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="user_full_name">Full Name</Label>
              <Input id="user_full_name" value={userForm.full_name} onChange={(e) => setUserForm((prev) => ({ ...prev, full_name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="user_company">Company Name</Label>
              <Input id="user_company" value={userForm.company_name} onChange={(e) => setUserForm((prev) => ({ ...prev, company_name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="user_phone">Phone</Label>
              <Input id="user_phone" value={userForm.phone} onChange={(e) => setUserForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="user_role">Primary Role</Label>
              <select
                id="user_role"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                value={userForm.primary_role}
                onChange={(e) => setUserForm((prev) => ({ ...prev, primary_role: e.target.value as UserForm["primary_role"] }))}
              >
                <option value="user">User</option>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <Label>{userForm.id ? "Reset Password" : "Temporary Password"}</Label>
              <Input
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder={userForm.id ? "Leave blank to keep the current password" : "Minimum 6 characters"}
              />
              {!userForm.id ? <div className="mt-1 text-xs text-gray-500">The invited user will choose their own password during onboarding.</div> : null}
            </div>
            <div className="md:col-span-2">
              <Label>Custom Roles</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                {customRoles.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={userForm.custom_roles.includes(role.name)}
                      onChange={(e) => toggleCustomRole(role.name, e.target.checked)}
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={userForm.is_active}
                  onChange={(e) => setUserForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  disabled={!userForm.id}
                />
                Active account
              </label>
              {!userForm.id ? <div className="mt-1 text-xs text-gray-500">New invited users activate automatically after accepting the invitation and setting a password.</div> : null}
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setUserDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitUser()} disabled={saving}>
                {saving ? "Saving…" : userForm.id ? "Save changes" : "Create user"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{roleDraft.id ? "Edit Role" : "Create Role"}</DialogTitle>
            <DialogDescription>Configure reusable permission bundles for non-admin accounts.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6 pt-0">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="role_name">Role Name</Label>
                <Input id="role_name" value={roleDraft.name} onChange={(e) => setRoleDraft((prev) => ({ ...prev, name: e.target.value }))} disabled={Boolean(roleDraft.id)} />
              </div>
              <div>
                <Label htmlFor="role_description">Description</Label>
                <Input id="role_description" value={roleDraft.description} onChange={(e) => setRoleDraft((prev) => ({ ...prev, description: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Permissions</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                {permissionCatalog.map((permission) => (
                  <label key={permission.code} className="flex items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={roleDraft.permission_codes.includes(permission.code)}
                      onChange={(e) => toggleRolePermission(permission.code, e.target.checked)}
                    />
                    <span>
                      <span className="block font-medium text-gray-900">{permission.code}</span>
                      <span className="block text-xs text-gray-500">{permission.description || "No description"}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRoleDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitRole()} disabled={saving}>
                {saving ? "Saving…" : roleDraft.id ? "Save role" : "Create role"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
