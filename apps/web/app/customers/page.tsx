import Link from "next/link";
import { CustomerOverview } from "./CustomerOverview";
import { CustomerTabs } from "./CustomerTabs";
import styles from "./customerDirectory.module.css";

export const metadata = {
  title: "Customers | BJH Logistics",
  description: "Customer activity, quotes and revenue at a glance.",
};

export default function CustomersPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/">
        <span aria-hidden="true">←</span> Back to overview
      </Link>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Customers</h1>
          <p className={styles.description}>
            How your customers are doing: activity, quotes and revenue.
          </p>
        </div>
      </header>

      <CustomerTabs active="/customers" />

      <CustomerOverview />
    </main>
  );
}
