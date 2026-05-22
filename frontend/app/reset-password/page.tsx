"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, getErrorMessage, setAuthUser, type AuthUser } from "@/lib/api";

function passwordIssues(value: string): string[] {
  const v = value || "";
  const issues: string[] = [];
  if (v.length < 8) issues.push("At least 8 characters");
  if (!/[A-Z]/.test(v)) issues.push("Uppercase letter");
  if (!/[a-z]/.test(v)) issues.push("Lowercase letter");
  if (!/[0-9]/.test(v)) issues.push("Number");
  if (!/[^A-Za-z0-9]/.test(v)) issues.push("Special character");
  return issues;
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="text-sm text-gray-600">Loading…</div>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const uid = params.get("uid") || "";
  const token = params.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pwIssues = useMemo(() => passwordIssues(newPassword), [newPassword]);
  const pwOk = pwIssues.length === 0;
  const pwMatch = newPassword.length > 0 && newPassword === newPasswordConfirm;
  const canSubmit = uid.length > 0 && token.length > 0 && pwOk && pwMatch && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      setSubmitting(true);
      const res = await apiRequest<{ reset: boolean; token: string }>("/auth/password-reset-confirm/", {
        method: "POST",
        body: JSON.stringify({ uid, token, new_password: newPassword, new_password_confirm: newPasswordConfirm, remember: rememberMe }),
      });
      const me = await apiRequest<AuthUser>("/auth/me/");
      setAuthUser(me);
      setSuccess("Password reset successfully.");
      router.replace("/");
    } catch (e2: unknown) {
      setError(getErrorMessage(e2, "Unable to reset password"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {success ? <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">{success}</div> : null}
          {error ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}

          {!uid || !token ? (
            <div className="text-sm text-gray-700">This reset link is missing required information.</div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <div>
                <Label htmlFor="new_password">New password</Label>
                <Input
                  id="new_password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  aria-invalid={newPassword.length > 0 && !pwOk}
                />
                {newPassword.length > 0 && !pwOk ? (
                  <div className="text-xs text-red-700 mt-1">Password must include: {pwIssues.join(", ")}.</div>
                ) : (
                  <div className="text-xs text-gray-500 mt-1">Min 8 chars, uppercase, lowercase, number, special character.</div>
                )}
              </div>
              <div>
                <Label htmlFor="new_password_confirm">Confirm new password</Label>
                <Input
                  id="new_password_confirm"
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  aria-invalid={newPasswordConfirm.length > 0 && !pwMatch}
                />
                {newPasswordConfirm.length > 0 && !pwMatch ? <div className="text-xs text-red-700 mt-1">Passwords do not match.</div> : null}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="h-4 w-4" />
                Remember me
              </label>
              <div className="flex items-center justify-between gap-3">
                <Link href="/?mode=login" prefetch={false} className="text-sm text-blue-700 underline">
                  Back to login
                </Link>
                <Button type="submit" disabled={!canSubmit}>
                  {submitting ? "Saving…" : "Reset password"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
