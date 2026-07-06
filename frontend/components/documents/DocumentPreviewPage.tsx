"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest, getErrorMessage } from "@/lib/api";

type DocumentPreviewPageProps = {
  title: string;
  fetchPath: string;
  backHref: string;
  backLabel: string;
};

export function DocumentPreviewPage({ title, fetchPath, backHref, backLabel }: DocumentPreviewPageProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml("");

    apiRequest<string>(fetchPath)
      .then((res) => {
        if (!cancelled) setHtml(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(getErrorMessage(e, `Failed to load ${title.toLowerCase()}.`));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchPath, title]);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-600">Review the printable layout before sharing, saving, or printing.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={backHref}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {backLabel}
            </Link>
            <Button type="button" onClick={() => iframeRef.current?.contentWindow?.print()} disabled={loading || !!error || !html}>
              Print
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {loading ? (
          <div className="rounded-md border bg-white px-4 py-10 text-sm text-gray-600">Loading preview...</div>
        ) : null}
        {!loading && !error ? (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <iframe
              ref={iframeRef}
              title={title}
              aria-label={`${title} frame`}
              className="h-[calc(100vh-180px)] min-h-[720px] w-full bg-white"
              srcDoc={html}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
