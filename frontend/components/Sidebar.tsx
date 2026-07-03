"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Home, Users, Package, FileText, CreditCard, BarChart3, Settings, Wallet } from "lucide-react";
import { apiRequest, clearAuthToken, clearAuthUser, getAuthUser } from "@/lib/api";
import { useI18n, type Lang } from "@/lib/i18n";

const navItems = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Receipts", href: "/receipts", icon: CreditCard },
  { name: "Expenses", href: "/expenses", icon: Wallet },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const { lang, setLang, t } = useI18n();
  const [hasToken, setHasToken] = useState(false);
  const [brandLabel, setBrandLabel] = useState("PXL INVOICE");

  useEffect(() => {
    const sync = () => {
      const user = getAuthUser();
      setHasToken(!!user);
      const company = (user?.company_name ?? "").trim();
      if (company) {
        setBrandLabel(company.length > 24 ? `${company.slice(0, 21)}…` : company);
      } else {
        setBrandLabel("PXL INVOICE");
      }
    };
    sync();
    const onStorage = () => {
      sync();
    };
    const onAuthChange = () => {
      sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pixelhub:authchange", onAuthChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pixelhub:authchange", onAuthChange);
    };
  }, []);

  return (
    <aside className="w-full border-b border-gray-800 bg-gray-900 text-white lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex flex-col gap-4 p-4 lg:min-h-screen lg:p-6">
        <div className="flex items-center justify-between gap-3 lg:block">
          <h1 className="truncate text-xl font-bold lg:text-2xl" title={brandLabel}>
            {brandLabel}
          </h1>
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              prefetch={false}
              className="flex flex-none items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-800 lg:flex-auto"
            >
              <Icon className="mr-2 h-5 w-5 lg:mr-3" />
              <span className="whitespace-nowrap">{item.name}</span>
            </Link>
          );
        })}
        </nav>

        <div className="space-y-3 lg:mt-auto">
          <div>
            <div className="mb-1 text-xs text-gray-300">Language</div>
            <select
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
            </select>
          </div>

          {hasToken ? (
            <button
              type="button"
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700"
              onClick={async () => {
                await apiRequest("/auth/logout/", { method: "POST" }).catch(() => undefined);
                clearAuthToken();
                clearAuthUser();
                setHasToken(false);
              }}
            >
              {t("logout")}
            </button>
          ) : (
            <Link
              href="/login"
              prefetch={false}
              className="block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-center text-sm hover:bg-gray-700"
            >
              {t("login")}
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
