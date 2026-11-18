"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createCustomer } from "./customerApi";
import { listLeads, updateLead } from "./leadApi";
import type { Lead } from "./leadApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import { canWorkQuotes } from "../auth/roleAccess";
import styles from "./customerDirectory.module.css";
import { ErrorPopup } from "../ErrorPopup";

export function CustomerCreateForm() {
  const { status, roles } = useStaffAccess();
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // "Create a new customer from this lead" arrives with ?fromLead=<id>.
  const [lead, setLead] = useState<Lead | null>(null);

  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get("fromLead");
    if (!leadId) return;
    listLeads()
      .then((leads) =>
        setLead(leads.find((item) => item.id === leadId) ?? null),
      )
      .catch(() => undefined);
  }, []);

  if (status === "loading") {
    return <p role="status">Checking staff access…</p>;
  }
  if (!canWorkQuotes(roles)) {
    return (
      <section className={styles.customerForm}>
        <p role="status">
          {status === "unavailable"
            ? "Staff access could not be checked. Try again when the API is available."
            : "Only staff who prepare quotes can create customer profiles."}
        </p>
        <Link className={styles.formCancel} href="/customers/directory">
          Back to customers
        </Link>
      </section>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const value = (name: string) => String(form.get(name) ?? "");
      const customer = await createCustomer({
        companyName: value("companyName"),
        businessAddress: value("businessAddress"),
        country: value("country"),
        contactName: value("contactName"),
        email: value("email"),
        phone: value("phone"),
      });
      // The lead it came from is marked won and linked to the new customer.
      if (lead) {
        await updateLead(lead.id, {
          stage: "won",
          customerCompanyId: customer.id,
        });
      }
      router.push(`/customers/${customer.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The customer could not be saved",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={styles.customerForm}
      key={lead?.id ?? "blank"}
      onSubmit={submit}
    >
      {lead && (
        <p role="status">
          Filled in from the lead {lead.companyName}. Saving marks the lead won.
        </p>
      )}
      <section className={styles.customerFormSection}>
        <p>
          Only the essentials. Tax, registration and other details can be added
          on the profile later.
        </p>
        <div className={styles.customerFormFields}>
          <label className={styles.customerFormField} htmlFor="company-name">
            Company name <span aria-hidden="true">*</span>
            <input
              autoComplete="organization"
              id="company-name"
              maxLength={160}
              defaultValue={lead?.companyName}
              name="companyName"
              required
            />
          </label>
          <label className={styles.customerFormField} htmlFor="contact-name">
            Contact person <span aria-hidden="true">*</span>
            <input
              autoComplete="name"
              id="contact-name"
              maxLength={160}
              defaultValue={lead?.contactName ?? undefined}
              name="contactName"
              required
            />
          </label>
          <label className={styles.customerFormField} htmlFor="contact-email">
            Email <span aria-hidden="true">*</span>
            <input
              autoComplete="email"
              id="contact-email"
              maxLength={254}
              defaultValue={lead?.email ?? undefined}
              name="email"
              required
              type="email"
            />
          </label>
          <label className={styles.customerFormField} htmlFor="contact-phone">
            Phone (for SMS messages)
            <input
              autoComplete="tel"
              id="contact-phone"
              maxLength={40}
              defaultValue={lead?.phone ?? undefined}
              name="phone"
              placeholder="024 405 8592"
              type="tel"
            />
          </label>
          <label className={styles.customerFormField} htmlFor="country">
            Country
            <input autoComplete="country-name" id="country" name="country" />
          </label>
          <label
            className={styles.customerFormField}
            htmlFor="business-address"
          >
            Address
            <textarea
              autoComplete="street-address"
              id="business-address"
              maxLength={1000}
              name="businessAddress"
              rows={3}
            />
          </label>
        </div>
      </section>

      <ErrorPopup message={error} />

      <div className={styles.formActions}>
        <Link className={styles.formCancel} href="/customers/directory">
          Cancel
        </Link>
        <button className={styles.formSubmit} disabled={saving} type="submit">
          {saving ? "Saving…" : "Create customer"}
        </button>
      </div>
    </form>
  );
}
