"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canReadInvoices } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { fetchReceiptPdf, listReceipts, sendReceipt } from "../jobs/jobApi";
import type { Receipt } from "../jobs/jobApi";
import { methodLabels } from "../jobs/JobInvoices";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/**
 * Numbered receipts for recorded payments. Finance and customer service see
 * every customer's and can email one; a customer sees their own to download.
 */
export function ReceiptList() {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const canSend = canReadInvoices(roles);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    listReceipts()
      .then(setReceipts)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Receipts could not be loaded",
        ),
      );
  }, []);

  async function open(receipt: Receipt) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchReceiptPdf(
          receipt.jobId,
          receipt.invoiceId,
          receipt.paymentId,
        ),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  async function email(receipt: Receipt) {
    setError("");
    setNotice("");
    try {
      await sendReceipt(receipt.jobId, receipt.invoiceId, receipt.paymentId);
      setNotice(
        `Receipt ${receipt.receiptNumber} is on its way to the client.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="receipts-title">
      <h2 id="receipts-title">{isStaff ? "Receipts" : "Your receipts"}</h2>
      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}
      {receipts === null && !error && <p role="status">Loading receipts…</p>}
      {receipts?.length === 0 && (
        <p className={styles.muted}>No receipts yet.</p>
      )}
      {receipts && receipts.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Receipt</th>
                <th scope="col">Received</th>
                {isStaff && <th scope="col">Customer</th>}
                <th scope="col">Job</th>
                <th scope="col">Invoice</th>
                <th scope="col">Amount</th>
                <th scope="col">Method</th>
                <th aria-label="Actions" scope="col" />
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => (
                <tr key={receipt.paymentId}>
                  <th scope="row">
                    {receipt.receiptNumber}
                    {receipt.reversed && (
                      <span className={styles.badge}> Reversed</span>
                    )}
                  </th>
                  <td>{receipt.receivedOn}</td>
                  {isStaff && <td>{receipt.customerCompanyName}</td>}
                  <td>
                    <Link
                      className={styles.link}
                      href={`/jobs/${receipt.jobId}/money`}
                    >
                      {receipt.fileNumber}
                    </Link>
                  </td>
                  <td>{receipt.invoiceNumber}</td>
                  <td>{formatMoney(receipt.amountMinor, receipt.currency)}</td>
                  <td>{methodLabels[receipt.method]}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={styles.textButton}
                        onClick={() => void open(receipt)}
                        type="button"
                      >
                        Print
                      </button>
                      {canSend && !receipt.reversed && (
                        <button
                          className={styles.textButton}
                          onClick={() => void email(receipt)}
                          type="button"
                        >
                          Email to client
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
