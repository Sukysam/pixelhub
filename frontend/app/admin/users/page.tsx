"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, getAuthUser, getErrorMessage } from "@/lib/api";

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

const EMPTY_USER_FORM: UserForm = {
  username: "",
  email: "",
  full_name: "",
  company_name: "",
  phone: "",
  is_active: true,
  primary_role: "user",
  custom_roles: [],
  password: "",
};

type RoleDraft = {
  id?: number;
  name: string;
  description: string;
  permission_codes: string[];
};

const EMPTY_ROLE_DRAFT: RoleDraft = {
  name: "",
  description: "",
  permission_codes: [],
};

export default function AdminUsersManagementPage() {
  const authUser = getAuthUser();
  const roles = authUser?.roles ?? [];
  const isAdmin = roles.includes("admin");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleCatalog, setRoleCatalog] = useState<RoleDefinition[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>(EMPTY_USER_FORM);
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(EMPTY_ROLE_DRAFT);

  const customRoles = useMemo(() => roleCatalog.filter((role) => !role.is_system), [roleCatalog]);

  const loadAll = async () => {
    setError(null);
    setLoading(true);
    try {
      const [usersRes, rolesRes, auditRes] = await Promise.all([
        apiRequest<{ results: AdminUser[] }>("/admin/users/?page=1"),
        apiRequest<{ results: RoleDefinition[]; permissions: PermissionDefinition[] }>("/admin/roles/"),
        apiRequest<{ results: AuditLogRow[] }>("/admin/audit-logs/?page=1"),
      ]);
      setUsers(usersRes.results);
      setRoleCatalog(rolesRes.results);
      setPermissionCatalog(rolesRes.permissions);
      setAuditLogs(auditRes.results);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to load admin user management"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) void loadAll();
    else setLoading(false);
  }, [isAdmin]);

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
        await apiRequest("/admin/users/", { method: "POST", body: JSON.stringify(payload) });
        setSuccess("User created successfully.");
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

  const toggleCustomRole = (roleName: string, checked: boolean) => {
    setUserForm((prev) => ({
      ...prev,
      custom_roles: checked ? [...prev.custom_roles, roleName].sort() : prev.custom_roles.filter((name) => name !== roleName),
    }));
  };

  const openCreateRole = () => {
    setRoleDraft(EMPTY_ROLE_DRAFT);
    setRoleDialogOpen(true);
  };

  const openEditRole = (role: RoleDefinition) => {
    setRoleDraft({
      id: role.id,
      name: role.name,
      description: role.description || "",
      permission_codes: role.permission_codes,
    });
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
          body: JSON.stringify({
            id: roleDraft.id,
            description: roleDraft.description.trim(),
            permission_codes: roleDraft.permission_codes,
          }),
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

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Admin User Management</h1>
          <p className="text-sm text-gray-600">You do not have permission to view this page.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin User Management</h1>
            <p className="text-sm text-gray-600">Create users, assign roles, reset passwords, and review audit activity.</p>
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

        {success ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{success}</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Manage account details, activation state, assigned roles, and password resets.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-gray-600">Loading users…</div>
            ) : (
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
                        <td className="p-2">{user.is_active ? "Active" : "Inactive"}</td>
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
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role Definitions</CardTitle>
            <CardDescription>Define and update granular permissions for non-admin roles such as viewer, editor, and manager.</CardDescription>
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
            <CardDescription>Recent account actions and login-related activity recorded by the system.</CardDescription>
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
      </div>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{userForm.id ? "Edit User" : "Create User"}</DialogTitle>
            <DialogDescription>Maintain account details, primary access level, optional custom roles, and password resets.</DialogDescription>
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
              <Label>{userForm.id ? "Reset Password" : "Password"}</Label>
              <Input
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder={userForm.id ? "Leave blank to keep the current password" : "Minimum 6 characters"}
              />
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
                />
                Active account
              </label>
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
                <Input
                  id="role_name"
                  value={roleDraft.name}
                  onChange={(e) => setRoleDraft((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={Boolean(roleDraft.id)}
                />
              </div>
              <div>
                <Label htmlFor="role_description">Description</Label>
                <Input
                  id="role_description"
                  value={roleDraft.description}
                  onChange={(e) => setRoleDraft((prev) => ({ ...prev, description: e.target.value }))}
                />
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
    </DashboardLayout>
  );
}
