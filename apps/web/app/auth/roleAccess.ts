import { documentTypeLabels, legacyStaffRoleKeys } from "@bjh/contracts";
import type { DocumentType } from "@bjh/contracts";

/**
 * What each team may do, mirroring the API's role guards so the screens hide
 * what the API would refuse. Accounts still on a pre-2026-11 role keep the old
 * rights until production converts them.
 */
const legacy: readonly string[] = legacyStaffRoleKeys;
const hasAny = (roles: string[], allowed: readonly string[]) =>
  roles.some((role) => allowed.includes(role) || legacy.includes(role));

/**
 * Invoices, receipts, payments, costs, statements and the money reports:
 * finance, customer service and the super admin. Unlike the other rights here,
 * the four legacy air/sea roles do not keep this one: the API stopped granting
 * it to them (audit S6), so the screens must not offer what it would refuse.
 */
export const canWorkFinance = (roles: string[]) =>
  roles.some((role) =>
    ["super_admin", "finance_rep", "customer_service_rep"].includes(role),
  );

/** Bra Evans, the staff helper: the boss and customer service, as in the API. */
export const canUseAssistant = (roles: string[]) =>
  roles.some((role) => ["super_admin", "customer_service_rep"].includes(role));

/** Supplier invoices and disbursement proof are BJH's costs: finance only, as in the API. */
const costEvidenceTypes: readonly DocumentType[] = [
  "supplier_invoice",
  "disbursement_evidence",
];

/** The document types this person may upload or filter by. */
export const documentTypesFor = (roles: string[]): DocumentType[] =>
  (Object.keys(documentTypeLabels) as DocumentType[]).filter(
    (key) => canWorkFinance(roles) || !costEvidenceTypes.includes(key),
  );

/** Creating and editing customer profiles (the API's ClientDeskGuard). */
export const canWorkClientDesk = (roles: string[]) =>
  hasAny(roles, ["super_admin", "customer_service_rep", "sales_rep"]);

/** Preparing, issuing and sending quotes. */
export const canWorkQuotes = (roles: string[]) =>
  hasAny(roles, [
    "super_admin",
    "customer_service_rep",
    "sales_rep",
    "import_rep",
    "export_rep",
  ]);

/**
 * Lead-generation campaigns: sales, customer service and the super admin, as in
 * the API (decision L3). The legacy air and sea roles do not keep this one: the
 * API never granted it to them.
 */
export const canUseLeadGeneration = (roles: string[]) =>
  roles.some((role) =>
    ["super_admin", "sales_rep", "customer_service_rep"].includes(role),
  );
