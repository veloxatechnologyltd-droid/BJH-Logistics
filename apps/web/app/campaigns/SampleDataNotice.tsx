"use client";

import type { CampaignConfig } from "./campaignApi";
import styles from "./campaigns.module.css";

/** Says so when the businesses are made up (no search account is connected) or no AI scores them. */
export function SampleDataNotice({
  config,
}: {
  config: CampaignConfig | null;
}) {
  if (!config) return null;
  return (
    <>
      {config.sampleData && (
        <p className={styles.banner} role="note">
          <strong>Sample data.</strong> No search account is connected yet, so a
          search finds made-up businesses. Nothing here is a real company, and
          nothing is sent to anyone.
        </p>
      )}
      {config.scorer === "rules" && (
        <p className={styles.banner} role="note">
          <strong>Simple scoring.</strong> The AI is not set up, so each
          business is scored by simple rules (industry, place, rating and
          contact details) instead.
        </p>
      )}
    </>
  );
}
