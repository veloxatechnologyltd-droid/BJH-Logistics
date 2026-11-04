import { FinanceJob } from "../../FinanceJob";

export const metadata = { title: "Job billing | BJH Logistics" };

export default async function FinanceJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <FinanceJob jobId={jobId} />;
}
