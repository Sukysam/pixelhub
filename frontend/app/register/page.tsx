"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, getErrorMessage } from "@/lib/api";

const COUNTRY_CODES = [
  { value: "+234", label: "NG (+234)" },
  { value: "+233", label: "GH (+233)" },
  { value: "+254", label: "KE (+254)" },
  { value: "+27", label: "ZA (+27)" },
];

type FormValues = {
  email: string;
  password: string;
  passwordConfirm: string;
  companyName: string;
  countryCode: string;
  phoneNumber: string;
  country: string;
  acceptTerms: boolean;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

function passwordStrength(password: string) {
  let score = 0;
  if (password.length >= 6) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 1) return { label: "Weak", width: "25%", color: "bg-red-500" };
  if (score <= 2) return { label: "Fair", width: "50%", color: "bg-amber-500" };
  if (score === 3) return { label: "Good", width: "75%", color: "bg-blue-500" };
  return { label: "Strong", width: "100%", color: "bg-green-600" };
}

function validatePhone(countryCode: string, phoneNumber: string): string | null {
  const digits = phoneNumber.replace(/\D/g, "");
  if (!digits) return "Phone Number is required.";
  if (countryCode === "+234") {
    let normalized = digits;
    if (normalized.startsWith("234")) normalized = normalized.slice(3);
    if (normalized.startsWith("0")) normalized = normalized.slice(1);
    if (normalized.length !== 10) return "Enter a valid Nigerian phone number.";
    return null;
  }
  if (digits.length < 7 || digits.length > 14) return "Enter a valid phone number.";
  return null;
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.email.trim()) errors.email = "Email Address is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";

  if (!values.password) errors.password = "Create New Password (6 Characters Minimum) is required.";
  else if (values.password.length < 6) errors.password = "Password must be at least 6 characters.";

  if (!values.passwordConfirm) errors.passwordConfirm = "Confirm Password is required.";
  else if (values.passwordConfirm !== values.password) errors.passwordConfirm = "Passwords do not match.";

  if (!values.companyName.trim()) errors.companyName = "Your Company Name is required.";
  if (!values.countryCode.trim()) errors.countryCode = "Country code is required.";

  const phoneError = validatePhone(values.countryCode, values.phoneNumber);
  if (phoneError) errors.phoneNumber = phoneError;

  if (values.country !== "Nigeria") errors.country = "Country is locked to Nigeria.";
  if (!values.acceptTerms) errors.acceptTerms = "You must accept the Terms of Use and Privacy Policy.";
  return errors;
}

