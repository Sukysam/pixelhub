import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PXL INVOICE - Business Management",
  description: "Inventory and Invoice Management System",
  applicationName: "PXL INVOICE",
  openGraph: {
    title: "PXL INVOICE - Business Management",
    description: "Inventory and Invoice Management System",
    siteName: "PXL INVOICE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PXL INVOICE - Business Management",
    description: "Inventory and Invoice Management System",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
