import Link from "next/link";
import { CampaignGate } from "../CampaignGate";
import { NewCampaignForm } from "../CampaignForm";
import styles from "../../customers/customerDirectory.module.css";

export const metadata = {
  title: "New campaign | BJH Logistics",
  description: "Say what kind of business to look for and where.",
};

export default function NewCampaignPage() {
  return (
    <CampaignGate>
      <main className={styles.page}>
        <Link className={styles.backLink} href="/campaigns">
          <span aria-hidden="true">←</span> Back to campaigns
        </Link>

        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>New campaign</h1>
            <p className={styles.description}>
              Say what kind of business to look for and where. The search starts
              as soon as you press Find businesses.
            </p>
          </div>
        </header>

        <NewCampaignForm />
      </main>
    </CampaignGate>
  );
}
