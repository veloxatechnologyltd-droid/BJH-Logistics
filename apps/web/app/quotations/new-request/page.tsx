import Link from "next/link";
import { RequestComposer } from "../RequestComposer";
import styles from "../quotation.module.css";

export const metadata = {
  title: "New quote request | BJH Logistics",
  description: "Create a quote request for the staff inbox.",
};

export default function NewRequestPreviewPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/quotations">
        <span aria-hidden="true">←</span> Back to request inbox
      </Link>

      <header className={styles.pageHeader}>
        <div>
          <h1>Quotation request intake</h1>
        </div>
      </header>

      <RequestComposer />
    </main>
  );
}
