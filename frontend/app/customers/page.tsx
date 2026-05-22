"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { ApiError, apiRequest, getErrorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Customer {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  updated_at: string;
}

type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export default function CustomersPage() {
  const { t } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Pick<Customer, "name" | "email" | "phone" | "billing_address">>({
    name: "",
    email: null,
    phone: null,
    billing_address: null,
  });
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  const [newCustomer, setNewCustomer] = useState<{
    name: string;
    email: string;
    phone: string;
    billing_address: string;
  }>({
    name: "",
    email: "",
    phone: "",
    billing_address: "",
  });

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 403) return t("forbidden");
      if (e.status === 409) return e.message || t("conflict");
    }
    return getErrorMessage(e, fallback);
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiRequest<Paginated<Customer>>("/customers/?page=1");
        if (!cancelled) {
          setCustomers(data.results);
          setNextUrl(data.next);
          setSelectedIds({});
        }
      } catch (e: unknown) {
        if (!cancelled) setError(toUserMessage(e, "Failed to load customers"));
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
      const data = await apiRequest<Paginated<Customer>>(nextUrl);
      setCustomers((prev) => [...prev, ...data.results]);
      setNextUrl(data.next);
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to load more customers"));
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);
      const created = await apiRequest<Customer>("/customers/", {
        method: "POST",
        body: JSON.stringify({
          name: newCustomer.name,
          email: newCustomer.email || null,
          phone: newCustomer.phone || null,
          billing_address: newCustomer.billing_address || null,
        }),
      });
      setCustomers((prev) => [created, ...prev]);
      setNewCustomer({ name: "", email: "", phone: "", billing_address: "" });
      setIsModalOpen(false);
      setSuccess(t("saved"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to create customer"));
    }
  };

  const startEdit = (c: Customer) => {
    setError(null);
    setSuccess(null);
    setEditingId(c.id);
    setEditDraft({
      name: c.name,
      email: c.email,
      phone: c.phone,
      billing_address: c.billing_address,
    });
  };

  const requestSave = () => {
    if (editingId === null) return;
    if (!editDraft.name.trim()) {
      setError(t("nameRequired"));
      return;
    }
    setConfirmSaveOpen(true);
  };

  const confirmSave = async () => {
    if (editingId === null) return;
    const current = customers.find((c) => c.id === editingId);
    if (!current) return;
    try {
      setError(null);
      setSuccess(null);
      const updated = await apiRequest<Customer>(`/customers/${editingId}/`, {
        method: "PATCH",
        body: JSON.stringify({
          ...editDraft,
          updated_at: current.updated_at,
        }),
      });
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingId(null);
      setConfirmSaveOpen(false);
      setSuccess(t("saved"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to save customer"));
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
    const current = customers.find((c) => c.id === pendingDeleteId);
    if (!current) return;
    try {
      setError(null);
      setSuccess(null);
      await apiRequest<void>(`/customers/${pendingDeleteId}/?updated_at=${encodeURIComponent(current.updated_at)}`, {
        method: "DELETE",
      });
      setCustomers((prev) => prev.filter((c) => c.id !== pendingDeleteId));
      setSelectedIds((prev) => {
        const next = { ...prev };
        delete next[pendingDeleteId];
        return next;
      });
      setConfirmDeleteOpen(false);
      setPendingDeleteId(null);
      setSuccess(t("deleted"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to delete customer"));
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
      await apiRequest<{ deleted: number }>("/customers/bulk_delete/", {
        method: "POST",
        body: JSON.stringify({ ids: selectedList }),
      });
      setCustomers((prev) => prev.filter((c) => !selectedIds[c.id]));
      setSelectedIds({});
      setConfirmBulkDeleteOpen(false);
      setSuccess(t("deleted"));
    } catch (e: unknown) {
      setError(toUserMessage(e, "Failed to bulk delete customers"));
      setConfirmBulkDeleteOpen(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
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

        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={customers.length > 0 && selectedList.length === customers.length}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const next: Record<number, boolean> = {};
                      for (const c of customers) next[c.id] = checked;
                      setSelectedIds(next);
                    }}
                  />
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Phone
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Address
                </th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    Loading...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    No customers yet.
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={!!selectedIds[customer.id]}
                      onChange={(e) => setSelectedIds((p) => ({ ...p, [customer.id]: e.target.checked }))}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {editingId === customer.id ? (
                      <Input
                        value={editDraft.name}
                        onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
                      />
                    ) : (
                      customer.name
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {editingId === customer.id ? (
                      <Input
                        type="email"
                        value={editDraft.email ?? ""}
                        onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value || null }))}
                      />
                    ) : (
                      customer.email || "-"
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {editingId === customer.id ? (
                      <Input
                        value={editDraft.phone ?? ""}
                        onChange={(e) => setEditDraft((p) => ({ ...p, phone: e.target.value || null }))}
                      />
                    ) : (
                      customer.phone || "-"
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {editingId === customer.id ? (
                      <Input
                        value={editDraft.billing_address ?? ""}
                        onChange={(e) => setEditDraft((p) => ({ ...p, billing_address: e.target.value || null }))}
                      />
                    ) : (
                      customer.billing_address || "-"
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {editingId === customer.id ? (
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
                        <Button size="sm" variant="outline" onClick={() => startEdit(customer)}>
                          {t("edit")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => requestDelete(customer.id)}>
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

        {nextUrl ? (
          <div className="flex justify-center">
            <Button variant="outline" onClick={loadMore} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddCustomer} className="p-6 pt-0 space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="address">Billing Address</Label>
              <Input
                id="address"
                value={newCustomer.billing_address}
                onChange={(e) => setNewCustomer({ ...newCustomer, billing_address: e.target.value })}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Customer</Button>
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
            <div className="text-sm text-gray-700">
              {t("confirmDeleteBody")}
            </div>
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
