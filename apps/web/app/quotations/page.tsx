import Link from "next/link";
import { InquiryTabs } from "./InquiryTabs";
import { RequestInbox } from "./RequestInbox";
import styles from "./quotation.module.css";

export const metadata = {
  title: "Inquiries | BJH Logistics",
  description: "Quote-request inbox for BJH Logistics staff.",
};

export default function QuotationsPage() {
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

      <InquiryTabs active="/quotations" />

      <RequestInbox />
    </main>
  );
}
