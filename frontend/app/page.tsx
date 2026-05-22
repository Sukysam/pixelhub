"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AlertTriangle, DollarSign, FileText } from "lucide-react";
import { ApiError, API_BASE_URL, apiRequest, clearAuthToken, clearAuthUser, getAuthUser, getErrorMessage, setAuthUser, type AuthUser } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DashboardMetrics = {
  total_revenue: string;
  outstanding_invoices_count: number;
  outstanding_amount: string;
  low_stock_count: number;
  low_stock_items: { id: number; name: string; sku: string | null; stock_quantity: number }[];
};

type Period = "1m" | "6m" | "12m";
type FinancePoint = { label: string; income: string; expense: string };
type FinanceOverview = {
  period: Period;
  range: { start: string; end: string };
  income_total: string;
  expense_total: string;
  income_change_pct: string | null;
  expense_change_pct: string | null;
  points: FinancePoint[];
};

type ActivityType = "all" | "income" | "expense";
type ActivityEvent = { type: "income" | "expense"; amount: string; date: string; description: string };
type ActivityResponse = { events: ActivityEvent[] };

type TopProduct = {
  item_id: number;
  name: string;
  units_sold: number;
  revenue: string;
  pct_of_total_sales: string | null;
};
type TopProductsResponse = {
  period: Period;
  range: { start: string; end: string };
  total_sales: string;
  products: TopProduct[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type AuthMode = "login" | "register";
type Captcha = { captcha_id: string; question: string };

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

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

type LoginType = "user" | "staff" | "admin";

function AuthLanding({ defaultMode, onAuthed }: { defaultMode: AuthMode; onAuthed?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(defaultMode);

  const [oauthLoading, setOauthLoading] = useState<"google" | "github" | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthRemember, setOauthRemember] = useState(true);

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginType, setLoginType] = useState<LoginType>("user");
  const [adminMfaCode, setAdminMfaCode] = useState("");
  const [adminMfaSetupInfo, setAdminMfaSetupInfo] = useState<{ secret: string; provisioning_uri: string } | null>(null);
  const [adminMfaSetupLoading, setAdminMfaSetupLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [companyRegistrationNumber, setCompanyRegistrationNumber] = useState("");
  const [businessIndustry, setBusinessIndustry] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [certifications, setCertifications] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [website, setWebsite] = useState("");
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [registerLoading, setRegisterLoading] = useState(true);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerResending, setRegisterResending] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [needsResend, setNeedsResend] = useState(false);

  const loadCaptcha = useCallback(async () => {
    const res = await apiRequest<Captcha>("/auth/captcha/");
    setCaptcha(res);
    setCaptchaAnswer("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setRegisterLoading(true);
        await loadCaptcha();
      } finally {
        if (!cancelled) setRegisterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCaptcha]);

  const emailOk = useMemo(() => isValidEmail(email), [email]);
  const pwIssues = useMemo(() => passwordIssues(password), [password]);
  const pwOk = pwIssues.length === 0;
  const pwMatch = password.length > 0 && password === passwordConfirm;

  const canRegister = useMemo(() => {
    return (
      fullName.trim().length > 0 &&
      emailOk &&
      companyLegalName.trim().length > 0 &&
      businessIndustry.trim().length > 0 &&
      businessAddress.trim().length > 0 &&
      pwOk &&
      pwMatch &&
      acceptTerms &&
      (captcha?.captcha_id ?? "").length > 0 &&
      captchaAnswer.trim().length > 0 &&
      !registerLoading &&
      !registerSubmitting
    );
  }, [
    acceptTerms,
    businessAddress,
    businessIndustry,
    captcha?.captcha_id,
    captchaAnswer,
    companyLegalName,
    emailOk,
    fullName,
    pwMatch,
    pwOk,
    registerLoading,
    registerSubmitting,
  ]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      setLoginLoading(true);
      const identifierClean = loginIdentifier.trim();
      if (!identifierClean) {
        setLoginError("Email or username is required");
        return;
      }
      if (!loginPassword) {
        setLoginError("Password is required");
        return;
      }
      const endpoint =
        loginType === "admin" ? (adminMfaSetupInfo ? "/auth/admin/mfa/confirm/" : "/auth/admin/token/") : loginType === "staff" ? "/auth/staff/token/" : "/auth/token/";
      const payload: Record<string, unknown> = { username: identifierClean, password: loginPassword, remember: rememberMe };
      if (loginType === "admin") {
        const code = adminMfaCode.trim();
        if (!code) {
          setLoginError("MFA code is required for admin login");
          return;
        }
        payload.code = code;
      }
      await apiRequest<{ token: string }>(endpoint, { method: "POST", body: JSON.stringify(payload) });
      const me = await apiRequest<AuthUser>("/auth/me/");
      setAuthUser(me);
      onAuthed?.();
      router.replace("/");
    } catch (e: unknown) {
      setLoginError(getErrorMessage(e, "Login failed"));
    } finally {
      setLoginLoading(false);
    }
  };

  const onAdminMfaSetup = async () => {
    setLoginError(null);
    const identifierClean = loginIdentifier.trim();
    if (!identifierClean) {
      setLoginError("Email or username is required");
      return;
    }
    if (!loginPassword) {
      setLoginError("Password is required");
      return;
    }
    try {
      setAdminMfaSetupLoading(true);
      const res = await apiRequest<{ secret: string; provisioning_uri: string }>("/auth/admin/mfa/setup/", {
        method: "POST",
        body: JSON.stringify({ username: identifierClean, password: loginPassword, force_reset: true }),
      });
      setAdminMfaSetupInfo(res);
    } catch (e: unknown) {
      setLoginError(getErrorMessage(e, "Unable to start MFA setup"));
    } finally {
      setAdminMfaSetupLoading(false);
    }
  };

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setRegisterSuccess(null);
    setRegisteredEmail(null);
    setNeedsResend(false);
    if (!captcha) return;
    try {
      setRegisterSubmitting(true);
      const emailClean = email.trim().toLowerCase();
      const fullNameClean = fullName.trim();
      if (!emailClean) {
        setRegisterError("Email is required");
        return;
      }
      if (!fullNameClean) {
        setRegisterError("Full name is required");
        return;
      }
      const companyLegalNameClean = companyLegalName.trim();
      const industryClean = businessIndustry.trim();
      const addressClean = businessAddress.trim();
      if (!companyLegalNameClean) {
        setRegisterError("Company legal name is required");
        return;
      }
      if (!industryClean) {
        setRegisterError("Business type / industry is required");
        return;
      }
      if (!addressClean) {
        setRegisterError("Business address is required");
        return;
      }
      const companyRegClean = companyRegistrationNumber.trim();
      const res = await apiRequest<{ registered: boolean; verification_sent: boolean; detail?: string }>("/auth/register/", {
        method: "POST",
        body: JSON.stringify({
          email: emailClean,
          password,
          password_confirm: passwordConfirm,
          full_name: fullNameClean,
          phone: phone.trim() ? phone.trim() : null,
          company_legal_name: companyLegalNameClean,
          company_registration_number: companyRegClean ? companyRegClean : null,
          business_industry: industryClean,
          business_address: addressClean,
          certifications: certifications
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          accept_terms: acceptTerms,
          captcha_id: captcha.captcha_id,
          captcha_answer: captchaAnswer,
          website,
        }),
      });
      setRegisteredEmail(emailClean);
      try {
        const tokenRes = await apiRequest<{ token: string }>("/auth/token/", {
          method: "POST",
          body: JSON.stringify({ username: emailClean, password, remember: true }),
        });
        const me = await apiRequest<AuthUser>("/auth/me/");
        setAuthUser(me);
        onAuthed?.();
        router.replace("/");
        return;
      } catch {
      }
      if (res?.verification_sent) {
        setRegisterSuccess("Account created. Please check your email to verify your account.");
      } else {
        setRegisterSuccess(res?.detail || "Account created, but verification email was not delivered. Please resend verification.");
        setNeedsResend(true);
      }
      setPassword("");
      setPasswordConfirm("");
      setCaptchaAnswer("");
      await loadCaptcha();
    } catch (e: unknown) {
      setRegisterError(getErrorMessage(e, "Registration failed"));
      await loadCaptcha().catch(() => undefined);
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const onResendVerification = async () => {
    if (!registeredEmail) return;
    setRegisterError(null);
    setRegisterSuccess(null);
    try {
      setRegisterResending(true);
      await apiRequest("/auth/resend-verification/", { method: "POST", body: JSON.stringify({ email: registeredEmail }) });
      setRegisterSuccess("Verification email sent. Please check your inbox and spam folder.");
      setNeedsResend(false);
    } catch (e: unknown) {
      setRegisterError(getErrorMessage(e, "Unable to resend verification email"));
    } finally {
      setRegisterResending(false);
    }
  };

  const startOAuth = (provider: "google" | "github") => {
    setOauthError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOauthError("You appear to be offline.");
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("oauth_remember", oauthRemember ? "1" : "0");
    }
    setOauthLoading(provider);
    window.location.href = `${API_BASE_URL}/auth/${provider}/start/`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Welcome to PIXELHUB</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <div>Manage invoices, receipts, inventory, and reports in one place.</div>
            <div className="space-y-2">
              {oauthError ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
                  {oauthError}
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={oauthRemember} onChange={(e) => setOauthRemember(e.target.checked)} className="h-4 w-4" />
                Remember me on this device
              </label>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => startOAuth("google")}
                disabled={oauthLoading != null}
              >
                {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => startOAuth("github")}
                disabled={oauthLoading != null}
              >
                {oauthLoading === "github" ? "Redirecting…" : "Continue with GitHub"}
              </Button>
              <div className="text-xs text-gray-500">Social sign-in requires provider configuration (client ID/secret) on the backend.</div>
            </div>
            <div className="text-xs text-gray-500">
              By continuing, you agree to the application terms and privacy policy.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3" role="tablist" aria-label="Authentication">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`px-3 py-2 rounded-md text-sm font-medium ${mode === "login" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"}`}
                onClick={() => setMode("login")}
              >
                Login
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={`px-3 py-2 rounded-md text-sm font-medium ${mode === "register" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"}`}
                onClick={() => setMode("register")}
              >
                Create account
              </button>
            </div>
          </CardHeader>

          <CardContent>
            {mode === "login" ? (
              <div role="tabpanel" aria-label="Login form" className="space-y-4">
                {loginError ? (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
                    {loginError}
                  </div>
                ) : null}
                <form className="space-y-4" onSubmit={onLogin} noValidate>
                  <div>
                    <Label htmlFor="login_identifier">Email or username</Label>
                    <Input
                      id="login_identifier"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="login_password">Password</Label>
                    <Input
                      id="login_password"
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="login_type">Login as</Label>
                    <select
                      id="login_type"
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                      value={loginType}
                      onChange={(e) => {
                        const next = e.target.value as LoginType;
                        setLoginType(next);
                        setAdminMfaCode("");
                        setAdminMfaSetupInfo(null);
                      }}
                    >
                      <option value="user">User</option>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  {loginType === "admin" ? (
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="admin_mfa_code">MFA code</Label>
                        <Input
                          id="admin_mfa_code"
                          inputMode="numeric"
                          value={adminMfaCode}
                          onChange={(e) => setAdminMfaCode(e.target.value)}
                          placeholder="6-digit code"
                        />
                      </div>
                      {!adminMfaSetupInfo ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-gray-600">No MFA yet? Set it up in an authenticator app.</div>
                          <Button type="button" variant="outline" onClick={onAdminMfaSetup} disabled={adminMfaSetupLoading}>
                            {adminMfaSetupLoading ? "Starting…" : "Set up MFA"}
                          </Button>
                        </div>
                      ) : (
                        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                          <div className="font-medium text-gray-900">MFA setup</div>
                          <div className="mt-1 break-all">Secret: {adminMfaSetupInfo.secret}</div>
                          <div className="mt-1 break-all">URI: {adminMfaSetupInfo.provisioning_uri}</div>
                          <div className="mt-1">Enter the code from your authenticator and click Login.</div>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Remember me
                    </label>
                    <Link href="/forgot-password" prefetch={false} className="text-sm text-blue-700 underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={loginLoading}>
                      {loginLoading ? "Signing in…" : "Login"}
                    </Button>
                  </div>
                </form>
              </div>
            ) : (
              <div role="tabpanel" aria-label="Registration form" className="space-y-4">
                {registerSuccess ? (
                  <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">{registerSuccess}</div>
                ) : null}
                {registerError ? (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert" aria-live="polite">
                    {registerError}
                  </div>
                ) : null}
                {needsResend && registeredEmail ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-sm text-gray-700">
                      Didn’t receive the email for <span className="font-medium">{registeredEmail}</span>?
                    </div>
                    <Button type="button" onClick={onResendVerification} disabled={registerResending}>
                      {registerResending ? "Sending…" : "Resend"}
                    </Button>
                  </div>
                ) : null}
                <form className="space-y-4" onSubmit={onRegister} noValidate>
                  <div>
                    <Label htmlFor="full_name">Full name</Label>
                    <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
                  </div>

                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      aria-invalid={email.length > 0 && !emailOk}
                    />
                    {email.length > 0 && !emailOk ? <div className="text-xs text-red-700 mt-1">Enter a valid email address.</div> : null}
                  </div>

                  <div>
                    <Label htmlFor="phone">Phone (optional)</Label>
                    <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                  </div>

                  <div className="pt-2 border-t">
                    <div className="text-sm font-semibold text-gray-900">Company information</div>
                    <div className="text-xs text-gray-600 mt-1">Required for business accounts and invoice branding.</div>
                  </div>

                  <div>
                    <Label htmlFor="company_legal_name">Company legal name</Label>
                    <Input
                      id="company_legal_name"
                      value={companyLegalName}
                      onChange={(e) => setCompanyLegalName(e.target.value)}
                      autoComplete="organization"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="company_registration_number">Registration number (optional)</Label>
                    <Input
                      id="company_registration_number"
                      value={companyRegistrationNumber}
                      onChange={(e) => setCompanyRegistrationNumber(e.target.value)}
                      autoComplete="off"
                    />
                  </div>

                  <div>
                    <Label htmlFor="business_industry">Business type / industry</Label>
                    <Select
                      id="business_industry"
                      value={businessIndustry}
                      onChange={(e) => setBusinessIndustry(e.target.value)}
                      autoComplete="off"
                      required
                    >
                      <option value="" disabled>
                        Select an industry…
                      </option>
                      <option value="Technology">Technology</option>
                      <option value="Telecommunications">Telecommunications</option>
                      <option value="Healthcare">Healthcare</option>
                      <option value="Manufacturing">Manufacturing</option>
                      <option value="Retail">Retail</option>
                      <option value="Finance">Finance</option>
                      <option value="Education">Education</option>
                      <option value="Hospitality">Hospitality</option>
                      <option value="Construction">Construction</option>
                      <option value="Agriculture">Agriculture</option>
                      <option value="Transportation">Transportation</option>
                      <option value="Real Estate">Real Estate</option>
                      <option value="Professional Services">Professional Services</option>
                      <option value="Entertainment">Entertainment</option>
                      <option value="Energy">Energy</option>
                      <option value="Information Technology">Information Technology</option>
                      <option value="Logistics">Logistics</option>
                      <option value="Insurance">Insurance</option>
                      <option value="Legal Services">Legal Services</option>
                      <option value="Food & Beverage">Food & Beverage</option>
                      <option value="Travel & Tourism">Travel & Tourism</option>
                      <option value="Media & Publishing">Media & Publishing</option>
                      <option value="Automotive">Automotive</option>
                      <option value="Wholesale">Wholesale</option>
                      <option value="Consumer Goods">Consumer Goods</option>
                      <option value="Engineering">Engineering</option>
                      <option value="Environmental Services">Environmental Services</option>
                      <option value="Government">Government</option>
                      <option value="Nonprofit">Nonprofit</option>
                      <option value="Mining">Mining</option>
                      <option value="Utilities">Utilities</option>
                      <option value="Security Services">Security Services</option>
                      <option value="Fashion & Apparel">Fashion & Apparel</option>
                      <option value="Other">Other</option>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="business_address">Business address</Label>
                    <Input
                      id="business_address"
                      value={businessAddress}
                      onChange={(e) => setBusinessAddress(e.target.value)}
                      autoComplete="street-address"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="certifications">Certifications (optional)</Label>
                    <Input
                      id="certifications"
                      value={certifications}
                      onChange={(e) => setCertifications(e.target.value)}
                      placeholder="e.g. CAC, ISO 9001"
                      autoComplete="off"
                    />
                    <div className="text-xs text-gray-500 mt-1">Separate multiple entries with commas.</div>
                  </div>

                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      aria-invalid={password.length > 0 && !pwOk}
                    />
                    {password.length > 0 && !pwOk ? (
                      <div className="text-xs text-red-700 mt-1">Password must include: {pwIssues.join(", ")}.</div>
                    ) : (
                      <div className="text-xs text-gray-500 mt-1">Min 8 chars, uppercase, lowercase, number, special character.</div>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="password_confirm">Confirm password</Label>
                    <Input
                      id="password_confirm"
                      type="password"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      autoComplete="new-password"
                      required
                      aria-invalid={passwordConfirm.length > 0 && !pwMatch}
                    />
                    {passwordConfirm.length > 0 && !pwMatch ? <div className="text-xs text-red-700 mt-1">Passwords do not match.</div> : null}
                  </div>

                  <div className="space-y-2">
                    <div>
                      <Label htmlFor="captcha_answer">Captcha</Label>
                      <div className="text-xs text-gray-600 mt-1">{captcha?.question ?? (registerLoading ? "Loading captcha…" : "Unable to load captcha")}</div>
                      <Input
                        id="captcha_answer"
                        value={captchaAnswer}
                        onChange={(e) => setCaptchaAnswer(e.target.value)}
                        inputMode="numeric"
                        autoComplete="off"
                        required
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <button type="button" className="text-sm text-blue-700 underline" onClick={() => loadCaptcha().catch(() => undefined)}>
                        New captcha
                      </button>
                      <input type="text" className="hidden" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true" tabIndex={-1} />
                    </div>
                  </div>

                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={acceptTerms}
                      onChange={(e) => setAcceptTerms(e.target.checked)}
                      className="h-4 w-4 mt-0.5"
                      required
                    />
                    <span>I agree to the terms.</span>
                  </label>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={!canRegister}>
                      {registerSubmitting ? "Creating…" : "Create account"}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardInner() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [currencyCode, setCurrencyCode] = useState("NGN");

  const [period, setPeriod] = useState<Period>("6m");
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [activityType, setActivityType] = useState<ActivityType>("all");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [topProducts, setTopProducts] = useState<TopProductsResponse | null>(null);
  const [topProductsLoading, setTopProductsLoading] = useState(true);
  const [topProductsError, setTopProductsError] = useState<string | null>(null);

  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const currency = useMemo(() => {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode || "NGN" });
  }, [currencyCode]);

  const toUserMessage = useCallback((e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 401 || e.status === 403) return "Not authorized.";
    }
    return getErrorMessage(e, fallback);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setMetricsLoading(true);
        setMetricsError(null);
        const effective = await apiRequest<{ effective: { currency_code: string } }>("/settings/effective/");
        if (!cancelled) setCurrencyCode(effective?.effective?.currency_code || "NGN");
        const res = await apiRequest<DashboardMetrics>("/dashboard/");
        if (!cancelled) setMetrics(res);
      } catch (e: unknown) {
        if (!cancelled) setMetricsError(toUserMessage(e, "Failed to load dashboard metrics"));
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toUserMessage]);

  const loadOverview = useCallback(async () => {
    try {
      setOverviewLoading(true);
      setOverviewError(null);
      const res = await apiRequest<FinanceOverview>(`/finance/?period=${period}`);
      setOverview(res);
    } catch (e: unknown) {
      setOverviewError(toUserMessage(e, "Failed to load income/expense overview"));
    } finally {
      setOverviewLoading(false);
    }
  }, [period, toUserMessage]);

  const loadTopProducts = useCallback(async () => {
    try {
      setTopProductsLoading(true);
      setTopProductsError(null);
      const res = await apiRequest<TopProductsResponse>(`/finance/top_products/?period=${period}`);
      setTopProducts(res);
    } catch (e: unknown) {
      setTopProductsError(toUserMessage(e, "Failed to load best-selling products"));
    } finally {
      setTopProductsLoading(false);
    }
  }, [period, toUserMessage]);

  const loadActivity = useCallback(async () => {
    try {
      setActivityLoading(true);
      setActivityError(null);
      const res = await apiRequest<ActivityResponse>(`/finance/activity/?type=${activityType}&limit=15`);
      setActivity(res.events);
    } catch (e: unknown) {
      setActivityError(toUserMessage(e, "Failed to load recent activity"));
    } finally {
      setActivityLoading(false);
    }
  }, [activityType, toUserMessage]);

  useEffect(() => {
    setHoverIndex(null);
    setHoverPos(null);
    loadOverview();
    loadTopProducts();
  }, [loadOverview, loadTopProducts]);

  useEffect(() => {
    loadActivity();
    const id = window.setInterval(() => {
      loadActivity();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [loadActivity]);

  const totalRevenue = Number(metrics?.total_revenue ?? 0);
  const outstandingAmount = Number(metrics?.outstanding_amount ?? 0);

  const incomeTotal = Number(overview?.income_total ?? 0);
  const expenseTotal = Number(overview?.expense_total ?? 0);
  const netTotal = incomeTotal - expenseTotal;

  const points = useMemo(() => overview?.points ?? [], [overview]);
  const maxY = useMemo(() => {
    const max = points.reduce((acc, p) => {
      const i = Number(p.income);
      const e = Number(p.expense);
      return Math.max(acc, Number.isFinite(i) ? i : 0, Number.isFinite(e) ? e : 0);
    }, 0);
    return max > 0 ? max : 1;
  }, [points]);

  const chart = useMemo(() => {
    const w = 600;
    const h = 240;
    const p = 28;
    const n = points.length;
    const xFor = (idx: number) => (n <= 1 ? w / 2 : p + (idx / (n - 1)) * (w - p * 2));
    const yFor = (value: number) => h - p - (value / maxY) * (h - p * 2);

    const incomePts = points.map((pt, idx) => {
      const v = Number(pt.income);
      return { x: xFor(idx), y: yFor(Number.isFinite(v) ? v : 0) };
    });
    const expensePts = points.map((pt, idx) => {
      const v = Number(pt.expense);
      return { x: xFor(idx), y: yFor(Number.isFinite(v) ? v : 0) };
    });

    const toPath = (arr: { x: number; y: number }[]) => {
      if (arr.length === 0) return "";
      return arr.map((p2, i) => `${i === 0 ? "M" : "L"} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`).join(" ");
    };

    return { w, h, p, xFor, yFor, incomePts, expensePts, incomePath: toPath(incomePts), expensePath: toPath(expensePts) };
  }, [points, maxY]);

  const onChartMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartWrapRef.current || points.length === 0) return;
    const rect = chartWrapRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const idx = Math.round(((relX / rect.width) * (points.length - 1)));
    setHoverIndex(clamp(idx, 0, points.length - 1));
    setHoverPos({ x: relX, y: relY });
  };

  const onChartLeave = () => {
    setHoverIndex(null);
    setHoverPos(null);
  };

  const hovered = hoverIndex == null ? null : points[hoverIndex] ?? null;
  const hoveredIncome = hovered ? Number(hovered.income) : 0;
  const hoveredExpense = hovered ? Number(hovered.expense) : 0;

  const topRevenueMax = useMemo(() => {
    const list = topProducts?.products ?? [];
    const max = list.reduce((acc, p) => Math.max(acc, Number(p.revenue) || 0), 0);
    return max > 0 ? max : 1;
  }, [topProducts]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>

        {metricsError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {metricsError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metricsLoading ? "Loading..." : currency.format(Number.isFinite(totalRevenue) ? totalRevenue : 0)}
              </div>
              <p className="text-xs text-gray-500">Sum of all recorded receipts</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outstanding Invoices</CardTitle>
              <FileText className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metricsLoading ? "Loading..." : metrics?.outstanding_invoices_count ?? 0}
              </div>
              <p className="text-xs text-gray-500">
                Total {currency.format(Number.isFinite(outstandingAmount) ? outstandingAmount : 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="border-red-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {metricsLoading ? "Loading..." : metrics?.low_stock_count ?? 0}
              </div>
              <p className="text-xs text-gray-500">Products with stock &lt; 5</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border rounded-lg p-6 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="text-lg font-semibold text-gray-900">Income & Expense Overview</div>
                <div className="text-sm text-gray-600">
                  {overview ? `${overview.range.start} → ${overview.range.end}` : " "}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-gray-600">Period</div>
                <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                  <option value="1m">1 month</option>
                  <option value="6m">6 months</option>
                  <option value="12m">12 months</option>
                </Select>
                <Button variant="outline" onClick={() => { loadOverview(); loadTopProducts(); }} disabled={overviewLoading || topProductsLoading}>
                  Refresh
                </Button>
              </div>
            </div>

            {overviewError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {overviewError}
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs text-gray-500">Income</div>
                <div className="text-xl font-bold text-emerald-700">
                  {overviewLoading ? "Loading..." : currency.format(Number.isFinite(incomeTotal) ? incomeTotal : 0)}
                </div>
                <div className="text-xs text-gray-500">
                  {overview?.income_change_pct == null
                    ? "No prior period"
                    : `${Number(overview.income_change_pct) >= 0 ? "+" : ""}${overview.income_change_pct}% vs prior`}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs text-gray-500">Expense</div>
                <div className="text-xl font-bold text-rose-700">
                  {overviewLoading ? "Loading..." : currency.format(Number.isFinite(expenseTotal) ? expenseTotal : 0)}
                </div>
                <div className="text-xs text-gray-500">
                  {overview?.expense_change_pct == null
                    ? "No prior period"
                    : `${Number(overview.expense_change_pct) >= 0 ? "+" : ""}${overview.expense_change_pct}% vs prior`}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs text-gray-500">Net</div>
                <div className="text-xl font-bold text-gray-900">
                  {overviewLoading ? "Loading..." : currency.format(Number.isFinite(netTotal) ? netTotal : 0)}
                </div>
                <div className="text-xs text-gray-500">Income - Expense</div>
              </div>
            </div>

            <div ref={chartWrapRef} className="relative w-full">
              <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span>Income</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
                  <span>Expense</span>
                </div>
              </div>

              <svg
                className="w-full h-[260px] border rounded-lg bg-white"
                viewBox={`0 0 ${chart.w} ${chart.h}`}
                preserveAspectRatio="none"
                onMouseMove={onChartMove}
                onMouseLeave={onChartLeave}
              >
                <line x1={chart.p} y1={chart.h - chart.p} x2={chart.w - chart.p} y2={chart.h - chart.p} stroke="#e5e7eb" strokeWidth="1" />
                <line x1={chart.p} y1={chart.p} x2={chart.p} y2={chart.h - chart.p} stroke="#e5e7eb" strokeWidth="1" />

                <path d={chart.incomePath} fill="none" stroke="#10b981" strokeWidth="2" />
                <path d={chart.expensePath} fill="none" stroke="#f43f5e" strokeWidth="2" />

                {hoverIndex != null && points.length > 0 ? (
                  <>
                    <line
                      x1={chart.incomePts[hoverIndex].x}
                      y1={chart.p}
                      x2={chart.incomePts[hoverIndex].x}
                      y2={chart.h - chart.p}
                      stroke="#9ca3af"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                    <circle cx={chart.incomePts[hoverIndex].x} cy={chart.incomePts[hoverIndex].y} r="3.5" fill="#10b981" />
                    <circle cx={chart.expensePts[hoverIndex].x} cy={chart.expensePts[hoverIndex].y} r="3.5" fill="#f43f5e" />
                  </>
                ) : null}
              </svg>

              {hovered && hoverPos ? (
                <div
                  className="absolute z-10 bg-white border rounded-md shadow-sm px-3 py-2 text-xs text-gray-800"
                  style={{ left: clamp(hoverPos.x + 12, 0, (chartWrapRef.current?.clientWidth ?? 0) - 220), top: clamp(hoverPos.y - 12, 0, 220) }}
                >
                  <div className="font-semibold text-gray-900">{hovered.label}</div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-emerald-700">Income</span>
                    <span className="font-medium">{currency.format(Number.isFinite(hoveredIncome) ? hoveredIncome : 0)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-rose-700">Expense</span>
                    <span className="font-medium">{currency.format(Number.isFinite(hoveredExpense) ? hoveredExpense : 0)}</span>
                  </div>
                </div>
              ) : null}

              {overviewLoading ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-600 bg-white/60">
                  Loading chart...
                </div>
              ) : null}
            </div>
          </div>

          <div className="bg-white border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-lg font-semibold text-gray-900">Recent Activity</div>
              <Select value={activityType} onChange={(e) => setActivityType(e.target.value as ActivityType)}>
                <option value="all">All</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
            </div>

            {activityError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {activityError}
              </div>
            ) : null}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {activityLoading ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-gray-500" colSpan={3}>
                        Loading...
                      </td>
                    </tr>
                  ) : activity.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-gray-500" colSpan={3}>
                        No activity.
                      </td>
                    </tr>
                  ) : (
                    activity.slice(0, 15).map((ev, idx) => (
                      <tr key={`${ev.type}-${ev.date}-${idx}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              ev.type === "income" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {ev.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold">
                          <span className={ev.type === "income" ? "text-emerald-700" : "text-rose-700"}>
                            {currency.format(Number(ev.amount) || 0)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{ev.date}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-gray-500">
              Auto-refreshes every 30 seconds. Showing latest {Math.min(15, activity.length)} events.
            </div>
            <div className="text-sm text-gray-700 border rounded-lg p-3 max-h-40 overflow-auto">
              {activityLoading ? " " : activity.slice(0, 10).map((ev, idx) => (
                <div key={`d-${ev.type}-${ev.date}-${idx}`} className="flex items-start justify-between gap-3 py-1">
                  <div className="truncate">{ev.description}</div>
                  <div className="shrink-0 text-gray-500">{ev.date}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-gray-900">Best-Selling Products</div>
              <div className="text-sm text-gray-600">
                {topProducts ? `${topProducts.range.start} → ${topProducts.range.end}` : " "}
              </div>
            </div>
          </div>

          {topProductsError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {topProductsError}
            </div>
          ) : null}

          {topProductsLoading ? (
            <div className="text-sm text-gray-600">Loading...</div>
          ) : topProducts && topProducts.products.length > 0 ? (
            <div className="space-y-3">
              {topProducts.products.slice(0, 10).map((p) => {
                const revenue = Number(p.revenue) || 0;
                const widthPct = (revenue / topRevenueMax) * 100;
                return (
                  <div key={p.item_id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    <div className="md:col-span-4">
                      <div className="text-sm font-medium text-gray-900 truncate" title={p.name}>
                        {p.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        Units: {p.units_sold} • {p.pct_of_total_sales == null ? "—" : `${p.pct_of_total_sales}%`} of sales
                      </div>
                    </div>
                    <div className="md:col-span-6">
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-3 bg-indigo-500"
                          style={{ width: `${clamp(widthPct, 0, 100)}%` }}
                          title={`${currency.format(revenue)} revenue`}
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2 text-sm font-semibold text-gray-900">
                      {currency.format(revenue)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-600">No product sales in this period.</div>
          )}
        </div>

        {metrics && metrics.low_stock_items.length > 0 ? (
          <div className="bg-white border rounded-lg overflow-x-auto">
            <div className="px-6 py-4 border-b text-sm font-semibold text-gray-900">Low Stock Items</div>
            <table className="w-full text-left">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {metrics.low_stock_items.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{i.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{i.sku || "-"}</td>
                    <td className="px-6 py-4 text-sm text-red-700 font-semibold">{i.stock_quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

export default function HomePage() {
  return <HomePageInner />;
}

function HomePageInner() {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "authed" | "guest">("checking");
  const [defaultMode, setDefaultMode] = useState<AuthMode>("login");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const modeParam = (sp.get("mode") || "").toLowerCase();
    setDefaultMode(modeParam === "register" ? "register" : "login");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiRequest<AuthUser>("/auth/me/");
        setAuthUser(me);
        if (!cancelled) setStatus("authed");
      } catch {
        clearAuthToken();
        clearAuthUser();
        if (!cancelled) setStatus("guest");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const onStorage = () => {
      setStatus(getAuthUser() ? "authed" : "guest");
    };
    window.addEventListener("storage", onStorage);
    const onAuthChange = () => {
      setStatus(getAuthUser() ? "authed" : "guest");
    };
    window.addEventListener("pixelhub:authchange", onAuthChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pixelhub:authchange", onAuthChange);
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-sm text-gray-600">Loading…</div>
      </div>
    );
  }

  if (status === "authed") return <DashboardInner />;
  return <AuthLanding defaultMode={defaultMode} onAuthed={() => setStatus("authed")} />;
}
