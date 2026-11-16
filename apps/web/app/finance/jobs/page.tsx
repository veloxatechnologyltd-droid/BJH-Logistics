import { redirect } from "next/navigation";

/** The jobs list is gone from Finance; old links and bookmarks land on the overview. */
export default function FinanceJobsPage() {
  redirect("/finance");
}
