import type {
  BusinessSettings,
  ChargeKind,
  DocumentType,
  QuoteDecision,
  QuoteBasis,
  QuoteVersionInput,
  TaskKind,
  JobStatus,
  PartyRole,
  ReferenceKind,
  CustomerContactUpdate,
  CustomerCompanyUpdate,
  LeadSource,
  LeadStage,
} from "@bjh/contracts";

export interface DatabaseHealth {
  status: "ok" | "error";
  provider: "postgresql";
  schemaVersion?: string;
}

export interface QuoteRequestRecord {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  message: string;
  createdAt: string;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  /** The quote prepared for this request (the newest one), if any. */
  quoteId: string | null;
  quoteNumber: string | null;
  quoteStatus: "draft" | "issued" | null;
}

export type ServiceLine =
  | "sea_import"
  | "sea_export"
  | "air_import"
  | "air_export"
  | "warehousing"
  | "road_transport";

export interface JobStatusChangeRecord {
  id: string;
  jobId: string;
  fromStatus: JobStatus;
  toStatus: JobStatus;
  reason: string | null;
  changedBy: string;
  changedAt: string;
}

export interface JobPartyRecord {
  id: string;
  jobId: string;
  role: PartyRole;
  name: string;
  details: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ShipmentReferenceRecord {
  id: string;
  jobId: string;
  kind: ReferenceKind;
  value: string;
  sealNumber: string | null;
  parentReferenceId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface DocumentVersionRecord {
  id: string;
  versionNumber: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface DocumentRecord {
  id: string;
  jobId: string;
  documentType: DocumentType;
  createdBy: string;
  createdAt: string;
  versions: DocumentVersionRecord[];
}

/** One row of the document library: a job's document or a standalone one, with its newest version. */
export interface LibraryDocumentRecord {
  id: string;
  jobId: string | null;
  fileNumber: string | null;
  companyId: string | null;
  companyName: string | null;
  title: string | null;
  documentType: DocumentType;
  createdAt: string;
  versionCount: number;
  latest: DocumentVersionRecord;
}

/** Internal only: the storage key is never returned to API clients. */
export interface StoredDocumentVersion extends DocumentVersionRecord {
  objectKey: string;
  documentId: string;
}

export interface JobRecord {
  id: string;
  fileNumber: string;
  serviceLine: ServiceLine;
  customerCompanyId: string;
  customerCompanyName: string;
  quoteRequestId: string | null;
  /** The accepted quote this job was opened from, if any. */
  quoteId: string | null;
  status: JobStatus;
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
}

export interface MilestoneEventRecord {
  id: string;
  jobId: string;
  milestoneKey: string;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string;
  source: "manual" | "system";
  note: string | null;
  correctionOf: string | null;
}

export interface EtaEventRecord {
  id: string;
  jobId: string;
  etaAt: string;
  source: string;
  note: string | null;
  recordedAt: string;
  recordedBy: string;
  correctionOf: string | null;
}

export interface JobTaskRecord {
  id: string;
  jobId: string;
  fileNumber: string;
  customerCompanyName: string;
  kind: TaskKind;
  title: string;
  details: string | null;
  assignedRole: StaffRoleKey;
  dueDate: string | null;
  status: "open" | "done";
  createdAt: string;
  createdBy: string;
  completedAt: string | null;
  completedBy: string | null;
  completionNote: string | null;
}

export interface QuoteLineRecord {
  id: string;
  position: number;
  section: string | null;
  description: string;
  details: string | null;
  basis: QuoteBasis;
  basisNote: string | null;
  amountMinor: number | null;
  /** One amount per size column of the version, or null for a single amount. */
  sizeAmountsMinor: number[] | null;
}

export interface QuoteVersionRecord {
  id: string;
  versionNumber: number;
  status: "draft" | "issued";
  currency: string;
  title: string;
  subtitle: string | null;
  shipmentScope: string | null;
  intro: string | null;
  atCostNote: string | null;
  procedureSteps: string[];
  requiredDocuments: string[];
  documentsNote: string | null;
  timeline: string | null;
  terms: string[];
  sizeLabels: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  issuedBy: string | null;
  issuedAt: string | null;
  lines: QuoteLineRecord[];
}

/** A quote as listed: the latest version the viewer may see. */
export interface QuoteSummaryRecord {
  id: string;
  quoteNumber: string | null;
  serviceLine: ServiceLine;
  customerCompanyId: string;
  customerCompanyName: string;
  quoteRequestId: string | null;
  createdBy: string;
  createdAt: string;
  latestVersionNumber: number;
  latestStatus: "draft" | "issued";
  title: string;
  currency: string;
}

export interface QuoteDecisionRecord {
  id: string;
  versionNumber: number;
  decision: QuoteDecision;
  clientSignatory: string;
  decidedAt: string;
  note: string | null;
  recordedAt: string;
  recordedBy: string;
}

export interface QuoteRecord extends Omit<
  QuoteSummaryRecord,
  "latestVersionNumber" | "latestStatus" | "title" | "currency"
> {
  versions: QuoteVersionRecord[];
  decisions: QuoteDecisionRecord[];
  /** The job opened when the quote was accepted, if any. */
  jobId: string | null;
}

export interface BusinessSettingsRevisionRecord {
  revisionNumber: number;
  settings: BusinessSettings;
  changedBy: string;
  changedAt: string;
}

export interface ChargeActualRecord {
  id: string;
  amountMinor: number;
  currency: string;
  exchangeRate: string | null;
  /** Null when the recorded currency differs and no conversion was supplied. */
  convertedMinor: number | null;
  rateNote: string | null;
  supplierDocumentId: string | null;
  note: string | null;
  correctionOf: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface JobChargeRecord {
  id: string;
  jobId: string;
  kind: ChargeKind;
  description: string;
  currency: string;
  quantity: number;
  unitQuotedMinor: number | null;
  quoteLineId: string | null;
  quoteContainerSize: string | null;
  createdBy: string;
  createdAt: string;
  /** Oldest first; the last entry is the current actual amount. */
  actuals: ChargeActualRecord[];
}

export interface DriverRecord {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  deactivatedAt: string | null;
}

export interface VehicleRecord {
  id: string;
  registration: string;
  description: string | null;
  createdAt: string;
  deactivatedAt: string | null;
}

/** A numbered waybill; driver, vehicle and cargo are frozen at dispatch. */
export interface DeliveryRecord {
  id: string;
  jobId: string;
  waybillNumber: string;
  driverId: string;
  vehicleId: string;
  driverName: string;
  driverPhone: string;
  vehicleRegistration: string;
  cargoDescription: string;
  packages: number | null;
  grossWeightKg: number | null;
  pickupLocation: string | null;
  deliveryAddress: string;
  dispatchedAt: string;
  dispatchedBy: string;
  status: "dispatched" | "delivered";
  receiverName: string | null;
  receiverPhone: string | null;
  deliveredAt: string | null;
  damageNotes: string | null;
  podDocumentId: string | null;
  podRecordedBy: string | null;
  podRecordedAt: string | null;
}

export interface InvoiceLineRecord {
  description: string;
  amountMinor: number;
  taxable: boolean;
}

export interface InvoiceTaxLineRecord {
  name: string;
  rateBasisPoints: number;
  amountMinor: number;
}

/** Subtotal, tax lines and total, computed by the service and stored with the invoice. */
export interface InvoiceTotals {
  subtotalMinor: number;
  taxLines: InvoiceTaxLineRecord[];
  taxTotalMinor: number;
  totalMinor: number;
}

export interface InvoiceRecord extends InvoiceTotals {
  id: string;
  jobId: string;
  /** Null until the invoice is issued. */
  invoiceNumber: string | null;
  status: "draft" | "issued" | "void";
  currency: string;
  lines: InvoiceLineRecord[];
  /** YYYY-MM-DD */
  dueDate: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  issuedBy: string | null;
  issuedAt: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface InvoicePaymentRecord {
  id: string;
  invoiceId: string;
  /** Null only for payments recorded before receipts existed. */
  receiptNumber: string | null;
  amountMinor: number;
  /** YYYY-MM-DD */
  receivedOn: string;
  method: "cash" | "bank_transfer" | "cheque" | "mobile_money" | "other";
  reference: string | null;
  evidenceDocumentId: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
  reversal: { reason: string; reversedBy: string; reversedAt: string } | null;
}

export interface JobCorrespondenceRecord {
  id: string;
  jobId: string;
  channel: "email" | "whatsapp" | "sms" | "phone" | "letter" | "other";
  direction: "received" | "sent";
  occurredAt: string;
  counterparty: string | null;
  subject: string | null;
  body: string;
  documentId: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface WarehouseLocationRecord {
  id: string;
  name: string;
  createdAt: string;
  deactivatedAt: string | null;
}

export interface StockMovementRecord {
  id: string;
  jobId: string;
  locationId: string;
  locationName: string;
  kind: "receipt" | "release";
  item: string;
  unit: string;
  quantity: number;
  conditionNotes: string | null;
  reference: string | null;
  occurredAt: string;
  recordedBy: string;
  recordedAt: string;
}

export interface StockBalanceRecord {
  jobId: string;
  fileNumber: string;
  customerCompanyId: string;
  customerCompanyName: string;
  locationId: string;
  locationName: string;
  item: string;
  unit: string;
  balance: number;
}

export interface NotificationDeliveryRecord {
  id: string;
  notificationId: string;
  channel: "email" | "sms";
  contactId: string | null;
  contactName: string | null;
  recipient: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  provider: string | null;
  providerMessageId: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  companyId: string;
  jobId: string | null;
  event: string;
  subject: string;
  body: string;
  smsText: string;
  linkUrl: string | null;
  createdBy: string | null;
  createdAt: string;
  deliveries: NotificationDeliveryRecord[];
}

/** A delivery the dispatcher has claimed and must now send. */
export interface DueDelivery {
  id: string;
  channel: "email" | "sms";
  recipient: string;
  /** Attempts including this one. */
  attempts: number;
  subject: string;
  body: string;
  smsText: string;
  linkUrl: string | null;
}

export interface NotificationLogRow extends NotificationDeliveryRecord {
  event: string;
  subject: string;
  companyName: string;
  fileNumber: string | null;
}

/** A client message as shown in the Messages feed, across every company and job. */
export interface NotificationFeedRow extends NotificationRecord {
  companyName: string;
  fileNumber: string | null;
}

export interface EtaReminderCandidate {
  jobId: string;
  fileNumber: string;
  companyId: string;
  etaId: string;
  etaAt: string;
}

export interface ExtractionFieldRecord {
  key: ReferenceKind;
  label: string;
  value: string;
  sealNumber: string | null;
  evidence: string;
}

export interface ExtractionApplyResult {
  index: number;
  key: ReferenceKind;
  value: string;
  /** "added", or why nothing was added. */
  result: string;
}

export interface DocumentExtractionRecord {
  id: string;
  jobId: string;
  documentId: string;
  versionNumber: number;
  filename: string | null;
  /** False for a scanned PDF with no text to read. */
  textFound: boolean;
  fields: ExtractionFieldRecord[];
  status: "draft" | "approved" | "rejected";
  applied: ExtractionApplyResult[] | null;
  createdBy: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface TransportDocumentRecord {
  id: string;
  jobId: string;
  kind: "house_bl" | "house_awb" | "air_manifest";
  documentNumber: string | null;
  status: "draft" | "issued" | "void";
  fields: Record<string, string>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  issuedBy: string | null;
  issuedAt: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/** One job's money in one currency: issued invoices, standing payments, current actual costs. */
export interface CustomerInsightRecord {
  companyId: string;
  totalJobs: number;
  activeJobs: number;
  lastJobAt: string | null;
  lastContactAt: string | null;
  quotesSent: number;
  quotesAccepted: number;
  quotesAwaiting: number;
  /** One row per currency; amounts are never summed across currencies. */
  money: Array<{
    currency: string;
    invoicedMinor: number;
    receivedMinor: number;
    /** Average days from issue to the last payment, over fully paid invoices. */
    averageDaysToPay: number | null;
  }>;
}

export interface LeadRecord {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  stage: LeadStage;
  ownerId: string | null;
  ownerEmail: string | null;
  /** YYYY-MM-DD */
  nextFollowUp: string | null;
  notes: string | null;
  lostReason: string | null;
  quoteRequestId: string | null;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  createdAt: string;
  updatedAt: string;
  stageChangedAt: string;
}

export interface JobFinanceRecord {
  jobId: string;
  fileNumber: string;
  customerCompanyName: string;
  currency: string;
  invoicedMinor: number;
  receivedMinor: number;
  costMinor: number;
}

export interface OutstandingInvoiceRecord {
  invoiceId: string;
  invoiceNumber: string;
  jobId: string;
  fileNumber: string;
  customerCompanyId: string;
  customerCompanyName: string;
  currency: string;
  totalMinor: number;
  outstandingMinor: number;
  /** YYYY-MM-DD */
  dueDate: string | null;
  issuedAt: string;
}

export interface ActivityEntry {
  actorUserId: string;
  actorEmail: string | null;
  method: string;
  route: string;
  entityId: string | null;
  statusCode: number;
  clientIp: string | null;
}

export interface ActivityRecord extends ActivityEntry {
  id: string;
  occurredAt: string;
}

export interface ActivityFilter {
  actorUserId?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

/** Undefined fields mean unrestricted; an empty array matches nothing. */
export interface JobScope {
  companyIds?: string[];
  serviceLines?: ServiceLine[];
}

export interface CustomerContactRecord {
  id: string;
  name: string;
  role?: string | null;
  email: string;
  createdAt: string;
  isPrimary?: boolean;
  /** For SMS notifications; optional. */
  phone?: string | null;
  /** Whether this contact receives customer notifications (default true). */
  notify?: boolean;
}

export interface CustomerCompanyRecord {
  id: string;
  customerNumber?: string;
  companyName: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  taxNumber?: string | null;
  phone?: string | null;
  companyEmail?: string | null;
  website?: string | null;
  businessAddress?: string | null;
  billingAddress?: string | null;
  country?: string | null;
  createdAt: string;
  contacts: CustomerContactRecord[];
}

export interface CustomerMembershipRecord {
  id: string;
  companyId: string;
  userId: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
}

/** An active customer-company membership with the company's name. */
export interface ActiveCustomerMembershipRecord {
  userId: string;
  companyId: string;
  companyName: string;
  grantedAt: string;
}

export type StaffRoleKey =
  | "super_admin"
  | "air_import_rep"
  | "air_export_rep"
  | "sea_import_rep"
  | "sea_export_rep";

export interface StaffRoleAssignmentRecord {
  id: string;
  userId: string;
  roleKey: StaffRoleKey;
  assignedBy: string;
  assignedAt: string;
  revokedAt: string | null;
}

export abstract class DatabasePort {
  abstract healthCheck(): Promise<DatabaseHealth>;
  abstract createQuoteRequest(
    request: QuoteRequestRecord,
  ): Promise<QuoteRequestRecord>;
  abstract listQuoteRequests(
    customerCompanyId?: string,
    allowedCompanyIds?: string[],
  ): Promise<QuoteRequestRecord[]>;
  abstract findQuoteRequest(
    id: string,
    allowedCompanyIds?: string[],
  ): Promise<QuoteRequestRecord | null>;
  abstract linkQuoteRequestToCustomer(
    requestId: string,
    customerCompanyId: string,
  ): Promise<QuoteRequestRecord | null>;
  abstract createCustomer(
    customer: CustomerCompanyRecord,
  ): Promise<CustomerCompanyRecord>;
  abstract addCustomerContact(
    companyId: string,
    contact: CustomerContactRecord,
  ): Promise<CustomerContactRecord | null>;
  abstract updateCustomer(
    companyId: string,
    update: CustomerCompanyUpdate,
  ): Promise<CustomerCompanyRecord | null>;
  abstract updateCustomerContact(
    companyId: string,
    contactId: string,
    update: CustomerContactUpdate,
  ): Promise<CustomerContactRecord | null>;
  abstract listCustomers(
    search: string,
    companyIds?: string[],
  ): Promise<CustomerCompanyRecord[]>;
  abstract findCustomer(
    id: string,
    companyIds?: string[],
  ): Promise<CustomerCompanyRecord | null>;
  abstract createJob(
    input: {
      customerCompanyId: string;
      serviceLine: ServiceLine;
      quoteRequestId: string | null;
    },
    openedBy: string,
    year: number,
  ): Promise<JobRecord>;
  abstract listJobs(search: string, scope: JobScope): Promise<JobRecord[]>;
  abstract findJob(id: string, scope: JobScope): Promise<JobRecord | null>;
  abstract addJobParty(party: {
    jobId: string;
    role: PartyRole;
    name: string;
    details: string | null;
    createdBy: string;
  }): Promise<JobPartyRecord>;
  abstract listJobParties(jobId: string): Promise<JobPartyRecord[]>;
  abstract removeJobParty(
    jobId: string,
    partyId: string,
    removedBy: string,
  ): Promise<boolean>;
  abstract addShipmentReference(reference: {
    jobId: string;
    kind: ReferenceKind;
    value: string;
    sealNumber: string | null;
    parentReferenceId: string | null;
    createdBy: string;
  }): Promise<
    ShipmentReferenceRecord | "parent_invalid" | "duplicate_reference"
  >;
  abstract listShipmentReferences(
    jobId: string,
  ): Promise<ShipmentReferenceRecord[]>;
  abstract removeShipmentReference(
    jobId: string,
    referenceId: string,
    removedBy: string,
  ): Promise<boolean | "has_children">;
  abstract saveDocumentVersion(upload: {
    jobId: string;
    documentId: string | null;
    documentType: DocumentType;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    objectKey: string;
    uploadedBy: string;
  }): Promise<DocumentRecord | "document_not_found">;
  abstract listDocuments(jobId: string): Promise<DocumentRecord[]>;
  /** Creates a new document (job or company optional) with its first version and returns its ID. */
  abstract saveLibraryDocument(upload: {
    jobId: string | null;
    companyId: string | null;
    title: string | null;
    documentType: DocumentType;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    objectKey: string;
    uploadedBy: string;
  }): Promise<string>;
  /** Every term must appear somewhere in the document's searchable text; newest first, at most 200. */
  abstract searchDocuments(
    query: {
      terms: string[];
      documentType: DocumentType | null;
      documentId: string | null;
    },
    scope: JobScope,
  ): Promise<LibraryDocumentRecord[]>;
  /** No access check: callers authorise the document first with `searchDocuments`. */
  abstract findDocumentVersionById(
    documentId: string,
    versionNumber?: number,
  ): Promise<StoredDocumentVersion | null>;
  abstract findDocumentVersion(
    jobId: string,
    documentId: string,
    versionNumber?: number,
  ): Promise<StoredDocumentVersion | null>;
  abstract changeJobStatus(change: {
    jobId: string;
    from: JobStatus;
    to: JobStatus;
    reason: string | null;
    changedBy: string;
  }): Promise<JobRecord | "status_changed">;
  abstract listJobStatusHistory(
    jobId: string,
  ): Promise<JobStatusChangeRecord[]>;
  abstract appendMilestoneEvent(event: {
    jobId: string;
    milestoneKey: string;
    occurredAt: string;
    recordedBy: string;
    note: string | null;
    correctionOf: string | null;
  }): Promise<MilestoneEventRecord | "correction_target_not_found">;
  abstract listMilestoneEvents(jobId: string): Promise<MilestoneEventRecord[]>;
  abstract appendEtaEvent(event: {
    jobId: string;
    etaAt: string;
    source: string;
    note: string | null;
    recordedBy: string;
    correctionOf: string | null;
  }): Promise<EtaEventRecord | "correction_target_not_found">;
  abstract listEtaEvents(jobId: string): Promise<EtaEventRecord[]>;
  abstract createJobTask(task: {
    jobId: string;
    kind: TaskKind;
    title: string;
    details: string | null;
    assignedRole: StaffRoleKey;
    dueDate: string | null;
    createdBy: string;
  }): Promise<JobTaskRecord>;
  abstract listJobTasks(
    filter: { jobId?: string; assignedRole?: StaffRoleKey; open?: boolean },
    scope: JobScope,
  ): Promise<JobTaskRecord[]>;
  abstract completeJobTask(
    jobId: string,
    taskId: string,
    completedBy: string,
    note: string | null,
  ): Promise<JobTaskRecord | "not_found" | "already_done">;
  abstract createQuote(
    input: {
      customerCompanyId: string;
      serviceLine: ServiceLine;
      quoteRequestId: string | null;
      version: QuoteVersionInput;
    },
    createdBy: string,
  ): Promise<string>;
  abstract listQuotes(scope: JobScope): Promise<QuoteSummaryRecord[]>;
  /** Customers (a scope with company IDs) only ever see issued versions. */
  abstract findQuote(id: string, scope: JobScope): Promise<QuoteRecord | null>;
  abstract saveQuoteVersionDraft(
    quoteId: string,
    content: QuoteVersionInput,
  ): Promise<"saved" | "no_draft">;
  abstract startQuoteVersion(
    quoteId: string,
    createdBy: string,
  ): Promise<"started" | "draft_exists">;
  abstract issueQuoteVersion(
    quoteId: string,
    issuedBy: string,
    year: number,
  ): Promise<"issued" | "no_draft" | "no_lines">;
  /**
   * Records the client's decision on the latest issued version. Accepting also
   * opens the job in the same transaction. Repeating the same decision returns
   * the stored one (and its job) instead of creating another.
   */
  abstract decideQuote(input: {
    quoteId: string;
    versionNumber: number;
    decision: QuoteDecision;
    clientSignatory: string;
    decidedAt: string;
    note: string | null;
    recordedBy: string;
    year: number;
  }): Promise<
    | { decision: QuoteDecisionRecord; job: JobRecord | null }
    | "version_not_found"
    | "not_issued"
    | "not_latest"
    | "already_decided"
  >;
  abstract getBusinessSettings(): Promise<BusinessSettingsRevisionRecord | null>;
  abstract listBusinessSettingsRevisions(): Promise<
    BusinessSettingsRevisionRecord[]
  >;
  abstract saveBusinessSettings(
    settings: BusinessSettings,
    changedBy: string,
  ): Promise<BusinessSettingsRevisionRecord>;
  /** Null when this quote line and container-size combination is already on the job. */
  abstract createJobCharge(charge: {
    jobId: string;
    kind: ChargeKind;
    description: string;
    currency: string;
    quantity: number;
    unitQuotedMinor: number | null;
    quoteLineId: string | null;
    quoteContainerSize: string | null;
    createdBy: string;
  }): Promise<JobChargeRecord | null>;
  abstract listJobCharges(jobId: string): Promise<JobChargeRecord[]>;
  abstract removeJobCharge(
    jobId: string,
    chargeId: string,
    removedBy: string,
  ): Promise<"removed" | "not_found" | "has_actuals">;
  abstract appendChargeActual(actual: {
    jobId: string;
    chargeId: string;
    amountMinor: number;
    currency: string;
    exchangeRate: string | null;
    convertedMinor: number | null;
    rateNote: string | null;
    supplierDocumentId: string | null;
    note: string | null;
    correctionOf: string | null;
    recordedBy: string;
  }): Promise<
    | ChargeActualRecord
    | "charge_not_found"
    | "document_invalid"
    | "correction_not_found"
  >;
  /** The accepted version's lines for the quote this job was opened from. */
  abstract findAcceptedQuoteLines(jobId: string): Promise<{
    currency: string;
    sizeLabels: string[];
    lines: QuoteLineRecord[];
  } | null>;
  abstract createDriver(
    driver: { name: string; phone: string },
    createdBy: string,
  ): Promise<DriverRecord>;
  abstract listDrivers(): Promise<DriverRecord[]>;
  abstract setDriverActive(
    id: string,
    active: boolean,
  ): Promise<DriverRecord | null>;
  abstract createVehicle(
    vehicle: { registration: string; description: string | null },
    createdBy: string,
  ): Promise<VehicleRecord | "duplicate_registration">;
  abstract listVehicles(): Promise<VehicleRecord[]>;
  abstract setVehicleActive(
    id: string,
    active: boolean,
  ): Promise<VehicleRecord | null>;
  abstract createDelivery(
    delivery: {
      jobId: string;
      driverId: string;
      vehicleId: string;
      cargoDescription: string;
      packages: number | null;
      grossWeightKg: number | null;
      pickupLocation: string | null;
      deliveryAddress: string;
    },
    dispatchedBy: string,
    year: number,
  ): Promise<DeliveryRecord | "driver_unavailable" | "vehicle_unavailable">;
  abstract listDeliveries(jobId: string): Promise<DeliveryRecord[]>;
  abstract recordProofOfDelivery(
    jobId: string,
    deliveryId: string,
    proof: {
      receiverName: string;
      receiverPhone: string | null;
      deliveredAt: string;
      damageNotes: string | null;
      podDocumentId: string | null;
    },
    recordedBy: string,
  ): Promise<
    DeliveryRecord | "not_found" | "already_delivered" | "document_invalid"
  >;
  abstract createInvoice(invoice: {
    jobId: string;
    currency: string;
    lines: InvoiceLineRecord[];
    dueDate: string | null;
    notes: string | null;
    totals: InvoiceTotals;
    createdBy: string;
  }): Promise<InvoiceRecord>;
  abstract listInvoices(jobId: string): Promise<InvoiceRecord[]>;
  /** Every payment on the job's invoices, oldest first, with any reversal. */
  abstract listInvoicePayments(jobId: string): Promise<InvoicePaymentRecord[]>;
  abstract updateDraftInvoice(
    jobId: string,
    invoiceId: string,
    draft: {
      currency: string;
      lines: InvoiceLineRecord[];
      dueDate: string | null;
      notes: string | null;
      totals: InvoiceTotals;
    },
  ): Promise<InvoiceRecord | "not_found" | "not_draft">;
  abstract issueInvoice(
    jobId: string,
    invoiceId: string,
    issue: {
      issuedBy: string;
      year: number;
      dueDate: string | null;
      totals: InvoiceTotals;
    },
  ): Promise<InvoiceRecord | "not_found" | "not_draft" | "no_lines">;
  abstract voidInvoice(
    jobId: string,
    invoiceId: string,
    voidedBy: string,
    reason: string,
  ): Promise<InvoiceRecord | "not_found" | "already_void" | "has_payments">;
  abstract recordInvoicePayment(
    jobId: string,
    invoiceId: string,
    payment: {
      amountMinor: number;
      receivedOn: string;
      method: InvoicePaymentRecord["method"];
      reference: string | null;
      evidenceDocumentId: string | null;
      note: string | null;
    },
    recordedBy: string,
    year: number,
  ): Promise<
    | InvoicePaymentRecord
    | "not_found"
    | "not_issued"
    | "exceeds_balance"
    | "document_invalid"
  >;
  abstract reverseInvoicePayment(
    jobId: string,
    invoiceId: string,
    paymentId: string,
    reason: string,
    reversedBy: string,
  ): Promise<InvoicePaymentRecord | "not_found" | "already_reversed">;
  abstract addJobCorrespondence(entry: {
    jobId: string;
    channel: JobCorrespondenceRecord["channel"];
    direction: JobCorrespondenceRecord["direction"];
    occurredAt: string;
    counterparty: string | null;
    subject: string | null;
    body: string;
    documentId: string | null;
    recordedBy: string;
  }): Promise<JobCorrespondenceRecord | "document_invalid">;
  /** Newest first by the time the exchange happened. */
  abstract listJobCorrespondence(
    jobId: string,
  ): Promise<JobCorrespondenceRecord[]>;
  abstract listWarehouseLocations(): Promise<WarehouseLocationRecord[]>;
  abstract createWarehouseLocation(
    name: string,
    createdBy: string,
  ): Promise<WarehouseLocationRecord | "duplicate_name">;
  abstract setWarehouseLocationActive(
    id: string,
    active: boolean,
  ): Promise<WarehouseLocationRecord | null>;
  abstract addStockMovement(movement: {
    jobId: string;
    locationId: string;
    kind: StockMovementRecord["kind"];
    item: string;
    unit: string;
    quantity: number;
    conditionNotes: string | null;
    reference: string | null;
    occurredAt: string;
    recordedBy: string;
  }): Promise<
    StockMovementRecord | "location_unavailable" | "insufficient_stock"
  >;
  /** Newest first by the time the goods moved. */
  abstract listStockMovements(jobId: string): Promise<StockMovementRecord[]>;
  /** Balances above zero as of the end of `asOf` (a YYYY-MM-DD date), or now. */
  abstract listStockBalances(filter: {
    asOf: string | null;
    jobId: string | null;
    companyId: string | null;
    scope: JobScope;
  }): Promise<StockBalanceRecord[]>;
  /** One notification and its deliveries; "duplicate" if this event was already queued. */
  abstract queueNotification(notification: {
    companyId: string;
    jobId: string | null;
    event: string;
    dedupeKey: string;
    subject: string;
    body: string;
    smsText: string;
    linkUrl: string | null;
    createdBy: string | null;
    deliveries: Array<{
      contactId: string | null;
      channel: "email" | "sms";
      recipient: string | null;
      /** Set when the delivery cannot be attempted (no address, bad number). */
      skipReason: string | null;
    }>;
  }): Promise<NotificationRecord | "duplicate">;
  /** Claims pending deliveries that are due; a lease keeps two workers off the same one. */
  abstract claimDueDeliveries(limit: number): Promise<DueDelivery[]>;
  abstract markDeliverySent(
    id: string,
    provider: string,
    providerMessageId: string | null,
  ): Promise<void>;
  abstract markDeliveryFailed(
    id: string,
    error: string,
    retryInSeconds: number | null,
  ): Promise<void>;
  abstract listJobNotifications(jobId: string): Promise<NotificationRecord[]>;
  abstract listNotificationLog(filter: {
    status: NotificationDeliveryRecord["status"] | null;
    limit: number;
  }): Promise<NotificationLogRow[]>;
  /**
   * Client messages across all companies and jobs, newest first. A scope with
   * service lines keeps the messages about jobs on those lines, plus messages
   * that are not about a job.
   */
  abstract listNotificationFeed(filter: {
    companyId: string | null;
    event: string | null;
    serviceLines: ServiceLine[] | null;
    limit: number;
  }): Promise<NotificationFeedRow[]>;
  abstract retryNotificationDelivery(
    id: string,
  ): Promise<NotificationDeliveryRecord | "not_found" | "not_failed">;
  abstract listEtaReminderCandidates(
    withinHours: number,
  ): Promise<EtaReminderCandidate[]>;
  abstract createDocumentExtraction(extraction: {
    jobId: string;
    documentId: string;
    versionNumber: number;
    textFound: boolean;
    fields: ExtractionFieldRecord[];
    createdBy: string;
  }): Promise<DocumentExtractionRecord>;
  abstract listDocumentExtractions(
    jobId: string,
  ): Promise<DocumentExtractionRecord[]>;
  abstract reviewDocumentExtraction(
    jobId: string,
    extractionId: string,
    review: {
      status: "approved" | "rejected";
      applied: ExtractionApplyResult[] | null;
      reviewedBy: string;
    },
  ): Promise<DocumentExtractionRecord | "not_found" | "not_draft">;
  abstract createTransportDocument(document: {
    jobId: string;
    kind: TransportDocumentRecord["kind"];
    documentNumber: string | null;
    fields: Record<string, string>;
    createdBy: string;
  }): Promise<TransportDocumentRecord>;
  abstract listTransportDocuments(
    jobId: string,
  ): Promise<TransportDocumentRecord[]>;
  abstract updateTransportDocumentDraft(
    jobId: string,
    documentId: string,
    draft: { documentNumber: string | null; fields: Record<string, string> },
  ): Promise<TransportDocumentRecord | "not_found" | "not_draft">;
  abstract issueTransportDocument(
    jobId: string,
    documentId: string,
    issuedBy: string,
  ): Promise<
    | TransportDocumentRecord
    | "not_found"
    | "not_draft"
    | "no_number"
    | "number_taken"
  >;
  abstract voidTransportDocument(
    jobId: string,
    documentId: string,
    voidedBy: string,
    reason: string,
  ): Promise<TransportDocumentRecord | "not_found" | "already_void">;
  /** Issued invoices with something still owing, within the caller's scope. */
  abstract listOutstandingInvoices(filter: {
    companyId: string | null;
    scope: JobScope;
  }): Promise<OutstandingInvoiceRecord[]>;
  abstract listJobFinance(scope: JobScope): Promise<JobFinanceRecord[]>;
  abstract listCustomerInsights(
    companyId: string | null,
  ): Promise<CustomerInsightRecord[]>;
  abstract listLeads(): Promise<LeadRecord[]>;
  abstract findLead(id: string): Promise<LeadRecord | null>;
  /** Fails with "duplicate_request" or "unknown_reference" instead of throwing. */
  abstract createLead(
    input: Omit<
      LeadRecord,
      | "ownerEmail"
      | "customerCompanyName"
      | "updatedAt"
      | "stageChangedAt"
      | "createdAt"
    > & { createdBy: string },
  ): Promise<LeadRecord | "duplicate_request" | "unknown_reference">;
  abstract saveLead(
    lead: LeadRecord,
  ): Promise<LeadRecord | "unknown_reference" | null>;
  abstract recordActivity(entry: ActivityEntry): Promise<void>;
  abstract listActivity(filter: ActivityFilter): Promise<ActivityRecord[]>;
  abstract getActiveCustomerCompanyIds(userId: string): Promise<string[]>;
  abstract listActiveCustomerMemberships(): Promise<
    ActiveCustomerMembershipRecord[]
  >;
  abstract listCustomerMemberships(
    userId: string,
  ): Promise<CustomerMembershipRecord[]>;
  abstract grantCustomerMembership(
    companyId: string,
    userId: string,
    grantedBy: string,
  ): Promise<CustomerMembershipRecord | "already_active">;
  abstract revokeCustomerMembership(
    companyId: string,
    userId: string,
    revokedBy: string,
  ): Promise<boolean>;
  abstract hasActiveSuperAdmin(): Promise<boolean>;
  abstract claimInitialSuperAdmin(userId: string): Promise<boolean>;
  abstract getActiveStaffRoles(userId: string): Promise<StaffRoleKey[]>;
  abstract listStaffRoleAssignments(): Promise<StaffRoleAssignmentRecord[]>;
  abstract assignStaffRole(
    userId: string,
    roleKey: StaffRoleKey,
    assignedBy: string,
  ): Promise<
    StaffRoleAssignmentRecord | "super_admin_exists" | "already_active"
  >;
  abstract revokeStaffRole(
    userId: string,
    roleKey: StaffRoleKey,
    revokedBy: string,
  ): Promise<"revoked" | "not_found" | "last_super_admin">;
}
