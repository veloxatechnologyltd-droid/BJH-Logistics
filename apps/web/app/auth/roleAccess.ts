import { legacyStaffRoleKeys } from "@bjh/contracts";

/**
 * What each team may do, mirroring the API's role guards so the screens hide
 * what the API would refuse. Accounts still on a pre-2026-11 role keep the old
 * rights until production converts them.
 */
const legacy: readonly string[] = legacyStaffRoleKeys;
const hasAny = (roles: string[], allowed: readonly string[]) =>
  roles.some((role) => allowed.includes(role) || legacy.includes(role));

/** Invoices, payments, costs and statements. */
export const canWorkFinance = (roles: string[]) =>
  hasAny(roles, ["super_admin", "finance_rep"]);

/** Reading invoices and receipts: finance, plus customer service. */
export const canReadInvoices = (roles: string[]) =>
  hasAny(roles, ["super_admin", "finance_rep", "customer_service_rep"]);

/** Preparing, issuing and sending quotes. */
export const canWorkQuotes = (roles: string[]) =>
  hasAny(roles, ["super_admin", "customer_service_rep", "sales_rep"]);
