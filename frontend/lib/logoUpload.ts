import { API_BASE_URL, ApiError, getAuthToken } from "@/lib/api";

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

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = firstString(item);
      if (match) return match;
    }
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const match = firstString(entry);
      if (match) return match;
    }
  }
  return undefined;
}

function uploadErrorMessage(status: number, body: unknown): string {
  const detail = firstString(body);
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
