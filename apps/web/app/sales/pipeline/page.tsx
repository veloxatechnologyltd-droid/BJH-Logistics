import { LeadsBoard } from "../../customers/leads/LeadsBoard";

export const metadata = {
  title: "Pipeline | BJH Logistics",
  description:
    "Follow the businesses your campaigns found, from first contact to customer.",
};

/** Leads found by campaigns only. Leads added by hand stay on Customers, Leads. */
export default function PipelinePage() {
  return <LeadsBoard pipeline="generated" />;
}
