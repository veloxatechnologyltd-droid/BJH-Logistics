import { NewQuote } from "./NewQuote";

export const metadata = { title: "Prepare a quote | BJH Logistics" };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string; customerId?: string }>;
}) {
  const { requestId, customerId } = await searchParams;
  return (
    <NewQuote
      fromRequest={
        requestId && customerId ? { requestId, customerId } : undefined
      }
    />
  );
}
