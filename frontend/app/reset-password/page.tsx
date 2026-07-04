"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
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

// #region debug-point A:report
function reportResetDebug(hypothesisId: string, msg: string, data: Record<string, unknown>) {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "webkit-reset-disabled",
      runId: "pre-fix",
      hypothesisId,
      location: "frontend/app/reset-password/page.tsx",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

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
  const mode = params.get("mode") || "";

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

  // #region debug-point B:mount-state
  useEffect(() => {
    reportResetDebug("B", "reset form mounted", {
      hasUid: uid.length > 0,
      hasToken: token.length > 0,
      mode,
    });
  }, [uid, token, mode]);
  // #endregion

  // #region debug-point A:submit-state
  useEffect(() => {
    reportResetDebug("A", "reset form state updated", {
      newPasswordLength: newPassword.length,
      newPasswordConfirmLength: newPasswordConfirm.length,
      pwIssues,
      pwOk,
      pwMatch,
      hasUid: uid.length > 0,
      hasToken: token.length > 0,
      submitting,
      canSubmit,
    });
  }, [newPassword, newPasswordConfirm, pwIssues, pwOk, pwMatch, uid, token, submitting, canSubmit]);
  // #endregion

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      setSubmitting(true);
      // #region debug-point C:submit-attempt
      reportResetDebug("C", "reset form submit attempted", {
        canSubmit,
        pwOk,
        pwMatch,
        hasUid: uid.length > 0,
        hasToken: token.length > 0,
      });
      // #endregion
      const res = await apiRequest<{ reset: boolean; token: string }>("/auth/password-reset-confirm/", {
        method: "POST",
        body: JSON.stringify({ uid, token, new_password: newPassword, new_password_confirm: newPasswordConfirm, remember: rememberMe }),
      });
      const me = await apiRequest<AuthUser>("/auth/me/");
      setAuthUser(me);
      setSuccess(mode === "invite" ? "Password set successfully. Your account is now active." : "Password reset successfully.");
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
          <CardTitle>{mode === "invite" ? "Set your password" : "Choose a new password"}</CardTitle>
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
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPassword(value);
                    // #region debug-point D:new-password-change
                    reportResetDebug("D", "new password changed", {
                      valueLength: value.length,
                      issues: passwordIssues(value),
                    });
                    // #endregion
                  }}
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
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPasswordConfirm(value);
                    // #region debug-point E:confirm-password-change
                    reportResetDebug("E", "confirm password changed", {
                      valueLength: value.length,
                      matchesNewPassword: value === newPassword,
                      newPasswordLength: newPassword.length,
                    });
                    // #endregion
                  }}
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
