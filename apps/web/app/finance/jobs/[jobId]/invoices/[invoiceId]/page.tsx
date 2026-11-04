import { FinanceInvoice } from "../../../../FinanceInvoice";

export const metadata = { title: "Invoice | BJH Logistics" };

export default async function FinanceInvoicePage({
  params,
}: {
  params: Promise<{ jobId: string; invoiceId: string }>;
}) {
  const { jobId, invoiceId } = await params;
  return <FinanceInvoice invoiceId={invoiceId} jobId={jobId} />;
}
