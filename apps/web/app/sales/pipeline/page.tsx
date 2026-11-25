import { LeadsBoard } from "../../customers/leads/LeadsBoard";

export const metadata = {
  title: "Pipeline | BJH Logistics",
  description:
    "Follow the businesses your campaigns found, from first contact to customer.",
};

/** Leads found by campaigns only. Leads added by hand stay on Customers, Leads. */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  return <LeadsBoard pipeline="generated" initialSearch={search} />;
}
