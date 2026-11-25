"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listCustomers } from "../customers/customerApi";
import { listLeads } from "../customers/leadApi";
import { listSuppressedEmails } from "../sales/salesApi";
import { canWorkQuotes } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import ui from "../jobs/jobs.module.css";
import styles from "../customers/customerDirectory.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";
import { buildContactRows, type ContactRow } from "./contactRows";

type LoadState = "loading" | "ready" | "error";
type KindFilter = "all" | ContactRow["kind"];

async function loadContacts(checkOptOuts: boolean): Promise<ContactRow[]> {
  const [customers, leads] = await Promise.all([
    listCustomers(""),
    listLeads(),
  ]);
  const rows = buildContactRows(customers, leads);
  if (!checkOptOuts) return rows;
  // Only people with the CRM can ask; if it fails the list still shows, unmarked.
  const emails = [
    ...new Set(rows.flatMap((row) => (row.email ? [row.email] : []))),
  ];
  const suppressed = await listSuppressedEmails(emails).catch(() => []);
  return buildContactRows(customers, leads, new Set(suppressed));
}

export function Contacts() {
  const { roles, status, crm } = useStaffAccess();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [source, setSource] = useState("all");

  useEffect(() => {
    if (status === "loading") return;
    let active = true;
    setLoadState("loading");
    loadContacts(crm)
      .then((rows) => {
        if (!active) return;
        setContacts(rows);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : "Contacts are unavailable",
        );
        setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [retry, status, crm]);

  const needle = query.trim().toLowerCase();
  const sources = useMemo(
    () => [...new Set(contacts.map((row) => row.source))].sort(),
    [contacts],
  );
  const filtering = needle !== "" || kind !== "all" || source !== "all";
  const rows = useMemo(
    () =>
      contacts.filter(
        (row) =>
          (kind === "all" || row.kind === kind) &&
          (source === "all" || row.source === source) &&
          (!needle ||
            [row.id, row.business, row.name, row.phone, row.email, row.source]
              .join(" ")
              .toLowerCase()
              .includes(needle)),
      ),
    [contacts, needle, kind, source],
  );

  return (
    <section className={styles.directory} aria-label="Contacts">
      {canWorkQuotes(roles) && (
        <div className={styles.searchHeader}>
          <p className={styles.searchHint}>
            Adding a contact creates a customer profile, the same as New
            customer.
          </p>
          <Link className={styles.newCustomerLink} href="/customers/new">
            Add contact
          </Link>
        </div>
      )}
      <div className={styles.searchRow}>
        <span className={styles.searchIcon} aria-hidden="true">
          ⌕
        </span>
        <input
          aria-label="Search contacts"
          autoComplete="off"
          className={styles.searchInput}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by ID, business, name, phone or email"
          type="search"
          value={query}
        />
        {query && (
          <button
            aria-label="Clear contact search"
            className={styles.clearButton}
            onClick={() => setQuery("")}
            type="button"
          >
            Clear
          </button>
        )}
      </div>

      {loadState === "ready" && (
        <div className={styles.filterRow}>
          <div className={ui.segmented} role="group" aria-label="Type">
            {(
              [
                ["all", "All"],
                ["Customer", "Customers"],
                ["Lead", "Leads"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={kind === value}
                className={kind === value ? ui.segmentActive : ""}
                key={value}
                onClick={() => setKind(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <label className={styles.sortLabel}>
            Source
            <select
              onChange={(event) => setSource(event.target.value)}
              value={source}
            >
              <option value="all">All sources</option>
              {sources.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {loadState === "loading" && (
        <div className={styles.emptyState} role="status" aria-live="polite">
          <h2>Loading contacts</h2>
        </div>
      )}

      {loadState === "error" && (
        <div className={styles.emptyState}>
          <ErrorPopup message={loadError} />
          <h2>Contacts could not be loaded</h2>
          <p>{plainMessage(loadError)}</p>
          <button
            className={styles.emptyClearButton}
            onClick={() => setRetry((current) => current + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {loadState === "ready" && (
        <>
          <p className={styles.resultSummary} role="status" aria-live="polite">
            {rows.length} {rows.length === 1 ? "contact" : "contacts"}
            {filtering ? " match" : ""}
          </p>

          {rows.length > 0 ? (
            <div className={styles.tableScroll}>
              <table className={styles.customerTable} data-cards>
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Business</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Telephone</th>
                    <th scope="col">Email</th>
                    <th scope="col">Type</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td className={styles.nowrap} data-label="ID">
                        {row.id ?? "—"}
                      </td>
                      <th scope="row">
                        {row.href ? (
                          <Link className={styles.companyLink} href={row.href}>
                            {row.business}
                          </Link>
                        ) : (
                          row.business
                        )}
                      </th>
                      <td data-label="Contact">{row.name || "—"}</td>
                      <td className={styles.nowrap} data-label="Telephone">
                        {row.phone ? (
                          <a href={`tel:${row.phone.replace(/\s+/g, "")}`}>
                            {row.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label="Email" data-wide>
                        {row.email ? (
                          <>
                            <a href={`mailto:${row.email}`}>{row.email}</a>
                            {row.optedOut && (
                              <span
                                className={`${ui.badge} ${styles.optedOutBadge}`}
                                title="This address unsubscribed or was blocked. Do not send it sales email."
                              >
                                Do not email
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label="Type">
                        <span
                          className={
                            row.kind === "Lead"
                              ? `${ui.badge} ${styles.leadBadge}`
                              : ui.badge
                          }
                        >
                          {row.kind}
                        </span>
                      </td>
                      <td data-label="Source">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <h2>{filtering ? "No contacts match" : "No contacts yet"}</h2>
              <p>
                {filtering
                  ? "Try a different search or clear the filters."
                  : "Contacts appear here as you add leads and customers."}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
