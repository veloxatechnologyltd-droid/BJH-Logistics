import Link from "next/link";
import { CustomerTabs } from "../CustomerTabs";
import { LeadsBoard } from "./LeadsBoard";
import styles from "../customerDirectory.module.css";

export const metadata = {
  title: "Leads | BJH Logistics",
  description: "Track prospects from first contact to customer.",
};

export default function LeadsPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/">
        <span aria-hidden="true">←</span> Back to overview
      </Link>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Customers</h1>
        </div>
      </header>

      <CustomerTabs active="/customers/leads" />

      <LeadsBoard />
    </main>
  );
}
