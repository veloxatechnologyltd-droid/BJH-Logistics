import { FinanceClientInvoice } from "../../../../FinanceClientInvoice";

export const metadata = { title: "Invoice | BJH Logistics" };

export default async function FinanceClientInvoicePage({
  params,
}: {
  params: Promise<{ companyId: string; invoiceId: string }>;
}) {
  const { companyId, invoiceId } = await params;
  return <FinanceClientInvoice companyId={companyId} invoiceId={invoiceId} />;
}
