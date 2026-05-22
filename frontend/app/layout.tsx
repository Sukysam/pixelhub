import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIXELHUB - Business Management",
  description: "Inventory and Invoice Management System",
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
