import { ReceiptList } from "../ReceiptList";
import { FinanceTabs } from "../../invoices/FinanceTabs";
import styles from "../../jobs/jobs.module.css";

export const metadata = { title: "Receipts | BJH Logistics" };

export default function ReceiptsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Receipts</h1>
      </header>
      <FinanceTabs active="/finance/receipts" />
      <ReceiptList />
    </main>
  );
}
