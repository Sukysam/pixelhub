"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, getErrorMessage } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      setSubmitting(true);
      const form = e.currentTarget as HTMLFormElement;
      const domValue = (form.elements.namedItem("email") as HTMLInputElement | null)?.value;
      const emailClean = String(domValue ?? email).trim();
      if (!emailClean) {
        setError("Email is required");
        return;
      }
      await apiRequest("/auth/password-reset/", { method: "POST", body: JSON.stringify({ email: emailClean }) });
      setSuccess("If an account exists for that email, a password reset link has been sent.");
      setEmail("");
    } catch (e2: unknown) {
      setError(getErrorMessage(e2, "Unable to request password reset"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {success ? <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">{success}</div> : null}
          {error ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Link href="/?mode=login" prefetch={false} className="text-sm text-blue-700 underline">
                Back to login
              </Link>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
