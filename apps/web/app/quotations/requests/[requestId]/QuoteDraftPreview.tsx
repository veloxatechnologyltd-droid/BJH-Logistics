"use client";

import { useEffect, useState } from "react";
import { formatMoney, getQuote } from "../../../quotes/quoteApi";
import type { Quote, QuoteLine } from "../../../quotes/quoteApi";
import styles from "../../quotation.module.css";

const amountText = (line: QuoteLine, minor: number | null, currency: string) =>
  minor === null
    ? line.basis === "at_cost"
      ? "At cost"
      : "—"
    : `${line.basis === "at_cost" ? "At cost · " : ""}${formatMoney(minor, currency)}`;

/**
 * What the assistant put in a quote, read-only, so the draft can be checked
 * without leaving the inbox. Editing and issuing happen on the quote page.
 */
export function QuoteDraftPreview({ quoteId }: { quoteId: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getQuote(quoteId)
      .then((result) => {
        if (active) setQuote(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The quote could not be loaded",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [quoteId]);

  if (error) return <p className={styles.attachmentNote}>{error}</p>;
  if (!quote) return <p role="status">Loading quote…</p>;

  const version = quote.versions.reduce((latest, item) =>
    item.versionNumber > latest.versionNumber ? item : latest,
  );
  const sized = version.lines.some((line) => line.sizeAmountsMinor !== null);
  const total = version.lines.reduce(
    (sum, line) => sum + (line.amountMinor ?? 0) * line.quantity,
    0,
  );

  return (
    <div className={styles.quotePreview}>
      <p className={styles.quotePreviewTitle}>{version.title}</p>
      {version.shipmentScope && (
        <p className={styles.emailStatus}>{version.shipmentScope}</p>
      )}
      <ul>
        {version.lines.map((line) => (
          <li key={line.id}>
            <span>
              {line.description}
              {line.containerSize ? ` · ${line.containerSize}` : ""}
              {line.quantity > 1 ? ` × ${line.quantity}` : ""}
            </span>
            <strong>
              {line.sizeAmountsMinor
                ? line.sizeAmountsMinor
                    .map(
                      (minor, index) =>
                        `${version.sizeLabels[index] ?? ""} ${amountText(line, minor, version.currency)}`,
                    )
                    .join(" · ")
                : amountText(
                    line,
                    line.amountMinor === null
                      ? null
                      : line.amountMinor * line.quantity,
                    version.currency,
                  )}
            </strong>
          </li>
        ))}
      </ul>
      {!sized && (
        <p className={styles.quotePreviewTotal}>
          Total {formatMoney(total, version.currency)}
          {version.lines.some((line) => line.amountMinor === null)
            ? " (at-cost items are billed as incurred)"
            : ""}
        </p>
      )}
    </div>
  );
}
