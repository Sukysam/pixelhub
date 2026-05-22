"use client";

import { Sidebar } from "./Sidebar";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, clearAuthToken, clearAuthUser, setAuthUser, type AuthUser, ApiError } from "@/lib/api";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiRequest<AuthUser>("/auth/me/");
        setAuthUser(me);
        if (!cancelled) setReady(true);
      } catch (e: unknown) {
        const status = e instanceof ApiError ? e.status : null;
        if (status === 401 || status === 403) {
          clearAuthToken();
          clearAuthUser();
          if (!cancelled) {
            setReady(false);
            router.replace("/?mode=login");
          }
          return;
        }
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-sm text-gray-600">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
