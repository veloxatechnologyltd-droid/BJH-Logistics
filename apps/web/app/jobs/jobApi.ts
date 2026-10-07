import type {
  DocumentType,
  JobStatus,
  MilestoneDefinition,
  PartyRole,
  ReferenceKind,
  ServiceLine,
  StaffRoleKey,
  TaskKind,
  ChargeKind,
  PaymentMethod,
  CorrespondenceChannel,
  CorrespondenceDirection,
  StockKind,
  TransportDocumentKind,
} from "@bjh/contracts";
import { authenticatedFetch } from "../auth/authenticatedFetch";

export type Job = {
  id: string;
  fileNumber: string;
  serviceLine: ServiceLine;
  customerCompanyId: string;
  customerCompanyName: string;
  quoteRequestId: string | null;
  quoteId: string | null;
  status: JobStatus;
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
};

export type MilestoneEvent = {
  id: string;
  milestoneKey: string;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string;
  source: "manual" | "system";
  note: string | null;
  correctionOf: string | null;
};

export type Timeline = {
  job: Job;
  template: MilestoneDefinition[];
  events: MilestoneEvent[];
};

export type StatusHistory = {
  job: Job;
  allowedNext: JobStatus[];
  history: Array<{
    id: string;
    fromStatus: JobStatus;
    toStatus: JobStatus;
    reason: string | null;
    changedBy: string;
    changedAt: string;
  }>;
};

export type Party = {
  id: string;
  role: PartyRole;
  name: string;
  details: string | null;
};

export type Reference = {
  id: string;
  kind: ReferenceKind;
  value: string;
  sealNumber: string | null;
  parentReferenceId: string | null;
};

export const serviceLineLabels: Record<ServiceLine, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};

export const statusLabels: Record<JobStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  ready_to_close: "Ready to close",
  closed: "Closed",
  cancelled: "Cancelled",
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const jobsUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/jobs`;

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

function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  return authenticatedFetch(`${jobsUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((response) => readResponse<T>(response));
}

export const listJobs = (search: string) =>
  send<Job[]>(`?${new URLSearchParams({ search })}`, "GET");
export const createJob = (input: {
  customerCompanyId: string;
  serviceLine: ServiceLine;
}) => send<Job>("", "POST", input);
export const getTimeline = (id: string) =>
  send<Timeline>(`/${encodeURIComponent(id)}/milestones`, "GET");
export const recordMilestone = (
  id: string,
  input: {
    milestoneKey: string;
    occurredAt?: string;
    note?: string;
    correctionOf?: string;
  },
) =>
  send<MilestoneEvent>(`/${encodeURIComponent(id)}/milestones`, "POST", input);
export const getStatusHistory = (id: string) =>
  send<StatusHistory>(`/${encodeURIComponent(id)}/status-history`, "GET");
export const changeStatus = (
  id: string,
  input: { status: JobStatus; reason?: string },
) => send<Job>(`/${encodeURIComponent(id)}/status`, "POST", input);
export const listParties = (id: string) =>
  send<Party[]>(`/${encodeURIComponent(id)}/parties`, "GET");
export const addParty = (
  id: string,
  input: { role: PartyRole; name: string; details?: string },
) => send<Party>(`/${encodeURIComponent(id)}/parties`, "POST", input);
export const removeParty = (id: string, partyId: string) =>
  send<unknown>(
    `/${encodeURIComponent(id)}/parties/${encodeURIComponent(partyId)}`,
    "DELETE",
  );
export const listReferences = (id: string) =>
  send<Reference[]>(`/${encodeURIComponent(id)}/references`, "GET");
export const addReference = (
  id: string,
  input: {
    kind: ReferenceKind;
    value: string;
    sealNumber?: string;
    parentReferenceId?: string;
  },
) => send<Reference>(`/${encodeURIComponent(id)}/references`, "POST", input);
export const removeReference = (id: string, referenceId: string) =>
  send<unknown>(
    `/${encodeURIComponent(id)}/references/${encodeURIComponent(referenceId)}`,
    "DELETE",
  );

