"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, getErrorMessage, setAuthUser, type AuthUser } from "@/lib/api";

export default function StaffLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setLoading(true);
      await apiRequest("/auth/staff/token/", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password, remember }),
      });
      const me = await apiRequest<AuthUser>("/auth/me/");
      setAuthUser(me);
      router.replace("/");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Staff login failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Staff sign in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <div>
                <Label htmlFor="staff_username">Email or username</Label>
                <Input id="staff_username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </div>
              <div>
                <Label htmlFor="staff_password">Password</Label>
                <Input id="staff_password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
                Remember me
              </label>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Staff sign in"}
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
