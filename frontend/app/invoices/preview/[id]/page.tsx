import { DocumentPreviewPage } from "@/components/documents/DocumentPreviewPage";

type InvoicePreviewPageProps = {
  params: Promise<{ id: string }>;
};

export default async function InvoicePreviewPage({ params }: InvoicePreviewPageProps) {
  const { id } = await params;
  return (
    <DocumentPreviewPage
      title="Invoice Preview"
      fetchPath={`/invoices/${id}/print_html/`}
      backHref="/invoices/manage"
      backLabel="Back to Manage Invoices"
    />
  );
}