export type JobDocument = {
  id: string;
  documentType: DocumentType;
  createdAt: string;
  versions: Array<{
    versionNumber: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
};

export type DownloadLink = {
  url: string;
  expiresInSeconds: number;
  filename: string;
};

export const listDocuments = (id: string) =>
  send<JobDocument[]>(`/${encodeURIComponent(id)}/documents`, "GET");

export async function uploadDocument(
  id: string,
  input: { file: File; documentType: DocumentType; documentId?: string },
): Promise<JobDocument> {
  const form = new FormData();
  form.append("documentType", input.documentType);
  if (input.documentId) form.append("documentId", input.documentId);
  form.append("file", input.file);
  // No content-type header: the browser adds the multipart boundary.
  return readResponse<JobDocument>(
    await authenticatedFetch(`${jobsUrl}/${encodeURIComponent(id)}/documents`, {
      method: "POST",
      body: form,
    }),
  );
}

export const getDownloadLink = (
  id: string,
  documentId: string,
  versionNumber: number,
) =>
  send<DownloadLink>(
    `/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/download?version=${versionNumber}`,
    "GET",
  );

export type EtaEvent = {
  id: string;
  etaAt: string;
  source: string;
  note: string | null;
  recordedAt: string;
  recordedBy: string;
  correctionOf: string | null;
};

export type Eta = { current: EtaEvent | null; history: EtaEvent[] };

export const getEta = (id: string) =>
  send<Eta>(`/${encodeURIComponent(id)}/eta`, "GET");
export const recordEta = (
  id: string,
  input: {
    etaAt: string;
    source: string;
    note?: string;
    correctionOf?: string;
  },
) => send<EtaEvent>(`/${encodeURIComponent(id)}/eta`, "POST", input);

export type JobTask = {
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
  completedAt: string | null;
  completionNote: string | null;
};

export const taskKindLabels: Record<TaskKind, string> = {
  task: "Task",
  missing_documents: "Missing documents",
  damage: "Damage",
  delay: "Delay",
  other: "Other",
};

export const roleLabels: Record<StaffRoleKey, string> = {
  super_admin: "Super admin",
  sea_import_rep: "Sea import",
  sea_export_rep: "Sea export",
  air_import_rep: "Air import",
  air_export_rep: "Air export",
};

export const listJobTasks = (id: string) =>
  send<JobTask[]>(`/${encodeURIComponent(id)}/tasks`, "GET");
export const createJobTask = (
  id: string,
  input: {
    kind: TaskKind;
    title: string;
    details?: string;
    assignedRole: StaffRoleKey;
    dueDate?: string;
  },
) => send<JobTask>(`/${encodeURIComponent(id)}/tasks`, "POST", input);
export const completeJobTask = (id: string, taskId: string, note?: string) =>
  send<JobTask>(
    `/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/complete`,
    "POST",
    { note },
  );
export const listTasks = (assignedRole: string, status: "open" | "all") =>
  authenticatedFetch(
    `${apiBaseUrl.replace(/\/$/, "")}/v1/tasks?${new URLSearchParams({
      ...(assignedRole ? { assignedRole } : {}),
      status,
    })}`,
  ).then((response) => readResponse<JobTask[]>(response));

export type ChargeActual = {
  id: string;
  amountMinor: number;
  currency: string;
  exchangeRate: string | null;
  convertedMinor: number | null;
  rateNote: string | null;
  supplierDocumentId: string | null;
  note: string | null;
  recordedAt: string;
};

export type JobCharge = {
  id: string;
  kind: ChargeKind;
  description: string;
  currency: string;
  quantity: number;
  unitQuotedMinor: number | null;
  quoteContainerSize: string | null;
  quotedTotalMinor: number | null;
  currentActual: ChargeActual | null;
  actuals: ChargeActual[];
  varianceMinor: number | null;
  evidenceMissing: boolean;
};

export type ChargeTotals = {
  currency: string;
  quotedMinor: number;
  actualMinor: number;
  chargesWithoutActual: number;
  disbursementsWithoutEvidence: number;
};

export const listCharges = (id: string) =>
  send<{ charges: JobCharge[]; totals: ChargeTotals[] }>(
    `/${encodeURIComponent(id)}/charges`,
    "GET",
  );
export const addCharge = (
  id: string,
  input: {
    kind: ChargeKind;
    description: string;
    currency: string;
    quantity?: number;
    unitQuotedMinor?: number;
  },
) => send<JobCharge>(`/${encodeURIComponent(id)}/charges`, "POST", input);
export const removeCharge = (id: string, chargeId: string) =>
  send<unknown>(
    `/${encodeURIComponent(id)}/charges/${encodeURIComponent(chargeId)}`,
    "DELETE",
  );
export const importCharges = (
  id: string,
  containerSize?: string,
  quantity = 1,
) =>
  send<{ created: JobCharge[]; skipped: number }>(
    `/${encodeURIComponent(id)}/charges/import-from-quote`,
    "POST",
    { containerSize, quantity },
  );
export const recordActual = (
  id: string,
  chargeId: string,
  input: {
    amountMinor: number;
    currency: string;
    exchangeRate?: string;
    rateNote?: string;
    supplierDocumentId?: string;
    note?: string;
    correctionOf?: string;
  },
) =>
  send<ChargeActual>(
    `/${encodeURIComponent(id)}/charges/${encodeURIComponent(chargeId)}/actuals`,
    "POST",
    input,
  );

export type InvoiceLine = {
  description: string;
  amountMinor: number;
  taxable: boolean;
};

export type InvoicePayment = {
  id: string;
  receiptNumber: string | null;
  amountMinor: number;
  receivedOn: string;
  method: PaymentMethod;
  reference: string | null;
  evidenceDocumentId: string | null;
  note: string | null;
  recordedAt: string;
  reversal: { reason: string; reversedAt: string } | null;
};

export type Invoice = {
  id: string;
  invoiceNumber: string | null;
  status: "draft" | "issued" | "void";
  currency: string;
  lines: InvoiceLine[];
  dueDate: string | null;
  notes: string | null;
  subtotalMinor: number;
  taxLines: Array<{
    name: string;
    rateBasisPoints: number;
    amountMinor: number;
  }>;
  taxTotalMinor: number;
  totalMinor: number;
  issuedAt: string | null;
  voidReason: string | null;
  paidMinor: number;
  outstandingMinor: number;
  paymentStatus: "draft" | "void" | "unpaid" | "partial" | "paid";
  /** Staff only; customers see the balance but not the ledger. */
  payments?: InvoicePayment[];
};

export type InvoiceDraftInput = {
  currency: string;
  lines: InvoiceLine[];
  dueDate?: string;
  notes?: string;
};

export const listInvoices = (id: string) =>
  send<Invoice[]>(`/${encodeURIComponent(id)}/invoices`, "GET");
export const createInvoice = (id: string, input: InvoiceDraftInput) =>
  send<Invoice>(`/${encodeURIComponent(id)}/invoices`, "POST", input);
export const createInvoiceFromCharges = (
  id: string,
  input: { currency: string; dueDate?: string; notes?: string },
) =>
  send<{ invoice: Invoice; skipped: number }>(
    `/${encodeURIComponent(id)}/invoices/from-charges`,
    "POST",
    input,
  );
export const updateInvoice = (
  id: string,
  invoiceId: string,
  input: InvoiceDraftInput,
) =>
  send<Invoice>(
    `/${encodeURIComponent(id)}/invoices/${encodeURIComponent(invoiceId)}`,
    "PUT",
    input,
  );
export const issueInvoice = (id: string, invoiceId: string) =>
  send<Invoice>(
    `/${encodeURIComponent(id)}/invoices/${encodeURIComponent(invoiceId)}/issue`,
    "POST",
    {},
  );
export const voidInvoice = (id: string, invoiceId: string, reason: string) =>
  send<Invoice>(
    `/${encodeURIComponent(id)}/invoices/${encodeURIComponent(invoiceId)}/void`,
    "POST",
    { reason },
  );
export const recordInvoicePayment = (
  id: string,
  invoiceId: string,
  input: {
    amountMinor: number;
    receivedOn: string;
    method: PaymentMethod;
    reference?: string;
    evidenceDocumentId?: string;
    note?: string;
  },
) =>
  send<InvoicePayment>(
    `/${encodeURIComponent(id)}/invoices/${encodeURIComponent(invoiceId)}/payments`,
    "POST",
    input,
  );
export const reverseInvoicePayment = (
  id: string,
  invoiceId: string,
  paymentId: string,
  reason: string,
) =>
  send<InvoicePayment>(
    `/${encodeURIComponent(id)}/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(paymentId)}/reverse`,
    "POST",
    { reason },
  );
export async function fetchInvoicePdf(
  id: string,
  invoiceId: string,
): Promise<Blob> {
  const response = await authenticatedFetch(
    `${jobsUrl}/${encodeURIComponent(id)}/invoices/${encodeURIComponent(invoiceId)}/pdf`,
  );
  if (!response.ok) throw new Error("The invoice could not be created");
  return response.blob();
}

export async function fetchReceiptPdf(
  id: string,
  invoiceId: string,
  paymentId: string,
): Promise<Blob> {
  const response = await authenticatedFetch(
    `${jobsUrl}/${encodeURIComponent(id)}/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(paymentId)}/receipt`,
  );
  if (!response.ok) throw new Error("The receipt could not be created");
  return response.blob();
}

export type CorrespondenceEntry = {
  id: string;
  channel: CorrespondenceChannel;
  direction: CorrespondenceDirection;
  occurredAt: string;
  counterparty: string | null;
  subject: string | null;
  body: string;
  documentId: string | null;
  recordedAt: string;
};

export const listCorrespondence = (id: string) =>
  send<CorrespondenceEntry[]>(
    `/${encodeURIComponent(id)}/correspondence`,
    "GET",
  );
export const addCorrespondence = (
  id: string,
  input: {
    channel: CorrespondenceChannel;
    direction: CorrespondenceDirection;
    occurredAt?: string;
    counterparty?: string;
    subject?: string;
    body: string;
    documentId?: string;
  },
) =>
  send<CorrespondenceEntry>(
    `/${encodeURIComponent(id)}/correspondence`,
    "POST",
    input,
  );

export type WarehouseLocation = {
  id: string;
  name: string;
  deactivatedAt: string | null;
};

export type StockMovement = {
  id: string;
  locationId: string;
  locationName: string;
  kind: StockKind;
  item: string;
  unit: string;
  quantity: number;
  conditionNotes: string | null;
  reference: string | null;
  occurredAt: string;
};

export type StockBalance = {
  jobId: string;
  fileNumber: string;
  customerCompanyId: string;
  customerCompanyName: string;
  locationId: string;
  locationName: string;
  item: string;
  unit: string;
  balance: number;
};

const apiRoot = `${apiBaseUrl.replace(/\/$/, "")}/v1`;

async function sendApi<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  return authenticatedFetch(`${apiRoot}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((response) => readResponse<T>(response));
}

export const listLocations = () =>
  sendApi<WarehouseLocation[]>("/warehouse/locations", "GET");
export const addLocation = (name: string) =>
  sendApi<WarehouseLocation>("/warehouse/locations", "POST", { name });
export const setLocationActive = (id: string, active: boolean) =>
  sendApi<WarehouseLocation>(
    `/warehouse/locations/${encodeURIComponent(id)}/active`,
    "POST",
    { active },
  );
export const getJobStock = (id: string) =>
  send<{ movements: StockMovement[]; balances: StockBalance[] }>(
    `/${encodeURIComponent(id)}/stock`,
    "GET",
  );
export const addStockMovement = (
  id: string,
  input: {
    locationId: string;
    kind: StockKind;
    item: string;
    unit?: string;
    quantity: number;
    conditionNotes?: string;
    reference?: string;
    occurredAt?: string;
  },
) => send<StockMovement>(`/${encodeURIComponent(id)}/stock`, "POST", input);
export const getStockReport = (asOf: string, companyId: string) => {
  const query = new URLSearchParams();
  if (asOf) query.set("asOf", asOf);
  if (companyId) query.set("companyId", companyId);
  return sendApi<{ asOf: string | null; balances: StockBalance[] }>(
    `/stock/report${query.size > 0 ? `?${query}` : ""}`,
    "GET",
  );
};

export type NotificationDelivery = {
  id: string;
  channel: "email" | "sms";
  contactName: string | null;
  recipient: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  provider: string | null;
  sentAt: string | null;
};

export type JobNotification = {
  id: string;
  event: string;
  subject: string;
  body: string;
  smsText: string;
  linkUrl: string | null;
  createdAt: string;
  deliveries: NotificationDelivery[];
};

export const listJobNotifications = (id: string) =>
  send<JobNotification[]>(`/${encodeURIComponent(id)}/notifications`, "GET");
export const sendJobMessage = (
  id: string,
  input: { subject?: string; body: string },
) =>
  send<JobNotification>(`/${encodeURIComponent(id)}/messages`, "POST", input);

export type ExtractionField = {
  key: string;
  label: string;
  value: string;
  sealNumber: string | null;
  evidence: string;
};

export type Extraction = {
  id: string;
  documentId: string;
  versionNumber: number;
  filename: string | null;
  textFound: boolean;
  fields: ExtractionField[];
  status: "draft" | "approved" | "rejected";
  applied: Array<{
    index: number;
    key: string;
    value: string;
    result: string;
  }> | null;
  createdAt: string;
};

export const listExtractions = (id: string) =>
  send<Extraction[]>(`/${encodeURIComponent(id)}/extractions`, "GET");
export const extractDocument = (id: string, documentId: string) =>
  send<Extraction>(
    `/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/extract`,
    "POST",
  );
export const approveExtraction = (
  id: string,
  extractionId: string,
  fields: Array<{ index: number; value: string; sealNumber?: string }>,
) =>
  send<Extraction>(
    `/${encodeURIComponent(id)}/extractions/${encodeURIComponent(extractionId)}/approve`,
    "POST",
    { fields },
  );
export const rejectExtraction = (id: string, extractionId: string) =>
  send<Extraction>(
    `/${encodeURIComponent(id)}/extractions/${encodeURIComponent(extractionId)}/reject`,
    "POST",
  );

export type TransportDocument = {
  id: string;
  kind: TransportDocumentKind;
  documentNumber: string | null;
  status: "draft" | "issued" | "void";
  fields: Record<string, string>;
  issuedAt: string | null;
  voidReason: string | null;
};

export const listTransportDocuments = (id: string) =>
  send<TransportDocument[]>(
    `/${encodeURIComponent(id)}/transport-documents`,
    "GET",
  );
export const prefillTransportDocument = (
  id: string,
  kind: TransportDocumentKind,
) =>
  send<{ documentNumber: string | null; fields: Record<string, string> }>(
    `/${encodeURIComponent(id)}/transport-documents/prefill?kind=${kind}`,
    "GET",
  );
export const createTransportDocument = (
  id: string,
  input: {
    kind: TransportDocumentKind;
    documentNumber?: string;
    fields: Record<string, string>;
  },
) =>
  send<TransportDocument>(
    `/${encodeURIComponent(id)}/transport-documents`,
    "POST",
    input,
  );
export const updateTransportDocument = (
  id: string,
  documentId: string,
  input: { documentNumber?: string; fields: Record<string, string> },
) =>
  send<TransportDocument>(
    `/${encodeURIComponent(id)}/transport-documents/${encodeURIComponent(documentId)}`,
    "PUT",
    input,
  );
export const issueTransportDocument = (id: string, documentId: string) =>
  send<TransportDocument>(
    `/${encodeURIComponent(id)}/transport-documents/${encodeURIComponent(documentId)}/issue`,
    "POST",
    {},
  );
export const voidTransportDocument = (
  id: string,
  documentId: string,
  reason: string,
) =>
  send<TransportDocument>(
    `/${encodeURIComponent(id)}/transport-documents/${encodeURIComponent(documentId)}/void`,
    "POST",
    { reason },
  );
export async function fetchTransportDocumentPdf(
  id: string,
  documentId: string,
): Promise<Blob> {
  const response = await authenticatedFetch(
    `${jobsUrl}/${encodeURIComponent(id)}/transport-documents/${encodeURIComponent(documentId)}/pdf`,
  );
  if (!response.ok) throw new Error("The document could not be created");
  return response.blob();
}

export type OutstandingInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  jobId: string;
  fileNumber: string;
  customerCompanyId: string;
  customerCompanyName: string;
  currency: string;
  totalMinor: number;
  outstandingMinor: number;
  dueDate: string | null;
  overdue: boolean;
  daysOverdue: number;
};

export type FinanceSummary = {
  jobs: Array<{
    jobId: string;
    fileNumber: string;
    customerCompanyName: string;
    currency: string;
    invoicedMinor: number;
    receivedMinor: number;
    owingMinor: number;
    costMinor: number;
    /** Null unless the job has both an invoice and a cost in this currency. */
    marginMinor: number | null;
  }>;
  totals: Array<{
    currency: string;
    invoicedMinor: number;
    receivedMinor: number;
    owingMinor: number;
    costMinor: number;
  }>;
};

export const getFinanceSummary = () =>
  sendApi<FinanceSummary>("/finance/summary", "GET");

export const getOutstandingInvoices = (companyId: string) =>
  sendApi<{
    invoices: OutstandingInvoice[];
    totals: Array<{
      currency: string;
      outstandingMinor: number;
      overdueMinor: number;
    }>;
  }>(
    `/invoices/outstanding${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`,
    "GET",
  );
