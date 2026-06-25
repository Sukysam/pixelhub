"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Terms of Use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <p>PIXELHUB is provided for lawful business record keeping, invoicing, inventory tracking, and reporting activities.</p>
            <p>You are responsible for the accuracy of the information you enter and for maintaining the confidentiality of your account credentials.</p>
            <p>Administrative tools are restricted to authorized users only. Attempts to access or misuse protected features may result in account suspension.</p>
            <p>
              Questions about these terms can be directed through the support channels published on the platform. You can also review the{" "}
              <Link href="/privacy" prefetch={false} className="text-blue-700 underline">
                Privacy Policy
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
