import { TeamPerformance } from "./TeamPerformance";

export const metadata = {
  title: "Team performance | BJH Logistics",
  description: "What each member of staff has done, by day, week or month.",
};

export default function PerformancePage() {
  return <TeamPerformance />;
}
