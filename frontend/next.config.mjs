/** @type {import('next').NextConfig} */
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] || "";
const isGitHubPages = process.env.GITHUB_PAGES === "1";
const isDev = process.env.NODE_ENV !== "production";
const basePath =
  (process.env.NEXT_PUBLIC_BASE_PATH || "").trim() ||
  (isGitHubPages && repositoryName ? `/${repositoryName}` : "");

const nextConfig = {
  reactStrictMode: true,
  output: isGitHubPages ? "export" : undefined,
  trailingSlash: isGitHubPages,
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    if (isGitHubPages) return [];
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      isDev ? "frame-ancestors *" : "frame-ancestors 'none'",
      "img-src 'self' data: blob: http: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      `connect-src 'self' http: https:${isDev ? " ws: wss:" : ""}`,
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(isDev ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
