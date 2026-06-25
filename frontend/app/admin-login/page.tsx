"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, getErrorMessage, setAuthUser, type AuthUser } from "@/lib/api";

type MfaSetupInfo = {
  secret: string;
  provisioning_uri: string;
};

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupInfo, setSetupInfo] = useState<MfaSetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = async () => {
    const me = await apiRequest<AuthUser>("/auth/me/");
    setAuthUser(me);
    router.replace("/");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setLoading(true);
      const endpoint = setupInfo ? "/auth/admin/mfa/confirm/" : "/auth/admin/token/";
      await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password, code: code.trim(), remember }),
      });
      await loadSession();
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Admin login failed"));
    } finally {
      setLoading(false);
    }
  };

  const onSetupMfa = async () => {
    setError(null);
    try {
      setSetupLoading(true);
      const res = await apiRequest<MfaSetupInfo>("/auth/admin/mfa/setup/", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password, force_reset: true }),
      });
      setSetupInfo(res);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Unable to start MFA setup"));
    } finally {
      setSetupLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Admin sign in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <div>
                <Label htmlFor="admin_username">Email or username</Label>
                <Input id="admin_username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </div>
              <div>
                <Label htmlFor="admin_password">Password</Label>
                <Input id="admin_password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <div>
                <Label htmlFor="admin_code">MFA code</Label>
                <Input id="admin_code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="6-digit code" required />
              </div>
              {setupInfo ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  <div className="font-medium text-gray-900">Authenticator setup</div>
                  <div className="mt-1 break-all">Secret: {setupInfo.secret}</div>
                  <div className="mt-1 break-all">URI: {setupInfo.provisioning_uri}</div>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
                  Remember me
                </label>
                <Button type="button" variant="outline" onClick={onSetupMfa} disabled={setupLoading || !username.trim() || !password}>
                  {setupLoading ? "Starting…" : "Set up MFA"}
                </Button>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Admin sign in"}
              </Button>
            </form>
            <div className="text-sm text-gray-600">
              Need a standard account login?{" "}
              <Link href="/" prefetch={false} className="text-blue-700 underline">
                Go back home
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
