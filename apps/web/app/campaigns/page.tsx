import Link from "next/link";
import { CampaignGate } from "./CampaignGate";
import { CampaignsList } from "./CampaignsList";
import styles from "../customers/customerDirectory.module.css";
import ui from "../jobs/jobs.module.css";

export const metadata = {
  title: "Campaigns | BJH Logistics",
  description: "Find new businesses to sell to and add the good ones to Leads.",
};

export default function CampaignsPage() {
  return (
    <CampaignGate>
      <main className={styles.page}>
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span> Back to overview
        </Link>

        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Campaigns</h1>
            <p className={styles.description}>
              Find new businesses to sell to, see how well each one fits, and
              add the good ones to Leads.
            </p>
          </div>
          <Link className={ui.primaryLink} href="/campaigns/new">
            New campaign
          </Link>
        </header>

        <CampaignsList />
      </main>
    </CampaignGate>
  );
}
