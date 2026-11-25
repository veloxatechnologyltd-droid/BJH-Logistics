"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useStaffAccess } from "../../auth/useStaffAccess";
import { canWorkFinance } from "../../auth/roleAccess";
import { ClientJobReport } from "./ClientJobReport";
import { JobReport } from "./JobReport";
import { customerActiveDays } from "@bjh/contracts";
import {
  addContact,
  getCustomer,
  getCustomerInsight,
  updateContact,
  updateCustomer,
} from "../customerApi";
import type { CustomerCompany, CustomerInsight } from "../customerApi";
import { listJobs, serviceLineLabels, statusLabels } from "../../jobs/jobApi";
import type { Job } from "../../jobs/jobApi";
import { formatMoney } from "../../quotes/quoteApi";
import type { CustomerContactUpdate } from "@bjh/contracts";
import { listQuoteRequests } from "../../quotations/quoteRequestApi";
import type { QuoteRequest } from "../../quotations/quoteRequestApi";
import styles from "./customerProfile.module.css";
import { ErrorPopup, plainMessage } from "../../ErrorPopup";

type LoadState = "loading" | "ready" | "error";

const shortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GH", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/** Profile details that are rarely needed, kept out of the way until recorded. */
const extraFields = [
  ["tradingName", "Trading name"],
  ["registrationNumber", "Registration number"],
  ["taxNumber", "Tax / TIN number"],
  ["companyEmail", "Company email"],
  ["website", "Website"],
  ["billingAddress", "Billing address (if different)"],
] as const;

