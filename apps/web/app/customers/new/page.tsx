import Link from "next/link";
import { CustomerCreateForm } from "../CustomerCreateForm";
import styles from "../customerDirectory.module.css";

export const metadata = {
  title: "New customer | BJH Logistics",
  description: "Create a customer company and primary contact.",
};

export default function NewCustomerPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/customers">
        <span aria-hidden="true">←</span> Back to customers
      </Link>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>New customer</h1>
        </div>
      </header>

      <CustomerCreateForm />
    </main>
  );
}
