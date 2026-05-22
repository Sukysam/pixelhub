"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, getErrorMessage } from "@/lib/api";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = useMemo(() => params.get("token") || "", [params]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setError(null);
      setSuccess(null);
      if (!token) {
        setLoading(false);
        setError("Missing token.");
        return;
      }
      try {
        setLoading(true);
        await apiRequest("/auth/verify-email/", { method: "POST", body: JSON.stringify({ token }) });
        setSuccess("Email verified. You can now log in.");
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Verification failed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Verify email</CardTitle>
            <CardDescription>Activate your account by verifying your email address.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? <div className="text-sm text-gray-600">Verifying…</div> : null}
            {success ? <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">{success}</div> : null}
            {error ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
                {error}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Link href="/?mode=login" prefetch={false} className="text-sm text-blue-700 underline self-center">
                Go to login
              </Link>
              <Button type="button" onClick={() => window.location.reload()} disabled={loading}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="w-full max-w-lg">
            <Card>
              <CardHeader>
                <CardTitle>Verify email</CardTitle>
                <CardDescription>Activate your account by verifying your email address.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-gray-600">Loading…</div>
              </CardContent>
            </Card>
          </div>
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