export function CustomerProfileDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const [customer, setCustomer] = useState<CustomerCompany | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequest[]>([]);
  const [historyState, setHistoryState] = useState<LoadState>("loading");
  const [historyError, setHistoryError] = useState("");
  // Account figures and jobs are staff-only; they simply stay hidden if unavailable.
  const [insight, setInsight] = useState<CustomerInsight | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const { isSuperAdmin, roles } = useStaffAccess();
  const [contactError, setContactError] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newPrimary, setNewPrimary] = useState(false);
  const [editingCompany, setEditingCompany] = useState(false);
  const [profileError, setProfileError] = useState("");

  async function changeContact(
    contactId: string,
    update: CustomerContactUpdate & { notify: boolean },
  ) {
    setContactError("");
    try {
      await updateContact(customerId, contactId, update);
      setCustomer(await getCustomer(customerId));
    } catch (cause) {
      setContactError(
        cause instanceof Error
          ? cause.message
          : "The contact could not be saved",
      );
    }
  }

  async function submitContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const addContactDetails = event.currentTarget.closest("details");
    setContactError("");
    try {
      await addContact(customerId, {
        name: newName.trim(),
        email: newEmail.trim(),
        phone: newPhone.trim() || null,
        role: newRole.trim() || null,
        isPrimary: newPrimary,
      });
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewRole("");
      setNewPrimary(false);
      setCustomer(await getCustomer(customerId));
      if (addContactDetails) addContactDetails.open = false;
    } catch (cause) {
      setContactError(
        cause instanceof Error
          ? cause.message
          : "The contact could not be added",
      );
    }
  }

  async function saveCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "");
    setProfileError("");
    try {
      setCustomer(
        await updateCustomer(customerId, {
          companyName: value("companyName"),
          tradingName: value("tradingName"),
          registrationNumber: value("registrationNumber"),
          taxNumber: value("taxNumber"),
          phone: value("phone"),
          companyEmail: value("companyEmail"),
          website: value("website"),
          businessAddress: value("businessAddress"),
          billingAddress: value("billingAddress"),
          country: value("country"),
        }),
      );
      setEditingCompany(false);
    } catch (cause) {
      setProfileError(
        cause instanceof Error
          ? cause.message
          : "The company profile could not be saved",
      );
    }
  }

  async function submitContactUpdate(
    event: React.FormEvent<HTMLFormElement>,
    contactId: string,
  ) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "");
    await changeContact(contactId, {
      name: value("name"),
      role: value("role"),
      email: value("email"),
      phone: value("phone"),
      notify: values.has("notify"),
      isPrimary: values.has("isPrimary"),
    });
  }

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    getCustomer(customerId)
      .then((result) => {
        if (active) {
          setCustomer(result);
          setLoadState("ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The customer could not be loaded",
          );
          setLoadState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [customerId]);

  useEffect(() => {
    let active = true;
    setInsight(null);
    setJobs(null);
    getCustomerInsight(customerId)
      .then((result) => active && setInsight(result))
      .catch(() => undefined);
    listJobs("")
      .then(
        (all) =>
          active &&
          setJobs(all.filter((job) => job.customerCompanyId === customerId)),
      )
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [customerId]);

  useEffect(() => {
    let active = true;
    setHistoryState("loading");
    listQuoteRequests(customerId)
      .then((results) => {
        if (active) {
          setQuoteRequests(results);
          setHistoryState("ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setHistoryError(
            cause instanceof Error
              ? cause.message
              : "Customer history could not be loaded",
          );
          setHistoryState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [customerId]);

  const extraDetails = extraFields.filter(([name]) => customer?.[name]);

  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/contacts">
        <span aria-hidden="true">←</span> Back to address book
      </Link>

      <header className={styles.pageHeader}>
        <div>
          {customer && (
            <p className={styles.customerNumber}>
              Customer ID · {customer.customerNumber}
            </p>
          )}
          <h1>{customer?.companyName ?? "Customer profile"}</h1>
        </div>
      </header>

      {loadState === "loading" && (
        <div className={styles.emptyState} role="status" aria-live="polite">
          <h2>Loading customer</h2>
        </div>
      )}

      {loadState === "error" && (
        <div className={styles.emptyState}>
          <ErrorPopup message={error} />
          <h2>Customer could not be loaded</h2>
          <p>{plainMessage(error)}</p>
        </div>
      )}

      {loadState === "ready" && customer && insight && (
        <section className={styles.summary} aria-label="Account summary">
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span>Status</span>
              <strong>{insight.active ? "Active" : "Inactive"}</strong>
              <small>
                {insight.active
                  ? "A job still open or opened recently"
                  : `No job in the last ${customerActiveDays} days`}
              </small>
            </div>
            <div className={styles.summaryItem}>
              <span>Jobs</span>
              <strong>{insight.totalJobs}</strong>
              <small>{insight.activeJobs} still open</small>
            </div>
            <div className={styles.summaryItem}>
              <span>Latest job</span>
              <strong>{shortDate(insight.lastJobAt)}</strong>
              <small>Opened</small>
            </div>
            <div className={styles.summaryItem}>
              <span>Quotes</span>
              <strong>
                {insight.quotesAccepted} of {insight.quotesSent}
              </strong>
              <small>
                accepted · {insight.quotesAwaiting} awaiting an answer
              </small>
            </div>
            <div className={styles.summaryItem}>
              <span>Last contact</span>
              <strong>{shortDate(insight.lastContactAt)}</strong>
              <small>Message sent or call logged</small>
            </div>
          </div>
          {insight.money.length > 0 && (
            <table className={styles.moneyTable} data-cards>
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">Invoiced</th>
                  <th scope="col">Received</th>
                  <th scope="col">Owing</th>
                  <th scope="col">Average days to pay</th>
                </tr>
              </thead>
              <tbody>
                {insight.money.map((entry) => (
                  <tr key={entry.currency}>
                    <th scope="row">{entry.currency}</th>
                    <td data-label="Invoiced">
                      {formatMoney(entry.invoicedMinor, entry.currency)}
                    </td>
                    <td data-label="Received">
                      {formatMoney(entry.receivedMinor, entry.currency)}
                    </td>
                    <td data-label="Owing">
                      {formatMoney(
                        entry.invoicedMinor - entry.receivedMinor,
                        entry.currency,
                      )}
                    </td>
                    <td data-label="Average days to pay">
                      {entry.averageDaysToPay === null
                        ? "—"
                        : `${entry.averageDaysToPay} days`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {loadState === "ready" && customer && (
        <>
          <section
            className={styles.contactCard}
            aria-labelledby="company-title"
          >
            <div className={styles.cardHeading}>
              <div>
                <p className={styles.sectionEyebrow}>CLIENT RECORD</p>
                <h2 id="company-title">Company details</h2>
              </div>
              {isSuperAdmin && !editingCompany && (
                <button onClick={() => setEditingCompany(true)} type="button">
                  Edit company details
                </button>
              )}
            </div>
            <ErrorPopup message={profileError} />
            {editingCompany ? (
              <form className={styles.profileForm} onSubmit={saveCompany}>
                <div className={`${styles.profileFields} ${styles.alignStart}`}>
                  <label className={styles.profileField}>
                    Company name
                    <input
                      defaultValue={customer.companyName}
                      maxLength={160}
                      name="companyName"
                      required
                    />
                  </label>
                  <label className={styles.profileField}>
                    Phone
                    <input
                      defaultValue={customer.phone ?? ""}
                      maxLength={40}
                      name="phone"
                      type="tel"
                    />
                  </label>
                  <label className={styles.profileField}>
                    Country
                    <input
                      defaultValue={customer.country ?? ""}
                      maxLength={100}
                      name="country"
                    />
                  </label>
                  <label className={styles.profileField}>
                    Address
                    <textarea
                      defaultValue={customer.businessAddress ?? ""}
                      maxLength={1000}
                      name="businessAddress"
                      rows={3}
                    />
                  </label>
                </div>
                {/* Rarely needed; still saved with the form when closed. */}
                <details
                  className={styles.moreDetails}
                  open={extraDetails.length > 0}
                >
                  <summary>More details (optional)</summary>
                  <div
                    className={`${styles.profileFields} ${styles.alignStart}`}
                  >
                    {extraFields.map(([name, label]) => (
                      <label className={styles.profileField} key={name}>
                        {label}
                        {name === "billingAddress" ? (
                          <textarea
                            defaultValue={customer[name] ?? ""}
                            maxLength={1000}
                            name={name}
                            rows={3}
                          />
                        ) : (
                          <input
                            defaultValue={customer[name] ?? ""}
                            maxLength={
                              name === "companyEmail"
                                ? 254
                                : name === "website"
                                  ? 300
                                  : name === "tradingName"
                                    ? 160
                                    : 120
                            }
                            name={name}
                            type={name === "companyEmail" ? "email" : "text"}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </details>
                <div className={styles.profileActions}>
                  <button
                    onClick={() => setEditingCompany(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button type="submit">Save company details</button>
                </div>
              </form>
            ) : (
              <dl className={styles.companyGrid}>
                <div>
                  <dt>Company name</dt>
                  <dd>{customer.companyName}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{customer.phone ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Country</dt>
                  <dd>{customer.country ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{customer.businessAddress ?? "Not recorded"}</dd>
                </div>
                {/* The optional details appear only once recorded. */}
                {extraDetails.map(([name, label]) => (
                  <div key={name}>
                    <dt>{label}</dt>
                    <dd>{customer[name]}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section
            className={styles.contactCard}
            aria-labelledby="contact-title"
          >
            <div className={styles.cardHeading}>
              <div>
                <p className={styles.sectionEyebrow}>PROFILE</p>
                <h2 id="contact-title">Contacts</h2>
              </div>
            </div>
            <dl className={styles.contactGrid}>
              {customer.contacts.map((contact) => (
                <div key={contact.id}>
                  <dt>
                    {contact.name}
                    {contact.isPrimary ? " · Primary contact" : ""}
                  </dt>
                  {contact.role && <dd>{contact.role}</dd>}
                  <dd>{contact.email}</dd>
                  <dd>{contact.phone ?? "No phone number"}</dd>
                  <dd>
                    {contact.notify
                      ? "Receives customer messages"
                      : "Messages switched off"}
                  </dd>
                  {isSuperAdmin && (
                    <dd>
                      <details>
                        <summary>Edit contact</summary>
                        <form
                          className={styles.profileForm}
                          onSubmit={(event) =>
                            void submitContactUpdate(event, contact.id)
                          }
                        >
                          <label className={styles.profileField}>
                            Full name
                            <input
                              defaultValue={contact.name}
                              maxLength={160}
                              name="name"
                              required
                            />
                          </label>
                          <label className={styles.profileField}>
                            Job title / responsibility
                            <input
                              defaultValue={contact.role ?? ""}
                              maxLength={120}
                              name="role"
                            />
                          </label>
                          <label className={styles.profileField}>
                            Email
                            <input
                              defaultValue={contact.email}
                              maxLength={254}
                              name="email"
                              required
                              type="email"
                            />
                          </label>
                          <label className={styles.profileField}>
                            Phone
                            <input
                              defaultValue={contact.phone ?? ""}
                              maxLength={40}
                              name="phone"
                              type="tel"
                            />
                          </label>
                          <label>
                            <input
                              defaultChecked={contact.isPrimary}
                              name="isPrimary"
                              type="checkbox"
                            />
                            Primary contact
                          </label>
                          <label>
                            <input
                              defaultChecked={contact.notify}
                              name="notify"
                              type="checkbox"
                            />
                            Receives customer messages
                          </label>
                          <button type="submit">Save contact</button>
                        </form>
                      </details>
                    </dd>
                  )}
                </div>
              ))}
            </dl>
            <ErrorPopup message={contactError} />
            {isSuperAdmin && (
              <details className={styles.addContactDetails}>
                <summary>Add another contact</summary>
                <form className={styles.profileForm} onSubmit={submitContact}>
                  <div className={styles.profileFields}>
                    <label className={styles.profileField}>
                      Full name
                      <input
                        maxLength={160}
                        onChange={(event) => setNewName(event.target.value)}
                        required
                        value={newName}
                      />
                    </label>
                    <label className={styles.profileField}>
                      Job title / responsibility
                      <input
                        maxLength={120}
                        onChange={(event) => setNewRole(event.target.value)}
                        value={newRole}
                      />
                    </label>
                    <label className={styles.profileField}>
                      Email
                      <input
                        maxLength={254}
                        onChange={(event) => setNewEmail(event.target.value)}
                        required
                        type="email"
                        value={newEmail}
                      />
                    </label>
                    <label className={styles.profileField}>
                      Phone (optional)
                      <input
                        maxLength={40}
                        onChange={(event) => setNewPhone(event.target.value)}
                        type="tel"
                        value={newPhone}
                      />
                    </label>
                  </div>
                  <label className={styles.profileCheck}>
                    <input
                      checked={newPrimary}
                      onChange={(event) => setNewPrimary(event.target.checked)}
                      type="checkbox"
                    />
                    Make primary contact
                  </label>
                  <button type="submit">Save contact</button>
                </form>
              </details>
            )}
          </section>

          {jobs && <ClientJobReport customerId={customerId} jobs={jobs} />}

          {canWorkFinance(roles) && jobs && (
            <JobReport customerId={customerId} jobs={jobs} />
          )}

          <section
            className={styles.historySection}
            aria-labelledby="history-title"
          >
            <div className={styles.historyHeading}>
              <div>
                <p className={styles.sectionEyebrow}>ACTIVITY</p>
                <h2 id="history-title">Customer history</h2>
              </div>
            </div>
            <div className={styles.historyGrid}>
              <article className={styles.historyCard}>
                <div className={styles.cardHeading}>
                  <h3>Quote requests</h3>
                  <span className={styles.notConnected}>
                    {quoteRequests.length}
                  </span>
                </div>
                {historyState === "loading" ? (
                  <p>Loading linked requests…</p>
                ) : historyState === "error" ? (
                  <ErrorPopup message={historyError} />
                ) : quoteRequests.length > 0 ? (
                  <ul className={styles.historyList}>
                    {quoteRequests.map((request) => (
                      <li key={request.id}>
                        <Link
                          className={styles.historyLink}
                          href={`/quotations/requests/${request.id}`}
                        >
                          {request.message}
                        </Link>
                        <p>
                          {request.quoteId
                            ? `Quote ${request.quoteNumber ?? "in draft"} · ${request.quoteStatus === "issued" ? "issued" : "being prepared"}`
                            : "No quote prepared yet"}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No quote requests are linked to this company.</p>
                )}
              </article>
              <article className={styles.historyCard}>
                <div className={styles.cardHeading}>
                  <h3>Jobs</h3>
                  <span className={styles.notConnected}>
                    {jobs ? jobs.length : "—"}
                  </span>
                </div>
                {jobs === null ? (
                  <p>Jobs are not available to your account.</p>
                ) : jobs.length > 0 ? (
                  <ul className={styles.historyList}>
                    {jobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          className={styles.historyLink}
                          href={`/jobs/${job.id}`}
                        >
                          {job.fileNumber}
                        </Link>
                        <p>
                          {serviceLineLabels[job.serviceLine]} ·{" "}
                          {statusLabels[job.status]} · {shortDate(job.openedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No jobs have been opened for this company.</p>
                )}
              </article>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
