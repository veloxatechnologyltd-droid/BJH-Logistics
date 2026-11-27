"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { serviceLinesForRoles } from "@bjh/contracts";
import type { HeldStaffRoleKey, ServiceLine } from "@bjh/contracts";
import { canWorkQuotes } from "../auth/roleAccess";
import { createCustomer, listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { leadToCustomer, listLeads } from "../customers/leadApi";
import type { Lead } from "../customers/leadApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import { createJob, serviceLineLabels } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

const lines = Object.keys(serviceLineLabels) as ServiceLine[];

export function JobCreateForm() {
  const router = useRouter();
  const { roles, isSuperAdmin, status } = useStaffAccess();
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [customerId, setCustomerId] = useState("");
  /** Open leads not yet linked to a customer; a job can be opened for them too. */
  const [leads, setLeads] = useState<Lead[]>([]);
  /** Whether the job is for a customer, a lead or a client in neither list. */
  const [partyKind, setPartyKind] = useState<"customer" | "lead" | "new">(
    "customer",
  );
  const [leadId, setLeadId] = useState("");
  const [newClient, setNewClient] = useState({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
  });
  const [serviceLine, setServiceLine] = useState<ServiceLine | "">("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Reps can only open jobs for their own service lines; the super admin any.
  const allowedLines = isSuperAdmin
    ? lines
    : lines.filter((line) =>
        serviceLinesForRoles(roles as HeldStaffRoleKey[]).includes(line),
      );

  useEffect(() => {
    listCustomers("")
      .then(setCustomers)
      .catch(() => setError("Customers could not be loaded"));
    listLeads()
      .then((all) =>
        setLeads(
          all.filter(
            (lead) =>
              !lead.customerCompanyId &&
              ["new", "contacted", "quoted"].includes(lead.stage),
          ),
        ),
      )
      .catch(() => undefined);
  }, []);

  // Only whoever may make customers (as in the API) is offered a lead or a new client.
  const canAddClient = canWorkQuotes(roles);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!serviceLine) return;
    setSaving(true);
    setError("");
    try {
      // A lead or a new client becomes a customer first. Once made, the
      // profile is kept (the fields lock), so a failed save does not make it twice.
      let clientId = customerId;
      if (!clientId) {
        clientId =
          partyKind === "lead"
            ? (await leadToCustomer(leadId)).customerCompanyId
            : (await createCustomer(newClient)).id;
        setCustomerId(clientId);
      }
      const job = await createJob({
        customerCompanyId: clientId,
        serviceLine,
      });
      router.push(`/jobs/${job.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The job failed");
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Open a job</h1>
        </div>
        <Link className={styles.secondaryButton} href="/jobs">
          Back to jobs
        </Link>
      </header>
      {status === "ready" && allowedLines.length === 0 && (
        <p className={styles.error}>
          Only staff with a department role can open jobs.
        </p>
      )}
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.form}>
          {canAddClient && (
            <label className={styles.field}>
              Job for
              <select
                disabled={Boolean(customerId) && partyKind !== "customer"}
                onChange={(event) => {
                  setPartyKind(
                    event.target.value as "customer" | "lead" | "new",
                  );
                  setCustomerId("");
                  setLeadId("");
                }}
                value={partyKind}
              >
                <option value="customer">Customer</option>
                <option value="lead">Lead</option>
                <option value="new">New customer</option>
              </select>
            </label>
          )}
          {partyKind === "new" ? (
            (
              [
                ["companyName", "Company name", "text", true],
                ["contactName", "Contact person", "text", true],
                ["email", "Email", "email", true],
                ["phone", "Phone", "tel", false],
              ] as const
            ).map(([key, label, type, required]) => (
              <label className={styles.field} key={key}>
                {label}
                <input
                  disabled={Boolean(customerId)}
                  maxLength={key === "email" ? 254 : 160}
                  onChange={(event) =>
                    setNewClient((client) => ({
                      ...client,
                      [key]: event.target.value,
                    }))
                  }
                  required={required}
                  type={type}
                  value={newClient[key]}
                />
              </label>
            ))
          ) : partyKind === "lead" ? (
            <label className={styles.field}>
              Lead
              <select
                disabled={Boolean(customerId)}
                onChange={(event) => setLeadId(event.target.value)}
                required
                value={leadId}
              >
                <option value="">
                  {leads.length ? "Select a lead" : "No open leads"}
                </option>
                {leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.companyName}
                    {lead.contactName ? ` (${lead.contactName})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={styles.field}>
              Customer
              <select
                onChange={(event) => setCustomerId(event.target.value)}
                required
                value={customerId}
              >
                <option value="">Select a customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {partyKind !== "customer" && (
            <p className={styles.muted}>
              {partyKind === "lead"
                ? "The lead becomes a customer when the job is opened."
                : "A customer profile is made when the job is opened."}
            </p>
          )}
          <label className={styles.field}>
            Service
            <select
              onChange={(event) =>
                setServiceLine(event.target.value as ServiceLine)
              }
              required
              value={serviceLine}
            >
              <option value="">Select a service</option>
              {allowedLines.map((line) => (
                <option key={line} value={line}>
                  {serviceLineLabels[line]}
                </option>
              ))}
            </select>
          </label>
          <ErrorPopup message={error} />
          <div className={styles.actions}>
            <button className={styles.button} disabled={saving} type="submit">
              {saving ? "Opening…" : "Open job"}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