export default function RegisterPage() {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    email: "",
    password: "",
    passwordConfirm: "",
    companyName: "",
    countryCode: "+234",
    phoneNumber: "",
    country: "Nigeria",
    acceptTerms: false,
  });
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  const errors = useMemo(() => validate(values), [values]);
  const strength = useMemo(() => passwordStrength(values.password), [values.password]);

  const visibleError = (field: keyof FormValues) => (touched[field] ? errors[field] : undefined);

  const setField = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = (field: keyof FormValues) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({
      email: true,
      password: true,
      passwordConfirm: true,
      companyName: true,
      countryCode: true,
      phoneNumber: true,
      country: true,
      acceptTerms: true,
    });
    setFormError(null);
    setSuccess(null);
    if (Object.keys(errors).length > 0) return;

    try {
      setSubmitting(true);
      const email = values.email.trim().toLowerCase();
      const res = await apiRequest<{ registered: boolean; verification_sent: boolean; detail?: string }>("/auth/register/", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: values.password,
          password_confirm: values.passwordConfirm,
          company_name: values.companyName.trim(),
          country_code: values.countryCode,
          phone_number: values.phoneNumber.trim(),
          country: values.country,
          accept_terms: values.acceptTerms,
          website: "",
        }),
      });
      setRegisteredEmail(email);
      setSuccess(
        res.verification_sent
          ? "Account created successfully. Check your email for the activation link before signing in."
          : res.detail || "Account created, but the verification email could not be delivered yet."
      );
      setValues((prev) => ({ ...prev, password: "", passwordConfirm: "" }));
    } catch (e: unknown) {
      setFormError(getErrorMessage(e, "Registration failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (!registeredEmail) return;
    setFormError(null);
    setSuccess(null);
    try {
      setResending(true);
      await apiRequest("/auth/resend-verification/", {
        method: "POST",
        body: JSON.stringify({ email: registeredEmail }),
      });
      setSuccess("Verification email sent. Please check your inbox and spam folder.");
    } catch (e: unknown) {
      setFormError(getErrorMessage(e, "Unable to resend verification email"));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>Create account</CardTitle>
            <CardDescription>or sign up with email</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {success ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{success}</div> : null}
            {formError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" aria-live="polite">
                {formError}
              </div>
            ) : null}

            <form className="space-y-5" onSubmit={onSubmit} noValidate>
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(e) => setField("email", e.target.value)}
                  onBlur={() => handleBlur("email")}
                  aria-invalid={Boolean(visibleError("email"))}
                />
                {visibleError("email") ? <p className="mt-1 text-xs text-red-700">{visibleError("email")}</p> : null}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password">Create New Password (6 Characters Minimum)</Label>
                  <button
                    type="button"
                    className="text-xs text-blue-700 underline"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={values.password}
                  onChange={(e) => setField("password", e.target.value)}
                  onBlur={() => handleBlur("password")}
                  aria-invalid={Boolean(visibleError("password"))}
                />
                <div className="mt-2" aria-live="polite">
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div className={`h-full ${strength.color}`} style={{ width: strength.width }} />
                  </div>
                  <p className="mt-1 text-xs text-gray-600">Password strength: {strength.label}</p>
                </div>
                {visibleError("password") ? <p className="mt-1 text-xs text-red-700">{visibleError("password")}</p> : null}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="passwordConfirm">Confirm Password</Label>
                  <button
                    type="button"
                    className="text-xs text-blue-700 underline"
                    onClick={() => setShowPasswordConfirm((prev) => !prev)}
                  >
                    {showPasswordConfirm ? "Hide" : "Show"}
                  </button>
                </div>
                <Input
                  id="passwordConfirm"
                  type={showPasswordConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={values.passwordConfirm}
                  onChange={(e) => setField("passwordConfirm", e.target.value)}
                  onBlur={() => handleBlur("passwordConfirm")}
                  aria-invalid={Boolean(visibleError("passwordConfirm"))}
                />
                {values.passwordConfirm && values.passwordConfirm === values.password ? (
                  <p className="mt-1 text-xs text-green-700">Passwords match.</p>
                ) : null}
                {visibleError("passwordConfirm") ? <p className="mt-1 text-xs text-red-700">{visibleError("passwordConfirm")}</p> : null}
              </div>

              <div>
                <Label htmlFor="companyName">Your Company Name</Label>
                <Input
                  id="companyName"
                  autoComplete="organization"
                  value={values.companyName}
                  onChange={(e) => setField("companyName", e.target.value)}
                  onBlur={() => handleBlur("companyName")}
                  aria-invalid={Boolean(visibleError("companyName"))}
                />
                {visibleError("companyName") ? <p className="mt-1 text-xs text-red-700">{visibleError("companyName")}</p> : null}
              </div>

              <div>
                <Label htmlFor="countryCode">Country Code</Label>
                <select
                  id="countryCode"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={values.countryCode}
                  onChange={(e) => setField("countryCode", e.target.value)}
                  onBlur={() => handleBlur("countryCode")}
                  aria-invalid={Boolean(visibleError("countryCode"))}
                >
                  {COUNTRY_CODES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {visibleError("countryCode") ? <p className="mt-1 text-xs text-red-700">{visibleError("countryCode")}</p> : null}
              </div>

              <div>
                <Label htmlFor="phoneNumber">Phone Number</Label>
                <Input
                  id="phoneNumber"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={values.phoneNumber}
                  onChange={(e) => setField("phoneNumber", e.target.value.replace(/[^\d]/g, ""))}
                  onBlur={() => handleBlur("phoneNumber")}
                  aria-invalid={Boolean(visibleError("phoneNumber"))}
                />
                <p className="mt-1 text-xs text-gray-500">Use digits only. Nigerian numbers should be 10 digits after the country code.</p>
                {visibleError("phoneNumber") ? <p className="mt-1 text-xs text-red-700">{visibleError("phoneNumber")}</p> : null}
              </div>

              <div>
                <Label htmlFor="country">Country</Label>
                <Input id="country" value={values.country} readOnly disabled onBlur={() => handleBlur("country")} />
                {visibleError("country") ? <p className="mt-1 text-xs text-red-700">{visibleError("country")}</p> : null}
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={values.acceptTerms}
                  onChange={(e) => setField("acceptTerms", e.target.checked)}
                  onBlur={() => handleBlur("acceptTerms")}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  By registering, you agree to the{" "}
                  <Link href="/terms" prefetch={false} className="text-blue-700 underline">
                    Terms of Use
                  </Link>{" "}
                  &{" "}
                  <Link href="/privacy" prefetch={false} className="text-blue-700 underline">
                    Privacy Policy
                  </Link>
                </span>
              </label>
              {visibleError("acceptTerms") ? <p className="mt-1 text-xs text-red-700">{visibleError("acceptTerms")}</p> : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Creating account…" : "Create account"}
              </Button>
            </form>

            <div className="flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                Already have an account?{" "}
                <Link href="/?mode=login" prefetch={false} className="text-blue-700 underline">
                  Go to login
                </Link>
              </div>
              {registeredEmail ? (
                <Button type="button" variant="outline" onClick={onResend} disabled={resending}>
                  {resending ? "Sending…" : "Resend verification email"}
                </Button>
              ) : null}
            </div>

            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => router.push("/")}>
                Back to home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
