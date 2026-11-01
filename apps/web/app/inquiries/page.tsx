import Link from "next/link";
import { RequestInbox } from "../quotations/RequestInbox";
import styles from "../quotations/quotation.module.css";

export const metadata = {
  title: "Inquiries | BJH Logistics",
  description: "Questions sent to BJH's inquiries address.",
};

export default function InquiriesPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/">
        <span aria-hidden="true">←</span> Back to overview
      </Link>

      <header className={styles.pageHeader}>
        <div>
          <h1>Inquiries</h1>
        </div>
      </header>

      <RequestInbox mailbox="inquiries" />
    </main>
  );
}
