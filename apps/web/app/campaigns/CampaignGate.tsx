"use client";

import type { ReactNode } from "react";
import { useStaffAccess } from "../auth/useStaffAccess";
import { canUseLeadGeneration } from "../auth/roleAccess";
import ui from "../jobs/jobs.module.css";

/** The campaign screens are for sales, customer service and the super admin, as in the API. */
export function CampaignGate({ children }: { children: ReactNode }) {
  const { status, roles } = useStaffAccess();
  if (status === "loading") return null;
  if (!canUseLeadGeneration(roles)) {
    return (
      <main className={ui.page}>
        <h1 className={ui.title}>Campaigns</h1>
        <p className={ui.muted}>
          Campaigns are for sales, customer service and the super admin. Ask
          your administrator if you need them.
        </p>
      </main>
    );
  }
  return <>{children}</>;
}
