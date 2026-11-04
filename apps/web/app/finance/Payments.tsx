"use client";

import { useEffect, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { FinanceTabs } from "../invoices/FinanceTabs";
import styles from "../jobs/jobs.module.css";
import { ReceiptList } from "./ReceiptList";
import { RecordPayment } from "./RecordPayment";

/**
 * Finance → Payments: every payment received, each with its receipt, and the
 * one place payments are recorded. "Record payment" links elsewhere arrive
 * with ?pay=<customer id> and/or ?invoice=<invoice id> and open the form
 * with that customer or invoice already chosen; &all=1 also ticks all the
 * customer owes (the Invoices page's "Pay all").
 */
export function Payments() {
  const { roles } = useStaffAccess();
  const [reloadKey, setReloadKey] = useState(0);
  const [link, setLink] = useState<{
    companyId?: string;
    invoiceId?: string;
    payAll?: boolean;
  } | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setLink({
      companyId: query.get("pay") || undefined,
      invoiceId: query.get("invoice") || undefined,
      payAll: query.get("all") === "1",
    });
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Payments</h1>
        {canWorkFinance(roles) && link && (
          <RecordPayment
            companyId={link.companyId}
            invoiceId={link.invoiceId}
            payAll={link.payAll}
            onRecorded={() => setReloadKey((key) => key + 1)}
            startOpen={Boolean(link.companyId || link.invoiceId)}
          />
        )}
      </header>
      <FinanceTabs active="/finance/receipts" />
      <ReceiptList reloadKey={reloadKey} />
    </main>
  );
}
