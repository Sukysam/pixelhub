"use client";

import { useMemo, useRef } from "react";
import { Label } from "@/components/ui/label";
import { LOGO_ACCEPT } from "../lib/logoUpload";

type Props = {
  id: string;
  label: string;
  helpText?: string;
  previewUrl?: string;
  previewAlt: string;
  error?: string | null;
  uploading?: boolean;
  progress?: number;
  disabled?: boolean;
  onFilesSelected: (files: FileList | null) => void | Promise<void>;
};

export function LogoUploadField({
  id,
  label,
  helpText = "JPG, PNG, SVG, WebP. Maximum size 5MB.",
  previewUrl,
  previewAlt,
  error,
  uploading = false,
  progress = 0,
  disabled = false,
  onFilesSelected,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const describedBy = useMemo(() => {
    return [helpText ? `${id}-help` : null, error ? `${id}-error` : null, `${id}-status`].filter(Boolean).join(" ");
  }, [error, helpText, id]);

  const pick = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT}
        className="sr-only"
        aria-describedby={describedBy}
        onChange={(e) => {
          void onFilesSelected(e.target.files);
          e.currentTarget.value = "";
        }}
        disabled={disabled || uploading}
      />
      <button
        type="button"
        className="w-full rounded-md border-2 border-dashed bg-white p-4 text-left text-sm text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled || uploading) return;
          void onFilesSelected(e.dataTransfer.files);
        }}
        aria-describedby={describedBy}
        aria-disabled={disabled || uploading}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Drag and drop or click to upload</div>
            <div id={`${id}-help`} className="text-xs text-gray-500">
              {helpText}
            </div>
          </div>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={previewAlt}
              className="h-14 w-14 rounded border object-contain bg-white"
            />
          ) : (
            <div className="h-14 w-14 rounded border bg-gray-50" aria-hidden="true" />
          )}
        </div>
      </button>
      {uploading ? (
        <div id={`${id}-status`} aria-live="polite" className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-gray-500">Uploading... {progress}%</div>
        </div>
      ) : (
        <div id={`${id}-status`} aria-live="polite" className="text-xs text-gray-500">
          Ready to upload.
        </div>
      )}
      {error ? (
        <div id={`${id}-error`} role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
