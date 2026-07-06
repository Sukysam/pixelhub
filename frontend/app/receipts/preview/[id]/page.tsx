import { DocumentPreviewPage } from "@/components/documents/DocumentPreviewPage";

type ReceiptPreviewPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ReceiptPreviewPage({ params }: ReceiptPreviewPageProps) {
  const { id } = await params;
  return (
    <DocumentPreviewPage
      title="Receipt Preview"
      fetchPath={`/receipts/${id}/print_html/`}
      backHref="/receipts"
      backLabel="Back to Receipts"
    />
  );
}
