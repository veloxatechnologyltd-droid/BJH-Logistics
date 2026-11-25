import type { CustomerCompany } from "../customers/customerApi.ts";
import type { Lead } from "../customers/leadApi.ts";

export type ContactRow = {
  key: string;
  /** The customer number; a lead has none until it becomes a customer. */
  id: string | null;
  business: string;
  name: string;
  phone: string | null;
  email: string | null;
  kind: "Customer" | "Lead";
  /** Where the business first came from: a lead source, or "Direct". */
  source: string;
  /** On the do-not-email list: staff must not send this address sales email. */
  optedOut: boolean;
  /** The customer's profile, or the board that holds the lead. */
  href: string | null;
};

/** Wording of each lead source; the same words the Leads board uses. */
export const leadSourceLabels: Record<Lead["source"], string> = {
  quote_request: "Quote request",
  referral: "Referral",
  walk_in: "Walk-in",
  phone: "Phone",
  email: "Email",
  other: "Other",
  campaign: "Campaign",
};

/** A customer no lead led to: added by staff, or by a portal sign-up. */
export const directSource = "Direct";

/**
 * Every customer (one row per contact, or one for the company when it has no
 * contact) and every lead not yet turned into a customer. A customer that came
 * from a lead keeps that lead's source, so a campaign find stays recognisable.
 */
export function buildContactRows(
  customers: CustomerCompany[],
  leads: Lead[],
  /** Lower-case addresses on the do-not-email list. */
  suppressed: ReadonlySet<string> = new Set(),
): ContactRow[] {
  const isOptedOut = (email: string | null) =>
    email !== null && suppressed.has(email.toLowerCase());
  const sourceByCustomer = new Map<string, string>();
  for (const lead of leads) {
    if (lead.customerCompanyId) {
      sourceByCustomer.set(
        lead.customerCompanyId,
        leadSourceLabels[lead.source],
      );
    }
  }

  const rows: ContactRow[] = [];
  for (const customer of customers) {
    const shared = {
      id: customer.customerNumber,
      business: customer.companyName,
      kind: "Customer" as const,
      source: sourceByCustomer.get(customer.id) ?? directSource,
      href: `/customers/${customer.id}`,
    };
    if (customer.contacts.length === 0) {
      rows.push({
        ...shared,
        key: `customer-${customer.id}`,
        name: "",
        phone: customer.phone,
        email: customer.companyEmail,
        optedOut: isOptedOut(customer.companyEmail),
      });
    }
    for (const contact of customer.contacts) {
      rows.push({
        ...shared,
        key: `contact-${contact.id}`,
        name: contact.name,
        phone: contact.phone ?? customer.phone,
        email: contact.email,
        optedOut: isOptedOut(contact.email),
      });
    }
  }
  for (const lead of leads) {
    // A converted lead's people are already listed under the customer.
    if (lead.customerCompanyId) continue;
    rows.push({
      key: `lead-${lead.id}`,
      id: null,
      business: lead.companyName,
      name: lead.contactName ?? "",
      phone: lead.phone,
      email: lead.email,
      kind: "Lead",
      source: leadSourceLabels[lead.source],
      optedOut: isOptedOut(lead.email),
      // Opens the board that holds it with the business searched for: a found
      // lead lives in the campaign pipeline, any other on the Leads board.
      href: `${lead.source === "campaign" ? "/sales/pipeline" : "/customers/leads"}?search=${encodeURIComponent(lead.companyName)}`,
    });
  }
  return rows.sort((a, b) => a.business.localeCompare(b.business));
}
