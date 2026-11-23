"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listCustomers } from "../customers/customerApi";
import { listLeads } from "../customers/leadApi";
import { canWorkQuotes } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import ui from "../jobs/jobs.module.css";
import styles from "../customers/customerDirectory.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";

type ContactRow = {
  key: string;
  business: string;
  name: string;
  phone: string | null;
  email: string | null;
  kind: "Customer" | "Lead";
  /** The customer's profile; leads have no page of their own. */
  href: string | null;
};

type LoadState = "loading" | "ready" | "error";

/** Every contact of every customer, and every lead not yet turned into a customer. */
async function loadContacts(): Promise<ContactRow[]> {
  const [customers, leads] = await Promise.all([
    listCustomers(""),
    listLeads(),
  ]);
  const rows: ContactRow[] = [];
  for (const customer of customers) {
    for (const contact of customer.contacts) {
      rows.push({
        key: `contact-${contact.id}`,
        business: customer.companyName,
        name: contact.name,
        phone: contact.phone ?? customer.phone,
        email: contact.email,
        kind: "Customer",
        href: `/customers/${customer.id}`,
      });
    }
  }
  for (const lead of leads) {
    // A converted lead's people are already listed under the customer.
    if (lead.customerCompanyId) continue;
    rows.push({
      key: `lead-${lead.id}`,
      business: lead.companyName,
      name: lead.contactName ?? "",
      phone: lead.phone,
      email: lead.email,
      kind: "Lead",
      href: null,
    });
  }
  return rows.sort((a, b) => a.business.localeCompare(b.business));
}

export function Contacts() {
  const { roles } = useStaffAccess();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    loadContacts()
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
  }, [retry]);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      needle
        ? contacts.filter((row) =>
            [row.business, row.name, row.phone, row.email, row.kind]
              .join(" ")
              .toLowerCase()
              .includes(needle),
          )
        : contacts,
    [contacts, needle],
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
          placeholder="Search by business, name, phone or email"
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
            {needle ? " match your search" : ""}
          </p>

          {rows.length > 0 ? (
            <div className={styles.tableScroll}>
              <table className={styles.customerTable} data-cards>
                <thead>
                  <tr>
                    <th scope="col">Business</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Telephone</th>
                    <th scope="col">Email</th>
                    <th scope="col">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
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
                          <a href={`mailto:${row.email}`}>{row.email}</a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label="Type">
                        <span className={ui.badge}>{row.kind}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <h2>{needle ? "No contacts match" : "No contacts yet"}</h2>
              <p>
                {needle
                  ? "Try a different business, name, phone number or email."
                  : "Contacts appear here as you add leads and customers."}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
