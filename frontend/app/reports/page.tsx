"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, getErrorMessage } from "@/lib/api";

type ReportsResponse = {
  range: { start: string | null; end: string | null };
  revenue_total: string;
  revenue_by_day: { day: string; total: string }[];
  invoice_status: { status: string; count: number }[];
  top_items: { item_id: number; name: string; sku: string | null; type: string; quantity: number }[];
};

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toIsoDate(d);
  }, []);

  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(toIsoDate(today));
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currencyCode, setCurrencyCode] = useState("NGN");

  const currency = useMemo(() => {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode || "NGN" });
  }, [currencyCode]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<ReportsResponse>(`/reports/?start=${start}&end=${end}`);
      setData(res);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to load reports"));
    } finally {
      setLoading(false);
    }
  }, [end, start]);

  useEffect(() => {
    load();
  }, [load]);

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

  const revenueTotal = Number(data?.revenue_total ?? 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <Button onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>

        <div className="bg-white border rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <Label htmlFor="start">Start</Label>
              <Input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="end">End</Label>
              <Input id="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={load} disabled={loading}>
                Apply
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (!data) return;
                  downloadCsv(
                    `revenue_${start}_to_${end}.csv`,
                    [["day", "total"], ...data.revenue_by_day.map((r) => [r.day, r.total])]
                  );
                }}
                disabled={loading || !data}
              >
                Export Revenue CSV
              </Button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Revenue (Range)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? "Loading..." : currency.format(Number.isFinite(revenueTotal) ? revenueTotal : 0)}
              </div>
              <p className="text-xs text-gray-500">Sum of receipts between dates</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Invoices by Status</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-gray-500">Loading...</div>
              ) : (
                <div className="space-y-1 text-sm">
                  {(data?.invoice_status ?? []).map((s) => (
                    <div key={s.status} className="flex justify-between">
                      <span className="text-gray-600">{s.status}</span>
                      <span className="font-medium">{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Top Items (Qty)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-gray-500">Loading...</div>
              ) : (data?.top_items?.length ?? 0) === 0 ? (
                <div className="text-sm text-gray-500">No data.</div>
              ) : (
                <div className="space-y-1 text-sm">
                  {data!.top_items.slice(0, 5).map((i) => (
                    <div key={i.item_id} className="flex justify-between">
                      <span className="text-gray-600">{i.name}</span>
                      <span className="font-medium">{i.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b text-sm font-semibold text-gray-900">Revenue by Day</div>
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Day</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.revenue_by_day.length === 0 ? (
                    <tr>
                      <td className="px-6 py-6 text-sm text-gray-500" colSpan={2}>
                        No receipts in this range.
                      </td>
                    </tr>
                  ) : (
                    data.revenue_by_day.map((r) => (
                      <tr key={r.day} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900">{r.day}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {currency.format(Number(r.total || 0))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b text-sm font-semibold text-gray-900">Top Items</div>
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.top_items.length === 0 ? (
                    <tr>
                      <td className="px-6 py-6 text-sm text-gray-500" colSpan={4}>
                        No invoice item activity in this range.
                      </td>
                    </tr>
                  ) : (
                    data.top_items.map((i) => (
                      <tr key={i.item_id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{i.name}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{i.sku || "-"}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{i.type}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{i.quantity}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
