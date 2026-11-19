import { redirect } from "next/navigation";

// The reports moved to /performance; keep old links working.
export default function OldReportsPage() {
  redirect("/performance");
}
