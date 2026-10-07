import Link from "next/link";
import { CustomerDirectory } from "./CustomerDirectory";
import { CustomerTabs } from "./CustomerTabs";
import styles from "./customerDirectory.module.css";

export const metadata = {
  title: "Customers | BJH Logistics",
  description: "Manage customer company and contact records.",
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
            Manage customer companies, contacts, and account details.
          </p>
        </div>
      </header>

      <CustomerTabs active="/customers" />

      <CustomerDirectory />
    </main>
  );
}
