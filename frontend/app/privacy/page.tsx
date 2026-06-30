"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Privacy Policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <p>PXL INVOICE processes account, billing, and operational data to provide core platform services such as invoicing, receipts, inventory, and reporting.</p>
            <p>We retain audit and security logs to protect the platform, investigate misuse, and support administrative accountability.</p>
            <p>Authentication data is secured using industry-standard password hashing and role-based access controls.</p>
            <p>
              By creating an account, you consent to the storage and processing needed to operate the service in line with these practices and the{" "}
              <Link href="/terms" prefetch={false} className="text-blue-700 underline">
                Terms of Use
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
