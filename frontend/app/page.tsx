"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AlertTriangle, DollarSign, FileText } from "lucide-react";
import { ApiError, API_BASE_URL, apiRequest, clearAuthToken, clearAuthUser, getAuthUser, getErrorMessage, setAuthUser, type AuthUser } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DashboardMetrics = {
  total_revenue: string;
  outstanding_invoices_count: number;
  outstanding_amount: string;
  low_stock_count: number;
  low_stock_items: { id: number; name: string; sku: string | null; stock_quantity: number }[];
};

type Period = "1m" | "6m" | "12m";
type FinancePoint = { label: string; income: string; expense: string };
type FinanceOverview = {
  period: Period;
  range: { start: string; end: string };
  income_total: string;
  expense_total: string;
  income_change_pct: string | null;
  expense_change_pct: string | null;
  points: FinancePoint[];
};

type ActivityType = "all" | "income" | "expense";
type ActivityEvent = { type: "income" | "expense"; amount: string; date: string; description: string };
type ActivityResponse = { events: ActivityEvent[] };

type TopProduct = {
  item_id: number;
  name: string;
  units_sold: number;
  revenue: string;
  pct_of_total_sales: string | null;
};
type TopProductsResponse = {
  period: Period;
  range: { start: string; end: string };
  total_sales: string;
  products: TopProduct[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type AuthMode = "login" | "register";
function AuthLanding({ defaultMode, onAuthed }: { defaultMode: AuthMode; onAuthed?: () => void }) {
  const router = useRouter();
  const [oauthLoading, setOauthLoading] = useState<"google" | "facebook" | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthRemember, setOauthRemember] = useState(true);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultMode === "register") {
      router.replace("/register");
    }
  }, [defaultMode, router]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const identifierClean = loginIdentifier.trim();
    if (!identifierClean) {
      setLoginError("Email or username is required");
      return;
    }
    if (!loginPassword) {
      setLoginError("Password is required");
      return;
    }
    try {
      setLoginLoading(true);
      await apiRequest<{ token: string }>("/auth/token/", {
        method: "POST",
        body: JSON.stringify({ username: identifierClean, password: loginPassword, remember: rememberMe }),
      });
      const me = await apiRequest<AuthUser>("/auth/me/");
      setAuthUser(me);
      onAuthed?.();
      router.replace("/");
    } catch (e: unknown) {
      setLoginError(getErrorMessage(e, "Login failed"));
    } finally {
      setLoginLoading(false);
    }
  };

  const startOAuth = (provider: "google" | "facebook") => {
    setOauthError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOauthError("You appear to be offline.");
      return;
    }
    setOauthLoading(provider);
    window.location.assign(`${API_BASE_URL}/auth/${provider}/start/?remember=${oauthRemember ? "1" : "0"}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Welcome to PIXELHUB</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <div>Manage invoices, receipts, inventory, and reports in one place.</div>
            <div className="space-y-3">
              {oauthError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
                  {oauthError}
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={oauthRemember} onChange={(e) => setOauthRemember(e.target.checked)} className="h-4 w-4" />
                Remember me on this device
              </label>
              <Button type="button" variant="outline" className="w-full" onClick={() => startOAuth("google")} disabled={oauthLoading != null}>
                {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => startOAuth("facebook")} disabled={oauthLoading != null}>
                {oauthLoading === "facebook" ? "Redirecting…" : "Continue with Facebook"}
              </Button>
              <div className="text-xs text-gray-500">Social sign-in requires provider configuration on the backend.</div>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-2">
              <div className="font-medium text-gray-900">Need a different portal?</div>
              <div className="text-sm text-gray-600">Administrative sign-in is separated from the standard user login.</div>
              <div className="flex flex-wrap gap-3">
                <Link href="/staff-login" prefetch={false} className="text-sm text-blue-700 underline">
                  Staff sign in
                </Link>
                <Link href="/admin-login" prefetch={false} className="text-sm text-blue-700 underline">
                  Admin sign in
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {loginError ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
                {loginError}
              </div>
            ) : null}
            <form className="space-y-4" onSubmit={onLogin} noValidate>
              <div>
                <Label htmlFor="login_identifier">Email or username</Label>
                <Input
                  id="login_identifier"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <Label htmlFor="login_password">Password</Label>
                <Input
                  id="login_password"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="h-4 w-4" />
                  Remember me
                </label>
                <Link href="/forgot-password" prefetch={false} className="text-sm text-blue-700 underline">
                  Forgot password?
                </Link>
              </div>
              <Button type="submit" className="w-full" disabled={loginLoading}>
                {loginLoading ? "Signing in…" : "Login"}
              </Button>
            </form>

            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">New to PIXELHUB?</div>
              <div className="text-sm text-gray-600">Create a business account with Nigeria-focused onboarding and email verification.</div>
              <Link
                href="/register"
                prefetch={false}
                className="inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Create account
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardInner() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [currencyCode, setCurrencyCode] = useState("NGN");

  const [period, setPeriod] = useState<Period>("6m");
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [activityType, setActivityType] = useState<ActivityType>("all");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [topProducts, setTopProducts] = useState<TopProductsResponse | null>(null);
  const [topProductsLoading, setTopProductsLoading] = useState(true);
  const [topProductsError, setTopProductsError] = useState<string | null>(null);

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const currency = useMemo(() => {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode || "NGN" });
  }, [currencyCode]);

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 401 || e.status === 403) return "Not authorized.";
    }
    return getErrorMessage(e, fallback);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setMetricsLoading(true);
        setMetricsError(null);
        const effective = await apiRequest<{ effective: { currency_code: string } }>("/settings/effective/");
        if (!cancelled) setCurrencyCode(effective?.effective?.currency_code || "NGN");
        const res = await apiRequest<DashboardMetrics>("/dashboard/");
        if (!cancelled) setMetrics(res);
      } catch (e: unknown) {
        if (!cancelled) setMetricsError(toUserMessage(e, "Failed to load dashboard metrics"));
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toUserMessage]);

  const loadOverview = useCallback(async () => {
    try {
      setOverviewLoading(true);
      setOverviewError(null);
      const res = await apiRequest<FinanceOverview>(`/finance/?period=${period}`);
      setOverview(res);
    } catch (e: unknown) {
      setOverviewError(toUserMessage(e, "Failed to load income/expense overview"));
    } finally {
      setOverviewLoading(false);
    }
  }, [period, toUserMessage]);

  const loadTopProducts = useCallback(async () => {
    try {
      setTopProductsLoading(true);
      setTopProductsError(null);
      const res = await apiRequest<TopProductsResponse>(`/finance/top_products/?period=${period}`);
      setTopProducts(res);
    } catch (e: unknown) {
      setTopProductsError(toUserMessage(e, "Failed to load best-selling products"));
    } finally {
      setTopProductsLoading(false);
    }
  }, [period, toUserMessage]);

  const loadActivity = useCallback(async () => {
    try {
      setActivityLoading(true);
      setActivityError(null);
      const res = await apiRequest<ActivityResponse>(`/finance/activity/?type=${activityType}&limit=15`);
      setActivity(res.events);
    } catch (e: unknown) {
      setActivityError(toUserMessage(e, "Failed to load recent activity"));
    } finally {
      setActivityLoading(false);
    }
  }, [activityType, toUserMessage]);

  useEffect(() => {
    setHoverIndex(null);
    setHoverPos(null);
    loadOverview();
    loadTopProducts();
  }, [loadOverview, loadTopProducts]);

  useEffect(() => {
    loadActivity();
    const id = window.setInterval(() => {
      loadActivity();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [loadActivity]);

  const totalRevenue = Number(metrics?.total_revenue ?? 0);
  const outstandingAmount = Number(metrics?.outstanding_amount ?? 0);

  const incomeTotal = Number(overview?.income_total ?? 0);
  const expenseTotal = Number(overview?.expense_total ?? 0);
  const netTotal = incomeTotal - expenseTotal;

  const points = useMemo(() => overview?.points ?? [], [overview]);
  const maxY = useMemo(() => {
    const max = points.reduce((acc, p) => {
      const i = Number(p.income);
      const e = Number(p.expense);
      return Math.max(acc, Number.isFinite(i) ? i : 0, Number.isFinite(e) ? e : 0);
    }, 0);
    return max > 0 ? max : 1;
  }, [points]);

  const chart = useMemo(() => {
    const w = 600;
    const h = 240;
    const p = 28;
    const n = points.length;
    const xFor = (idx: number) => (n <= 1 ? w / 2 : p + (idx / (n - 1)) * (w - p * 2));
    const yFor = (value: number) => h - p - (value / maxY) * (h - p * 2);

    const incomePts = points.map((pt, idx) => {
      const v = Number(pt.income);
      return { x: xFor(idx), y: yFor(Number.isFinite(v) ? v : 0) };
    });
    const expensePts = points.map((pt, idx) => {
      const v = Number(pt.expense);
      return { x: xFor(idx), y: yFor(Number.isFinite(v) ? v : 0) };
    });

    const toPath = (arr: { x: number; y: number }[]) => {
      if (arr.length === 0) return "";
      return arr.map((p2, i) => `${i === 0 ? "M" : "L"} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`).join(" ");
    };

    return { w, h, p, xFor, yFor, incomePts, expensePts, incomePath: toPath(incomePts), expensePath: toPath(expensePts) };
  }, [points, maxY]);

  const onChartMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartWrapRef.current || points.length === 0) return;
    const rect = chartWrapRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const idx = Math.round(((relX / rect.width) * (points.length - 1)));
    setHoverIndex(clamp(idx, 0, points.length - 1));
    setHoverPos({ x: relX, y: relY });
  };

  const onChartLeave = () => {
    setHoverIndex(null);
    setHoverPos(null);
  };

  const hovered = hoverIndex == null ? null : points[hoverIndex] ?? null;
  const hoveredIncome = hovered ? Number(hovered.income) : 0;
  const hoveredExpense = hovered ? Number(hovered.expense) : 0;

  const topRevenueMax = useMemo(() => {
    const list = topProducts?.products ?? [];
    const max = list.reduce((acc, p) => Math.max(acc, Number(p.revenue) || 0), 0);
    return max > 0 ? max : 1;
  }, [topProducts]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>

        {metricsError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {metricsError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metricsLoading ? "Loading..." : currency.format(Number.isFinite(totalRevenue) ? totalRevenue : 0)}
              </div>
              <p className="text-xs text-gray-500">Sum of all recorded receipts</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outstanding Invoices</CardTitle>
              <FileText className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metricsLoading ? "Loading..." : metrics?.outstanding_invoices_count ?? 0}
              </div>
              <p className="text-xs text-gray-500">
                Total {currency.format(Number.isFinite(outstandingAmount) ? outstandingAmount : 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="border-red-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {metricsLoading ? "Loading..." : metrics?.low_stock_count ?? 0}
              </div>
              <p className="text-xs text-gray-500">Products with stock &lt; 5</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border rounded-lg p-6 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="text-lg font-semibold text-gray-900">Income & Expense Overview</div>
                <div className="text-sm text-gray-600">
                  {overview ? `${overview.range.start} → ${overview.range.end}` : " "}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-gray-600">Period</div>
                <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                  <option value="1m">1 month</option>
                  <option value="6m">6 months</option>
                  <option value="12m">12 months</option>
                </Select>
                <Button variant="outline" onClick={() => { loadOverview(); loadTopProducts(); }} disabled={overviewLoading || topProductsLoading}>
                  Refresh
                </Button>
              </div>
            </div>

            {overviewError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {overviewError}
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs text-gray-500">Income</div>
                <div className="text-xl font-bold text-emerald-700">
                  {overviewLoading ? "Loading..." : currency.format(Number.isFinite(incomeTotal) ? incomeTotal : 0)}
                </div>
                <div className="text-xs text-gray-500">
                  {overview?.income_change_pct == null
                    ? "No prior period"
                    : `${Number(overview.income_change_pct) >= 0 ? "+" : ""}${overview.income_change_pct}% vs prior`}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs text-gray-500">Expense</div>
                <div className="text-xl font-bold text-rose-700">
                  {overviewLoading ? "Loading..." : currency.format(Number.isFinite(expenseTotal) ? expenseTotal : 0)}
                </div>
                <div className="text-xs text-gray-500">
                  {overview?.expense_change_pct == null
                    ? "No prior period"
                    : `${Number(overview.expense_change_pct) >= 0 ? "+" : ""}${overview.expense_change_pct}% vs prior`}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs text-gray-500">Net</div>
                <div className="text-xl font-bold text-gray-900">
                  {overviewLoading ? "Loading..." : currency.format(Number.isFinite(netTotal) ? netTotal : 0)}
                </div>
                <div className="text-xs text-gray-500">Income - Expense</div>
              </div>
            </div>

            <div ref={chartWrapRef} className="relative w-full">
              <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span>Income</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
                  <span>Expense</span>
                </div>
              </div>

              <svg
                className="w-full h-[260px] border rounded-lg bg-white"
                viewBox={`0 0 ${chart.w} ${chart.h}`}
                preserveAspectRatio="none"
                onMouseMove={onChartMove}
                onMouseLeave={onChartLeave}
              >
                <line x1={chart.p} y1={chart.h - chart.p} x2={chart.w - chart.p} y2={chart.h - chart.p} stroke="#e5e7eb" strokeWidth="1" />
                <line x1={chart.p} y1={chart.p} x2={chart.p} y2={chart.h - chart.p} stroke="#e5e7eb" strokeWidth="1" />

                <path d={chart.incomePath} fill="none" stroke="#10b981" strokeWidth="2" />
                <path d={chart.expensePath} fill="none" stroke="#f43f5e" strokeWidth="2" />

                {hoverIndex != null && points.length > 0 ? (
                  <>
                    <line
                      x1={chart.incomePts[hoverIndex].x}
                      y1={chart.p}
                      x2={chart.incomePts[hoverIndex].x}
                      y2={chart.h - chart.p}
                      stroke="#9ca3af"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                    <circle cx={chart.incomePts[hoverIndex].x} cy={chart.incomePts[hoverIndex].y} r="3.5" fill="#10b981" />
                    <circle cx={chart.expensePts[hoverIndex].x} cy={chart.expensePts[hoverIndex].y} r="3.5" fill="#f43f5e" />
                  </>
                ) : null}
              </svg>

              {hovered && hoverPos ? (
                <div
                  className="absolute z-10 bg-white border rounded-md shadow-sm px-3 py-2 text-xs text-gray-800"
                  style={{ left: clamp(hoverPos.x + 12, 0, (chartWrapRef.current?.clientWidth ?? 0) - 220), top: clamp(hoverPos.y - 12, 0, 220) }}
                >
                  <div className="font-semibold text-gray-900">{hovered.label}</div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-emerald-700">Income</span>
                    <span className="font-medium">{currency.format(Number.isFinite(hoveredIncome) ? hoveredIncome : 0)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-rose-700">Expense</span>
                    <span className="font-medium">{currency.format(Number.isFinite(hoveredExpense) ? hoveredExpense : 0)}</span>
                  </div>
                </div>
              ) : null}

              {overviewLoading ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-600 bg-white/60">
                  Loading chart...
                </div>
              ) : null}
            </div>
          </div>

          <div className="bg-white border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-lg font-semibold text-gray-900">Recent Activity</div>
              <Select value={activityType} onChange={(e) => setActivityType(e.target.value as ActivityType)}>
                <option value="all">All</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
            </div>

            {activityError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {activityError}
              </div>
            ) : null}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {activityLoading ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-gray-500" colSpan={3}>
                        Loading...
                      </td>
                    </tr>
                  ) : activity.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-gray-500" colSpan={3}>
                        No activity.
                      </td>
                    </tr>
                  ) : (
                    activity.slice(0, 15).map((ev, idx) => (
                      <tr key={`${ev.type}-${ev.date}-${idx}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              ev.type === "income" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {ev.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold">
                          <span className={ev.type === "income" ? "text-emerald-700" : "text-rose-700"}>
                            {currency.format(Number(ev.amount) || 0)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{ev.date}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-gray-500">
              Auto-refreshes every 30 seconds. Showing latest {Math.min(15, activity.length)} events.
            </div>
            <div className="text-sm text-gray-700 border rounded-lg p-3 max-h-40 overflow-auto">
              {activityLoading ? " " : activity.slice(0, 10).map((ev, idx) => (
                <div key={`d-${ev.type}-${ev.date}-${idx}`} className="flex items-start justify-between gap-3 py-1">
                  <div className="truncate">{ev.description}</div>
                  <div className="shrink-0 text-gray-500">{ev.date}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-gray-900">Best-Selling Products</div>
              <div className="text-sm text-gray-600">
                {topProducts ? `${topProducts.range.start} → ${topProducts.range.end}` : " "}
              </div>
            </div>
          </div>

          {topProductsError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {topProductsError}
            </div>
          ) : null}

          {topProductsLoading ? (
            <div className="text-sm text-gray-600">Loading...</div>
          ) : topProducts && topProducts.products.length > 0 ? (
            <div className="space-y-3">
              {topProducts.products.slice(0, 10).map((p) => {
                const revenue = Number(p.revenue) || 0;
                const widthPct = (revenue / topRevenueMax) * 100;
                return (
                  <div key={p.item_id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    <div className="md:col-span-4">
                      <div className="text-sm font-medium text-gray-900 truncate" title={p.name}>
                        {p.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        Units: {p.units_sold} • {p.pct_of_total_sales == null ? "—" : `${p.pct_of_total_sales}%`} of sales
                      </div>
                    </div>
                    <div className="md:col-span-6">
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-3 bg-indigo-500"
                          style={{ width: `${clamp(widthPct, 0, 100)}%` }}
                          title={`${currency.format(revenue)} revenue`}
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2 text-sm font-semibold text-gray-900">
                      {currency.format(revenue)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-600">No product sales in this period.</div>
          )}
        </div>

        {metrics && metrics.low_stock_items.length > 0 ? (
          <div className="bg-white border rounded-lg overflow-x-auto">
            <div className="px-6 py-4 border-b text-sm font-semibold text-gray-900">Low Stock Items</div>
            <table className="w-full text-left">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {metrics.low_stock_items.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{i.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{i.sku || "-"}</td>
                    <td className="px-6 py-4 text-sm text-red-700 font-semibold">{i.stock_quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

export default function HomePage() {
  return <HomePageInner />;
}

function HomePageInner() {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "authed" | "guest">("checking");
  const [defaultMode, setDefaultMode] = useState<AuthMode>("login");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const modeParam = (sp.get("mode") || "").toLowerCase();
    setDefaultMode(modeParam === "register" ? "register" : "login");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiRequest<AuthUser>("/auth/me/");
        setAuthUser(me);
        if (!cancelled) setStatus("authed");
      } catch {
        clearAuthToken();
        clearAuthUser();
        if (!cancelled) setStatus("guest");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const onStorage = () => {
      setStatus(getAuthUser() ? "authed" : "guest");
    };
    window.addEventListener("storage", onStorage);
    const onAuthChange = () => {
      setStatus(getAuthUser() ? "authed" : "guest");
    };
    window.addEventListener("pixelhub:authchange", onAuthChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pixelhub:authchange", onAuthChange);
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-sm text-gray-600">Loading…</div>
      </div>
    );
  }

  if (status === "authed") return <DashboardInner />;
  return <AuthLanding defaultMode={defaultMode} onAuthed={() => setStatus("authed")} />;
}
