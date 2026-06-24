const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000/api";
const FALLBACK_API_BASE_URL = "http://127.0.0.1:8001/api";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

export function apiOrigin(): string {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return "";
  }
}

export function resolveMediaUrl(value: string): string {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return `${typeof window !== "undefined" ? window.location.protocol : "http:"}${s}`;
  if (s.startsWith("/")) {
    const origin = apiOrigin();
    if (origin) return origin + s;
  }
  return s;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  url?: string;
  method?: string;

  constructor(status: number, message: string, details?: unknown, meta?: { url?: string; method?: string }) {
    super(message);
    this.status = status;
    this.details = details;
    this.url = meta?.url;
    this.method = meta?.method;
  }
}

const AUTH_CHANGE_EVENT = "pixelhub:authchange";

function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("auth_token") ?? window.localStorage.getItem("auth_token");
}

export function setAuthToken(token: string, remember: boolean) {
  if (typeof window === "undefined") return;
  if (remember) {
    window.localStorage.setItem("auth_token", token);
    window.sessionStorage.removeItem("auth_token");
  } else {
    window.sessionStorage.setItem("auth_token", token);
    window.localStorage.removeItem("auth_token");
  }
  notifyAuthChanged();
}

export function clearAuthToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("auth_token");
  window.sessionStorage.removeItem("auth_token");
  notifyAuthChanged();
}

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
  is_superuser: boolean;
  company_name?: string | null;
  roles?: string[];
};

export function getAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("auth_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setAuthUser(user: AuthUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("auth_user", JSON.stringify(user));
  notifyAuthChanged();
}

export function clearAuthUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("auth_user");
  notifyAuthChanged();
}

function isErrorWithMessage(e: unknown): e is { message: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

export function getErrorMessage(e: unknown, fallback: string): string {
  if (isErrorWithMessage(e)) {
    const message = e.message;
    if (/failed to fetch|load failed|networkerror/i.test(message)) {
      if (
        typeof window !== "undefined" &&
        window.location.protocol === "https:" &&
        /^http:\/\//i.test(API_BASE_URL)
      ) {
        return `Network error: the frontend is configured to call an insecure API URL (${API_BASE_URL}) from an HTTPS page. Set NEXT_PUBLIC_API_BASE_URL to your live HTTPS backend API URL.`;
      }
      if (
        typeof window !== "undefined" &&
        !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) &&
        /127\.0\.0\.1|localhost/i.test(API_BASE_URL)
      ) {
        return `Network error: the frontend is still pointing at a local API (${API_BASE_URL}). Set NEXT_PUBLIC_API_BASE_URL to your deployed backend API URL.`;
      }
    }
    return message;
  }
  return fallback;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
  }
  return undefined;
}

function summarizeErrorBody(body: unknown): string | undefined {
  if (typeof body === "string") return body.trim() || undefined;
  if (body && typeof body === "object") {
    const detail = firstString((body as { detail?: unknown }).detail);
    if (detail) return detail;

    const nonField = firstString((body as { non_field_errors?: unknown }).non_field_errors);
    if (nonField) return nonField;

    const entries = Object.entries(body as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (key === "detail" || key === "non_field_errors") continue;
      const msg = firstString(value);
      if (msg) return msg;
    }
  }
  return undefined;
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const isAbsolute = path.startsWith("http://") || path.startsWith("https://");
  const url = isAbsolute
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  const shouldFallback =
    !isAbsolute &&
    process.env.NEXT_PUBLIC_API_BASE_URL == null &&
    API_BASE_URL === DEFAULT_API_BASE_URL;
  const token = getAuthToken();
  const isFormData =
    typeof FormData !== "undefined" &&
    init?.body != null &&
    init.body instanceof FormData;
  const doFetch = async (u: string) =>
    fetch(u, {
      ...init,
      headers: {
        ...(!isFormData ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Token ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
      credentials: init?.credentials ?? "include",
      cache: "no-store",
    });

  let res: Response;
  try {
    res = await doFetch(url);
  } catch (e) {
    if (!shouldFallback) throw e;
    const fallbackUrl = `${FALLBACK_API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
    res = await doFetch(fallbackUrl);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => undefined) : await res.text();

  if (!res.ok) {
    const message = summarizeErrorBody(body) ?? res.statusText;
    throw new ApiError(res.status, message, body, { url: res.url, method: init?.method ?? "GET" });
  }

  return body as T;
}
