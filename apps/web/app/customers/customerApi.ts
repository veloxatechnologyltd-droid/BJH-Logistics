import { authenticatedFetch } from "../auth/authenticatedFetch";
import type {
  CustomerCompanyUpdate,
  CustomerContactInput,
  CustomerContactUpdate,
  CustomerInput,
} from "@bjh/contracts";

export type CustomerContact = {
  id: string;
  name: string;
  role: string | null;
  email: string;
  /** For SMS messages. */
  phone: string | null;
  /** Whether this person receives customer messages. */
  notify: boolean;
  isPrimary: boolean;
  createdAt: string;
};

export type CustomerCompany = {
  id: string;
  customerNumber: string;
  companyName: string;
  tradingName: string | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  phone: string | null;
  companyEmail: string | null;
  website: string | null;
  businessAddress: string | null;
  billingAddress: string | null;
  country: string | null;
  createdAt: string;
  contacts: CustomerContact[];
};

export type NewCustomer = CustomerInput;

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const customersUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/customers`;

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : body?.message;
    throw new Error(message ?? "The request could not be completed");
  }

  return (await response.json()) as T;
}

export async function listCustomers(
  search: string,
): Promise<CustomerCompany[]> {
  const query = new URLSearchParams({ search });
  return readResponse<CustomerCompany[]>(
    await authenticatedFetch(`${customersUrl}?${query}`),
  );
}

export async function getCustomer(id: string): Promise<CustomerCompany> {
  return readResponse<CustomerCompany>(
    await authenticatedFetch(`${customersUrl}/${encodeURIComponent(id)}`),
  );
}

export async function createCustomer(
  customer: NewCustomer,
): Promise<CustomerCompany> {
  return readResponse<CustomerCompany>(
    await authenticatedFetch(customersUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(customer),
    }),
  );
}

export async function updateCustomer(
  companyId: string,
  update: CustomerCompanyUpdate,
): Promise<CustomerCompany> {
  return readResponse<CustomerCompany>(
    await authenticatedFetch(
      `${customersUrl}/${encodeURIComponent(companyId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    ),
  );
}

export async function addContact(
  companyId: string,
  contact: CustomerContactInput,
): Promise<CustomerContact> {
  return readResponse<CustomerContact>(
    await authenticatedFetch(
      `${customersUrl}/${encodeURIComponent(companyId)}/contacts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contact),
      },
    ),
  );
}

export async function updateContact(
  companyId: string,
  contactId: string,
  update: CustomerContactUpdate & { notify: boolean },
): Promise<CustomerContact> {
  return readResponse<CustomerContact>(
    await authenticatedFetch(
      `${customersUrl}/${encodeURIComponent(companyId)}/contacts/${encodeURIComponent(contactId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    ),
  );
}

export type CustomerInsight = {
  companyId: string;
  /** An unfinished job, or one opened in the last `customerActiveDays` days. */
  active: boolean;
  totalJobs: number;
  activeJobs: number;
  lastJobAt: string | null;
  lastContactAt: string | null;
  quotesSent: number;
  quotesAccepted: number;
  quotesAwaiting: number;
  /** One entry per currency; never added together. */
  money: Array<{
    currency: string;
    invoicedMinor: number;
    receivedMinor: number;
    averageDaysToPay: number | null;
  }>;
};

export async function listCustomerInsights(): Promise<CustomerInsight[]> {
  return readResponse<CustomerInsight[]>(
    await authenticatedFetch(`${customersUrl}/insights`),
  );
}

export async function getCustomerInsight(id: string): Promise<CustomerInsight> {
  return readResponse<CustomerInsight>(
    await authenticatedFetch(
      `${customersUrl}/${encodeURIComponent(id)}/insights`,
    ),
  );
}
