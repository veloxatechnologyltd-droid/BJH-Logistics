"use client";

import Link from "next/link";
import { canWorkQuotes } from "../../../auth/roleAccess";
import { RemindMe } from "./RemindMe";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { listCustomers } from "../../../customers/customerApi";
import type { CustomerCompany } from "../../../customers/customerApi";
import { useStaffAccess } from "../../../auth/useStaffAccess";
import {
  associateQuoteRequestCustomer,
  getQuoteRequest,
  requestSourceLabels,
} from "../../quoteRequestApi";
import type { QuoteRequest } from "../../quoteRequestApi";
import styles from "../../quotation.module.css";
import { ErrorPopup, plainMessage } from "../../../ErrorPopup";
import { tidyMessage } from "../../../messageText";
import { AssistantPanel } from "./AssistantPanel";
import { EmailRequestPanel } from "./EmailRequestPanel";
import { QuoteDraftPreview } from "./QuoteDraftPreview";

type LoadState = "loading" | "ready" | "error";
export type DetailTab = "email" | "reply" | "details";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));

/**
 * One email or request, opened. The header says who and when; the tabs keep
 * the email, the reply (draft or thread) and the quote (draft) apart instead
 * of stacking them on one page. `embedded` is the reading pane of the inbox;
 * on its own (the page a notice links to) it has a back link and a heading.
 */
