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

/** Invoices, receipts, payments, costs and statements: finance and the super admin only. */
export const canWorkFinance = (roles: string[]) =>
  hasAny(roles, ["super_admin", "finance_rep"]);

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

/** Preparing, issuing and sending quotes. */
export const canWorkQuotes = (roles: string[]) =>
  hasAny(roles, ["super_admin", "customer_service_rep", "sales_rep"]);
