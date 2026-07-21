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

export async function downloadWithAuth(path: string, fallbackFilename = "download"): Promise<string> {
  const token = getAuthToken();
  let url = path;
  if (!/^https?:\/\//i.test(path)) {
    if (path.startsWith("/api/")) {
      const origin = apiOrigin();
      url = origin ? `${origin}${path}` : path;
    } else {
      url = `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
    }
  }
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Token ${token}`;
  const res = await fetch(url, { headers, credentials: "include", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/i.exec(cd);
  const filename = match?.[1] ?? fallbackFilename;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return filename;
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
const DATA_CHANGE_EVENT = "pixelhub:datachange";
const DATA_CHANGE_STORAGE_KEY = "pixelhub:datachange";

function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export type DataChangeScope = "all" | "expenses" | "invoices" | "receipts" | "inventory" | "customers";

export function notifyDataChanged(scope: DataChangeScope = "all") {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ scope, ts: Date.now() });
  try {
    window.localStorage.setItem(DATA_CHANGE_STORAGE_KEY, payload);
  } catch {
    // Ignore storage quota or privacy-mode failures and still emit an in-page event.
  }
  window.dispatchEvent(new CustomEvent(DATA_CHANGE_EVENT, { detail: { scope, ts: Date.now() } }));
}

export function isDataChangeStorageKey(key: string | null): boolean {
  return key === DATA_CHANGE_STORAGE_KEY;
}

export function parseDataChangePayload(raw: string | null): { scope: DataChangeScope; ts?: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { scope?: DataChangeScope; ts?: number };
    if (!parsed.scope) return null;
    return { scope: parsed.scope, ts: parsed.ts };
  } catch {
    return null;
  }
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
  permissions?: string[];
  session_role?: string | null;
  social_accounts?: Array<{
    provider: string;
    label: string;
    email?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    created_at: string;
    last_login_at: string;
  }>;
};

export function hasAdminSettingsAccess(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  const roles = new Set(user.roles ?? []);
  if (roles.has("admin")) return true;
  if (user.session_role === "admin") return true;
  const permissions = new Set(user.permissions ?? []);
  return permissions.has("settings.global.write") || permissions.has("admin.users.write");
}

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

export const LOGO_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_ACCEPT =
  ".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp";

export type LogoUploadScope = "global_appearance" | "invoice_template" | "receipt_template";

export type LogoUploadResponse = {
  asset_id: number;
  scope: LogoUploadScope;
  logo_url: string;
  thumbnail_url: string | null;
  logo_thumbnail_url: string | null;
  content_type: string;
  size_bytes: number;
  sha256: string;
};

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

function nestedString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = nestedString(item);
      if (match) return match;
    }
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const match = nestedString(entry);
      if (match) return match;
    }
  }
  return undefined;
}

function uploadErrorMessage(status: number, body: unknown): string {
  const detail = nestedString(body);
  return detail || `Upload failed with status ${status}.`;
}

export function validateLogoFile(file: File): string | null {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  const isJpeg = type === "image/jpeg" || type === "image/jpg" || name.endsWith(".jpg") || name.endsWith(".jpeg");
  const isPng = type === "image/png" || name.endsWith(".png");
  const isSvg = type === "image/svg+xml" || name.endsWith(".svg");
  const isWebp = type === "image/webp" || name.endsWith(".webp");
  if (!(isJpeg || isPng || isSvg || isWebp)) {
    return "Unsupported file type. Only JPG, PNG, SVG, and WebP are allowed.";
  }
  if (file.size > LOGO_UPLOAD_MAX_BYTES) {
    return "File too large. Maximum size is 5MB.";
  }
  return null;
}

export function uploadLogoFile({
  endpointPath,
  file,
  scope,
  onProgress,
}: {
  endpointPath: string;
  file: File;
  scope: LogoUploadScope;
  onProgress?: (progress: number) => void;
}): Promise<LogoUploadResponse> {
  return new Promise<LogoUploadResponse>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("scope", scope);

    const xhr = new XMLHttpRequest();
    const token = getAuthToken();
    xhr.open("POST", `${API_BASE_URL}${endpointPath}`);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader("Authorization", `Token ${token}`);
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress?.(Math.round((evt.loaded / evt.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, uploadErrorMessage(xhr.status, payload), payload, { url: endpointPath, method: "POST" }));
        return;
      }
      const data = payload as LogoUploadResponse | null;
      if (!data?.logo_url) {
        reject(new Error("Upload failed"));
        return;
      }
      resolve(data);
    };
    xhr.send(form);
  });
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
