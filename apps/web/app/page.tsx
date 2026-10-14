import { PortalRedirect } from "./portal/PortalRedirect";
import { OverviewDashboard } from "./overview/OverviewDashboard";

export default function HomePage() {
  return (
    <>
      <PortalRedirect />

      <OverviewDashboard />
    </>
  );
}
