import { QuoteDetail } from "../QuoteDetail";

export const metadata = { title: "Quote | BJH Logistics" };

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { quoteId } = await params;
  const { edit } = await searchParams;
  return <QuoteDetail quoteId={quoteId} startEditing={edit === "1"} />;
}
