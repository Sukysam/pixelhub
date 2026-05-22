"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Home, Users, Package, FileText, CreditCard, BarChart3, Settings } from "lucide-react";
import { apiRequest, clearAuthToken, clearAuthUser, getAuthUser } from "@/lib/api";
import { useI18n, type Lang } from "@/lib/i18n";

const navItems = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Receipts", href: "/receipts", icon: CreditCard },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const { lang, setLang, t } = useI18n();
  const [hasToken, setHasToken] = useState(false);
  const [hasPrivilegedRole, setHasPrivilegedRole] = useState(false);
  const [brandLabel, setBrandLabel] = useState("PIXELHUB");

  useEffect(() => {
    const sync = () => {
      const user = getAuthUser();
      const roles = user?.roles ?? [];
      setHasToken(!!user);
      setHasPrivilegedRole(roles.includes("staff") || roles.includes("admin"));
      const company = (user?.company_name ?? "").trim();
      if (company) {
        setBrandLabel(company.length > 24 ? `${company.slice(0, 21)}…` : company);
      } else {
        setBrandLabel("PIXELHUB");
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
    <div className="w-64 bg-gray-900 text-white min-h-screen">
      <div className="p-6">
        <h1 className="text-2xl font-bold" title={brandLabel}>
          {brandLabel}
        </h1>
      </div>
      <nav className="space-y-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              prefetch={false}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <Icon className="mr-3 h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
        {hasPrivilegedRole ? (
          <Link
            href="/admin/settings"
            prefetch={false}
            className="flex items-center px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            <Settings className="mr-3 h-5 w-5" />
            Admin Settings
          </Link>
        ) : null}
      </nav>

      <div className="mt-auto p-4 space-y-3">
        <div>
          <div className="text-xs text-gray-300 mb-1">Language</div>
          <select
            className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
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
            className="w-full rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-2 text-sm"
            onClick={async () => {
              await apiRequest("/auth/logout/", { method: "POST" }).catch(() => undefined);
              clearAuthToken();
              clearAuthUser();
              setHasToken(false);
              setHasPrivilegedRole(false);
            }}
          >
            {t("logout")}
          </button>
        ) : (
          <Link
            href="/login"
            prefetch={false}
            className="block w-full text-center rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-2 text-sm"
          >
            {t("login")}
          </Link>
        )}
      </div>
    </div>
  );
}