export function QuoteRequestDetail({
  requestId: given,
  embedded = false,
  initialTab = "email",
  onChanged,
}: {
  requestId?: string;
  embedded?: boolean;
  initialTab?: DetailTab;
  /** Called with the request after anything on it changed, so a list can update its row. */
  onChanged?: (request: QuoteRequest) => void;
}) {
  const staffAccess = useStaffAccess();
  const params = useParams<{ requestId: string }>();
  const requestId = given ?? params.requestId;
  const [request, setRequest] = useState<QuoteRequest | null>(null);
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [customerLoadError, setCustomerLoadError] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linking, setLinking] = useState(false);
  const [tab, setTab] = useState<DetailTab>(initialTab);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    getQuoteRequest(requestId)
      .then((result) => {
        if (active) {
          setRequest(result);
          setLoadState("ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The request could not be loaded",
          );
          setLoadState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [requestId]);

  // Only the super admin links an unlinked request, so only then are the customers needed.
  const canPickCustomer =
    staffAccess.isSuperAdmin && request !== null && !request.customerCompanyId;
  useEffect(() => {
    if (!canPickCustomer) return;
    let active = true;
    listCustomers("")
      .then((results) => {
        if (active) {
          setCustomers(results);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setCustomerLoadError(
            cause instanceof Error
              ? cause.message
              : "Customer records could not be loaded",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [canPickCustomer]);

  // The customer whose contact wrote the email is offered first; a person still presses Link.
  const suggestedCustomerId = request?.suggestedCustomer?.id;
  useEffect(() => {
    if (suggestedCustomerId) setSelectedCustomerId(suggestedCustomerId);
  }, [suggestedCustomerId]);

  function update(next: QuoteRequest) {
    setRequest(next);
    onChanged?.(next);
  }

  async function linkCustomer() {
    if (!selectedCustomerId || linking) {
      return;
    }

    setLinking(true);
    setLinkError("");
    try {
      update(
        await associateQuoteRequestCustomer(requestId, selectedCustomerId),
      );
    } catch (cause) {
      setLinkError(
        cause instanceof Error
          ? cause.message
          : "The request could not be linked to the customer",
      );
    } finally {
      setLinking(false);
    }
  }

  const isInquiry = request?.mailbox === "inquiries";
  const intake = request?.intake ?? null;
  const reply = intake?.reply ?? null;
  const hasReplyTab = Boolean(intake && intake.extractionStatus === "done");
  const needsCheck = Boolean(
    intake && intake.extractionStatus === "done" && !intake.reviewedAt,
  );
  // What is waiting on a person, shown on the tab that holds it.
  const replyBadge = reply ? (reply.sentAt ? "Sent" : "Draft") : null;
  const detailsBadge =
    request?.quoteStatus === "draft"
      ? "Draft"
      : request?.quoteStatus === "issued"
        ? "Issued"
        : needsCheck
          ? "Check"
          : null;
  const tabs: Array<{ key: DetailTab; label: string; badge: string | null }> = [
    { key: "email", label: "Email", badge: null },
    ...(hasReplyTab
      ? [{ key: "reply" as const, label: "Reply", badge: replyBadge }]
      : []),
    {
      key: "details",
      label: isInquiry ? "Details" : "Quote",
      badge: detailsBadge,
    },
  ];
  const shownTab = tabs.some((entry) => entry.key === tab) ? tab : "email";
  const Root = embedded ? "div" : "main";

  return (
    <Root className={embedded ? styles.readerBody : styles.page}>
      {!embedded && (
        <>
          <Link
            className={styles.backLink}
            href={isInquiry ? "/inquiries" : "/quotations"}
          >
            <span aria-hidden="true">←</span>{" "}
            {isInquiry ? "Back to inquiries" : "Back to request inbox"}
          </Link>
          <header className={styles.pageHeader}>
            <h1>{isInquiry ? "Inquiry" : "Quote request"}</h1>
          </header>
        </>
      )}

      {loadState === "loading" && (
        <div className={styles.statePanel} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <h3>Loading request</h3>
        </div>
      )}

      {loadState === "error" && (
        <div className={styles.errorPanel}>
          <ErrorPopup message={error} />
          <span className={styles.errorIcon} aria-hidden="true">
            !
          </span>
          <div>
            <h3>Request could not be loaded</h3>
            <p>{plainMessage(error)}</p>
          </div>
        </div>
      )}

      {loadState === "ready" && request && (
        <article className={styles.requestDetail}>
          <header className={styles.readerHeader}>
            <div className={styles.readerTitle}>
              <h2>{intake?.subject || request.companyName}</h2>
              <p>
                <strong>{intake?.fromName || request.contactName}</strong> &lt;
                {intake?.fromEmail ?? request.email}&gt; ·{" "}
                {formatDate(intake?.receivedAt ?? request.createdAt)} ·{" "}
                {request.source
                  ? requestSourceLabels[request.source]
                  : "Earlier request"}
              </p>
              <p>
                {request.customerCompanyId && request.customerCompanyName ? (
                  <>
                    Customer:{" "}
                    <Link href={`/customers/${request.customerCompanyId}`}>
                      {request.customerCompanyName}
                    </Link>
                  </>
                ) : (
                  <>
                    No customer linked yet
                    {request.suggestedCustomer
                      ? ` (the sender is a contact of ${request.suggestedCustomer.companyName})`
                      : ""}
                  </>
                )}
              </p>
            </div>
            {staffAccess.roles.length > 0 && (
              <RemindMe requestId={request.id} />
            )}
          </header>

          <div className={styles.readerTabs} role="tablist">
            {tabs.map((entry) => (
              <button
                aria-selected={shownTab === entry.key}
                className={`${styles.inboxTab}${shownTab === entry.key ? ` ${styles.inboxTabActive}` : ""}`}
                key={entry.key}
                onClick={() => setTab(entry.key)}
                role="tab"
                type="button"
              >
                {entry.label}
                {entry.badge && (
                  <span
                    className={`${styles.tabBadge}${entry.badge === "Sent" || entry.badge === "Issued" ? ` ${styles.tabBadgeDone}` : ""}`}
                  >
                    {entry.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {shownTab === "email" && (
            <>
              <section
                className={styles.messagePanel}
                aria-labelledby="message-title"
              >
                <h3 id="message-title">Request message</h3>
                <p>{tidyMessage(request.message)}</p>
              </section>
              <EmailRequestPanel
                canEdit={request.canCheck === true}
                onChange={(next) =>
                  update({
                    ...next,
                    suggestedCustomer: request.suggestedCustomer,
                  })
                }
                part="email"
                request={request}
              />
            </>
          )}

          {shownTab === "reply" && (
            <AssistantPanel
              canEdit={request.canCheck === true}
              canMove={staffAccess.roles.length > 0}
              onChange={(next) =>
                update({
                  ...next,
                  canCheck: next.canCheck ?? request.canCheck,
                  suggestedCustomer: request.suggestedCustomer,
                })
              }
              request={request}
            />
          )}

          {shownTab === "details" && (
            <>
              {!isInquiry && (
                <section
                  aria-labelledby="quote-draft-title"
                  className={styles.emailPanel}
                >
                  <h3 id="quote-draft-title">Quote</h3>
                  {request.quoteId ? (
                    <>
                      <div className={styles.quoteCard}>
                        <span>
                          {request.quoteStatus === "issued"
                            ? `Quote ${request.quoteNumber ?? ""} was issued.`
                            : `Draft quote${request.quoteNumber ? ` ${request.quoteNumber}` : ""} is waiting for approval.`}
                        </span>
                        <span className={styles.quoteActions}>
                          {request.quoteStatus !== "issued" && (
                            <Link
                              className={styles.secondaryButton}
                              href={`/quotes/${request.quoteId}?edit=1`}
                            >
                              Edit draft
                            </Link>
                          )}
                          <Link
                            className={styles.primaryButton}
                            href={`/quotes/${request.quoteId}`}
                          >
                            {request.quoteStatus === "issued"
                              ? "View quote"
                              : "Check and issue"}
                          </Link>
                        </span>
                      </div>
                      <QuoteDraftPreview
                        key={`${request.quoteId}-${request.quoteStatus}`}
                        quoteId={request.quoteId}
                      />
                    </>
                  ) : !request.customerCompanyId ? (
                    <p className={styles.emailStatus}>
                      Link this request to a customer record before preparing a
                      quote.
                    </p>
                  ) : canWorkQuotes(staffAccess.roles) ? (
                    <div className={styles.quoteCard}>
                      <span>No quote has been prepared for this request. </span>
                      <Link
                        className={styles.primaryButton}
                        href={`/quotes/new?requestId=${request.id}&customerId=${request.customerCompanyId}`}
                      >
                        Create quote
                      </Link>
                    </div>
                  ) : (
                    <p className={styles.emailStatus}>
                      No quote has been prepared for this request.
                    </p>
                  )}
                </section>
              )}
              <EmailRequestPanel
                canEdit={request.canCheck === true}
                onChange={(next) =>
                  update({
                    ...next,
                    suggestedCustomer: request.suggestedCustomer,
                  })
                }
                part="details"
                request={request}
              />
              <section
                className={styles.customerLinkPanel}
                aria-labelledby="customer-link-title"
              >
                <h3 id="customer-link-title">Customer record</h3>
                {request.customerCompanyId && request.customerCompanyName ? (
                  <p>
                    Linked to{" "}
                    <Link href={`/customers/${request.customerCompanyId}`}>
                      {request.customerCompanyName}
                    </Link>
                  </p>
                ) : !staffAccess.isSuperAdmin ? null : customerLoadError ? (
                  <ErrorPopup message={customerLoadError} />
                ) : customers.length === 0 ? (
                  <p>
                    Create a customer record before linking this request.{" "}
                    <Link href="/customers/new">Create customer</Link>
                  </p>
                ) : (
                  <div className={styles.customerLinkActions}>
                    {request.suggestedCustomer && (
                      <p>
                        The sender is a contact of{" "}
                        {request.suggestedCustomer.companyName}.
                      </p>
                    )}
                    <label htmlFor="request-customer">Link to company</label>
                    <select
                      id="request-customer"
                      onChange={(event) =>
                        setSelectedCustomerId(event.target.value)
                      }
                      value={selectedCustomerId}
                    >
                      <option value="">Choose a customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.companyName}
                        </option>
                      ))}
                    </select>
                    <button
                      className={styles.secondaryButton}
                      disabled={!selectedCustomerId || linking}
                      onClick={() => void linkCustomer()}
                      type="button"
                    >
                      {linking ? "Linking…" : "Link customer"}
                    </button>
                  </div>
                )}
                <ErrorPopup message={linkError} />
              </section>
            </>
          )}
        </article>
      )}
    </Root>
  );
}
