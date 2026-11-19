import Link from "next/link";
import { Suspense } from "react";
import { InquiryTabs } from "../quotations/InquiryTabs";
import { RequestInbox } from "../quotations/RequestInbox";
import styles from "../quotations/quotation.module.css";

export const metadata = {
  title: "Inquiries | BJH Logistics",
  description: "Questions sent to BJH's inquiries address.",
};

export default function InquiriesPage() {
  return (
    <main className={`${styles.page} ${styles.pageWide}`}>
      <Link className={styles.backLink} href="/">
        <span aria-hidden="true">←</span> Back to overview
      </Link>

      <header className={styles.pageHeader}>
        <div>
          <h1>Inquiries</h1>
        </div>
      </header>

      <InquiryTabs active="/inquiries" />

      <Suspense fallback={null}>
        <RequestInbox mailbox="inquiries" />
      </Suspense>
    </main>
  );
}
