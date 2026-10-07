"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ServiceLine } from "@bjh/contracts";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
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
  const [serviceLine, setServiceLine] = useState<ServiceLine | "">("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Reps can only open jobs for their own service line; the super admin any.
  const allowedLines = isSuperAdmin
    ? lines
    : lines.filter((line) => roles.includes(`${line}_rep`));

  useEffect(() => {
    listCustomers("")
      .then(setCustomers)
      .catch(() => setError("Customers could not be loaded"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!customerId || !serviceLine) return;
    setSaving(true);
    setError("");
    try {
      const job = await createJob({
        customerCompanyId: customerId,
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
