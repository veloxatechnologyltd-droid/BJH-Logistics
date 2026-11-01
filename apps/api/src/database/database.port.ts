import type {
  BusinessSettings,
  ChargeKind,
  DocumentType,
  QuoteDecision,
  QuoteBasis,
  QuoteVersionInput,
  RequestKind,
  TaskKind,
  JobStatus,
  PartyRole,
  ReferenceKind,
  CustomerContactUpdate,
  CustomerCompanyUpdate,
  LeadSource,
  LeadStage,
  RequestDetails,
} from "@bjh/contracts";

export interface DatabaseHealth {
  status: "ok" | "error";
  provider: "postgresql";
  schemaVersion?: string;
}

/** An attachment kept from an email that became a request. */
export interface RequestAttachmentRecord {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** What is known about the email a request came from; null on requests made any other way. */
export interface RequestIntakeRecord {
  subject: string;
  fromName: string | null;
  fromEmail: string;
  receivedAt: string;
  /** `pending`: waiting to be read; `failed`: could not be read, so the details are for a person to fill in. */
  extractionStatus: "pending" | "done" | "failed";
  extractionError: string | null;
  /** When a person checked the details, and who. Null until then. */
  reviewedAt: string | null;
  reviewedBy: string | null;
  attachments: RequestAttachmentRecord[];
  /** Attachments that were not kept, and why. */
  skippedAttachments: Array<{ filename: string; reason: string }>;
  /** A request for a quote, a question, or something else, as AI read it. */
  kind: RequestKind | null;
  /** What the assistant did with the email, in order. */
  assistantNotes: string[];
  /** The reply the assistant drafted, as a person last saved it; null until one is drafted. */
  reply: RequestReplyRecord | null;
  /** The assistant could not answer by itself, and why; a person must read and send the reply. */
  escalation: { at: string; reason: string } | null;
}

export interface RequestReplyRecord {
  subject: string;
  body: string;
  /** The model that drafted it; null when a person wrote it. */
  model: string | null;
  draftedAt: string | null;
  sentAt: string | null;
  sentBy: string | null;
  /** The assistant sent it by itself (ASSISTANT_AUTO_REPLY), so no person did. */
  sentByAssistant: boolean;
  /** Titles of the knowledge entries the drafted reply drew on. */
  sources: string[];
}

/** How a request reached BJH. The website's quote form takes the same intake as an email. */
export type QuoteRequestSource = "portal" | "staff" | "email" | "website";

/** Which inbox a request belongs to: quote requests, or questions (inquiries). The mailbox the email reached decides; a person may move it. */
export type RequestMailbox = "quotes" | "inquiries";

/** One topic the assistant may answer inquiries from, written by BJH. */
export interface KnowledgeEntryRecord {
  id: string;
  title: string;
  answer: string;
  updatedAt: string;
  updatedBy: string;
}

export interface QuoteRequestRecord {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  message: string;
  createdAt: string;
  /** Null on requests made before this was recorded (and for a customer, who is not told). */
  source: QuoteRequestSource | null;
  mailbox: RequestMailbox;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  /** The quote prepared for this request (the newest one), if any. */
  quoteId: string | null;
  quoteNumber: string | null;
  quoteStatus: "draft" | "issued" | null;
  /** Service, route, cargo and so on; every detail may be unknown. */
  details: RequestDetails;
  intake: RequestIntakeRecord | null;
}

/** An email waiting to be read for its request details. */
export interface EmailToRead {
  requestId: string;
  fromName: string | null;
  fromEmail: string;
  subject: string;
  bodyText: string;
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
  /** Null when the email assistant drafted this version. */
  createdBy: string | null;
  createdByAssistant: boolean;
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
  /** Null when the email assistant drafted the quote. */
  createdBy: string | null;
  createdByAssistant: boolean;
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

/** One payment of a batch, with the invoice it settled and what that invoice still owes. */
export interface PaymentBatchLine {
  payment: InvoicePaymentRecord;
  invoiceNumber: string;
  jobId: string;
  /** What the invoice still owes after this payment. */
  balanceMinor: number;
}

export type PaymentBatchResult =
  | { recorded: PaymentBatchLine[]; companyId: string; currency: string }
  | {
      failed:
        | "not_found"
        | "not_issued"
        | "mixed_customers"
        | "mixed_currencies"
        | "exceeds_balance";
      /** The invoice the failure is about, when there is one. */
      invoiceNumber: string | null;
    };

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

export interface ReportInvoiceRecord {
  jobId: string;
  fileNumber: string;
  customerCompanyName: string;
  invoice: InvoiceRecord;
}

export interface ReportPaymentRecord {
  jobId: string;
  fileNumber: string;
  customerCompanyName: string;
  currency: string;
  invoiceNumber: string;
  payment: InvoicePaymentRecord;
}

export interface ReportStockMovementRecord {
  jobId: string;
  fileNumber: string;
  customerCompanyName: string;
  movement: StockMovementRecord;
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
  companyId: string;
  event: string;
  dedupeKey: string;
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

/** A shipment reference, a party (by role) or the ETA. */
export type ExtractionFieldKey = ReferenceKind | PartyRole | "eta";

export interface ExtractionFieldRecord {
  key: ExtractionFieldKey;
  label: string;
  /** The reference or party name; for the ETA, an ISO date and time. */
  value: string;
  sealNumber: string | null;
  /** A party's address and contact lines; absent on older drafts. */
  details?: string | null;
  evidence: string;
}

export interface ExtractionApplyResult {
  index: number;
  key: ExtractionFieldKey;
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
  /** The AI model that read the document; null when its text layer was read here. */
  readBy: string | null;
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

/**
 * One bill from any job: a house B/L, house air waybill or air manifest
 * (prepared on the job) or a road waybill (numbered at dispatch).
 */
export interface ShippingDocumentRecord {
  kind: TransportDocumentRecord["kind"] | "waybill";
  id: string;
  jobId: string;
  fileNumber: string;
  serviceLine: ServiceLine;
  customerCompanyName: string;
  /** Null for a house document still without its number. */
  number: string | null;
  status: TransportDocumentRecord["status"] | DeliveryRecord["status"];
  /** When it was issued or dispatched; a draft's creation time. */
  date: string;
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

/**
 * One line of a customer's account: an issued invoice (money owed) or a
 * payment still standing against one (money received). Reversed payments and
 * voided invoices are not entries.
 */
export interface StatementEntryRecord {
  kind: "invoice" | "payment";
  /** YYYY-MM-DD: the day the invoice was issued or the payment received. */
  date: string;
  recordedAt: string;
  currency: string;
  amountMinor: number;
  invoiceNumber: string;
  fileNumber: string;
  /** Containers, bills of lading and air waybills the job holds. */
  jobReferences: Array<{ kind: string; value: string }>;
  /** Payments only. */
  receiptNumber: string | null;
  method: InvoicePaymentRecord["method"] | null;
  reference: string | null;
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
    request: Omit<
      QuoteRequestRecord,
      "details" | "intake" | "source" | "mailbox"
    > & {
      source: "portal" | "staff";
    },
  ): Promise<QuoteRequestRecord>;
  /** A request made from an email, saved with the email and its attachments in one step. */
  abstract createEmailQuoteRequest(input: {
    email: {
      messageId: string;
      fromEmail: string;
      fromName: string | null;
      toAddress: string | null;
      subject: string;
      bodyText: string;
      receivedAt: string;
    };
    request: {
      id: string;
      companyName: string;
      contactName: string;
      message: string;
      source: "email" | "website";
      mailbox: RequestMailbox;
    };
    attachments: Array<{
      filename: string;
      contentType: string;
      sizeBytes: number;
      sha256: string;
      objectKey: string;
    }>;
    skipped: Array<{ filename: string; reason: string }>;
  }): Promise<{ request: QuoteRequestRecord; duplicate: boolean }>;
  abstract findQuoteRequestByMessageId(
    messageId: string,
  ): Promise<QuoteRequestRecord | null>;
  /** Records what the AI read (or why it could not), and fills the request's details. */
  abstract completeEmailReading(
    requestId: string,
    outcome:
      | {
          status: "done";
          model: string;
          companyName: string | null;
          contactName: string | null;
          details: RequestDetails;
          kind: RequestKind | null;
        }
      | { status: "failed"; model: string | null; error: string },
  ): Promise<QuoteRequestRecord | null>;
  /** The full text of the email a request came from; null for a request that did not come by email. */
  abstract findInboundEmailBody(requestId: string): Promise<string | null>;
  /** Adds to the list of what the assistant did with an email request. */
  abstract addAssistantNotes(requestId: string, notes: string[]): Promise<void>;
  /** Saves the reply of an email request until it is sent; a sent reply never changes. */
  abstract saveRequestReply(
    requestId: string,
    reply: {
      subject: string;
      body: string;
      model: string | null;
      /** Knowledge entry titles the AI drew on; a person's edit keeps the ones saved. */
      sources?: string[];
    },
  ): Promise<QuoteRequestRecord | "not_found" | "sent">;
  /** Marks an email request as needing a person (with why), or clears that with null. */
  abstract setRequestEscalation(
    requestId: string,
    reason: string | null,
  ): Promise<void>;
  /** Moves a request to the other inbox; its kind follows, so the assistant treats it as the inbox's kind. */
  abstract moveRequestMailbox(
    requestId: string,
    mailbox: RequestMailbox,
  ): Promise<QuoteRequestRecord | null>;
  abstract listKnowledgeEntries(): Promise<KnowledgeEntryRecord[]>;
  abstract createKnowledgeEntry(entry: {
    title: string;
    answer: string;
    updatedBy: string;
  }): Promise<KnowledgeEntryRecord>;
  abstract updateKnowledgeEntry(
    id: string,
    entry: { title: string; answer: string; updatedBy: string },
  ): Promise<KnowledgeEntryRecord | null>;
  abstract deleteKnowledgeEntry(id: string): Promise<boolean>;
  /** Records that the reply went out, with the message that carried it. */
  abstract markRequestReplySent(
    requestId: string,
    sent: {
      subject: string;
      body: string;
      /** Null when the assistant sent it by itself. */
      sentBy: string | null;
      notificationId: string;
    },
  ): Promise<QuoteRequestRecord | "sent">;
  /**
   * Puts an email request back to "waiting to be read" and returns its email,
   * unless it is not an email request or a person already checked it.
   */
  abstract beginEmailReading(
    requestId: string,
  ): Promise<EmailToRead | "not_found" | "not_email" | "reviewed">;
  /** A person's corrected details, which also records that they checked them. */
  abstract saveRequestDetails(
    requestId: string,
    details: RequestDetails,
    reviewedBy: string,
  ): Promise<QuoteRequestRecord | "not_found" | "not_email">;
  abstract findRequestAttachment(
    requestId: string,
    attachmentId: string,
  ): Promise<{ filename: string; objectKey: string } | null>;
  /** The customer company that has a contact with exactly this email address, if there is one. */
  abstract findCustomerByContactEmail(
    email: string,
  ): Promise<{ id: string; companyName: string } | null>;
  /** The requests of one inbox (quote requests unless asked for inquiries). */
  abstract listQuoteRequests(
    customerCompanyId?: string,
    allowedCompanyIds?: string[],
    mailbox?: RequestMailbox,
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
    /** Null when the email assistant drafts it. */
    createdBy: string | null,
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
  /**
   * One customer payment applied to several invoices, all or nothing: every
   * invoice must be issued, in scope, the same customer's and the same
   * currency, and no invoice may be paid beyond its balance.
   */
  abstract recordPaymentBatch(
    batch: {
      receivedOn: string;
      method: InvoicePaymentRecord["method"];
      reference: string | null;
      note: string | null;
      allocations: Array<{ invoiceId: string; amountMinor: number }>;
    },
    recordedBy: string,
    year: number,
    scope: JobScope,
  ): Promise<PaymentBatchResult>;
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
    readBy: string | null;
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
  /** Every house document and road waybill within the scope, newest first. */
  abstract listShippingDocuments(
    scope: JobScope,
  ): Promise<ShippingDocumentRecord[]>;
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
  /** Every issued invoice and standing payment of one customer company, any currency, oldest first. */
  abstract listStatementEntries(
    companyId: string,
  ): Promise<StatementEntryRecord[]>;
  abstract listJobFinance(scope: JobScope): Promise<JobFinanceRecord[]>;
  abstract listReportInvoices(
    from: string,
    to: string,
    scope: JobScope,
  ): Promise<ReportInvoiceRecord[]>;
  abstract listReportPayments(
    from: string,
    to: string,
    scope: JobScope,
  ): Promise<ReportPaymentRecord[]>;
  abstract listReportStockMovements(
    from: string,
    to: string,
    scope: JobScope,
  ): Promise<ReportStockMovementRecord[]>;
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
    > & {
      /** Null when the assistant opened the lead itself. */
      createdBy: string | null;
    },
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
