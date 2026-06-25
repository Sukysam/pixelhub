"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { apiRequest, clearAuthToken, clearAuthUser, getErrorMessage, setAuthUser, type AuthUser } from "@/lib/api";

function readFragment(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  const raw = window.location.hash || "";
  const without = raw.startsWith("#") ? raw.slice(1) : raw;
  return new URLSearchParams(without);
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="text-sm text-gray-600">Signing you in…</div>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const errorFromQuery = params.get("error") || "";
  const providerFromQuery = params.get("provider") || "";
  const [error, setError] = useState<string | null>(null);

  const { provider, oauthError, linked } = useMemo(() => {
    const frag = readFragment();
    return {
      provider: providerFromQuery || frag.get("provider") || "",
      oauthError: errorFromQuery || frag.get("error") || "",
      linked: (frag.get("linked") || "") === "1",
    };
  }, [errorFromQuery, providerFromQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window !== "undefined") {
        try {
          window.history.replaceState(null, "", "/auth/callback");
        } catch {
          // ignore
        }
      }

      if (oauthError) {
        if (!cancelled) {
          const msg =
            oauthError === "cancelled"
              ? "Sign-in was cancelled."
              : oauthError === "not_configured"
                ? "Social sign-in is not configured."
                : oauthError === "rate_limited"
                  ? "Too many attempts. Please try again later."
                  : oauthError === "privileged_account"
                    ? "This account must use the staff or admin password login flow."
                    : oauthError === "link_requires_login"
                      ? "Sign in first, then try linking the account again."
                      : oauthError === "already_linked"
                        ? "That social account is already linked to another user."
                        : oauthError === "email_mismatch"
                          ? "The social account email does not match this profile."
                          : oauthError === "email_unavailable"
                            ? "The provider did not return a usable email address."
                  : "Unable to complete sign-in.";
          setError(provider ? `${msg} (${provider})` : msg);
        }
        return;
      }
      if (linked) {
        router.replace(`/settings?socialLinked=${encodeURIComponent(provider || "provider")}`);
        return;
      }
      try {
        const me = await apiRequest<AuthUser>("/auth/me/");
        setAuthUser(me);
        router.replace("/");
      } catch (e: unknown) {
        clearAuthToken();
        clearAuthUser();
        if (!cancelled) setError(getErrorMessage(e, "Unable to complete sign-in"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linked, oauthError, provider, router]);

  if (!error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-sm text-gray-600">Signing you in…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-lg border bg-white p-6">
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
          {error}
        </div>
        <div className="mt-4 flex justify-end">
          <Link href="/?mode=login" prefetch={false} className="text-sm text-blue-700 underline">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
