import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
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
  CustomerCompanyUpdate,
  CustomerContactUpdate,
  LeadSource,
  LeadStage,
} from "@bjh/contracts";
import {
  ActiveCustomerMembershipRecord,
  ActivityEntry,
  ActivityFilter,
  ActivityRecord,
  DatabaseHealth,
  DatabasePort,
  CustomerCompanyRecord,
  CustomerContactRecord,
  CustomerMembershipRecord,
  JobRecord,
  DocumentRecord,
  DocumentVersionRecord,
  LibraryDocumentRecord,
  JobPartyRecord,
  StoredDocumentVersion,
  JobScope,
  ShipmentReferenceRecord,
  JobStatusChangeRecord,
  MilestoneEventRecord,
  EtaEventRecord,
  JobTaskRecord,
  BusinessSettingsRevisionRecord,
  ChargeActualRecord,
  DeliveryRecord,
  InvoiceLineRecord,
  DocumentExtractionRecord,
  DueDelivery,
  CustomerInsightRecord,
  JobFinanceRecord,
  LeadRecord,
  OutstandingInvoiceRecord,
  TransportDocumentRecord,
  ExtractionApplyResult,
  ExtractionFieldRecord,
  EtaReminderCandidate,
  JobCorrespondenceRecord,
  NotificationDeliveryRecord,
  NotificationFeedRow,
  NotificationLogRow,
  NotificationRecord,
  StockBalanceRecord,
  StockMovementRecord,
  WarehouseLocationRecord,
  InvoicePaymentRecord,
  InvoiceRecord,
  InvoiceTotals,
  DriverRecord,
  JobChargeRecord,
  VehicleRecord,
  QuoteDecisionRecord,
  QuoteLineRecord,
  QuoteRecord,
  QuoteSummaryRecord,
  QuoteVersionRecord,
  ServiceLine,
  QuoteRequestRecord,
  StaffRoleKey,
  StaffRoleAssignmentRecord,
} from "./database.port";

/** Task rows joined to their job; `source` is the table or CTE holding the task. */
const jobTaskSelect = (source: string) => `
  SELECT task.task_id, task.job_id, job.file_number,
    company.company_name, task.kind, task.title, task.details,
    task.assigned_role, to_char(task.due_date, 'YYYY-MM-DD') AS due_date,
    task.status, task.created_at, task.created_by, task.completed_at,
    task.completed_by, task.completion_note
  FROM ${source} AS task
  JOIN app.job AS job ON job.job_id = task.job_id
  JOIN app.customer_company AS company
    ON company.company_id = job.customer_company_id`;

/** Version columns in the order the INSERT/UPDATE statements above expect. */
const quoteVersionValues = (content: QuoteVersionInput) => [
  content.currency,
  content.title,
  content.subtitle,
  content.shipmentScope,
  content.intro,
  content.atCostNote,
  content.procedureSteps,
  content.requiredDocuments,
  content.documentsNote,
  content.timeline,
  content.terms,
  content.sizeLabels,
];

export const POSTGRES_POOL = Symbol("POSTGRES_POOL");

export interface PostgresQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount?: number | null;
}

export interface PostgresClient {
  query(queryText: string, values?: unknown[]): Promise<PostgresQueryResult>;
  release(): void;
}

export interface PostgresPool {
  query(queryText: string, values?: unknown[]): Promise<PostgresQueryResult>;
  connect(): Promise<PostgresClient>;
  end(): Promise<void>;
}

const quoteRequestSelect = `
  SELECT
    request.request_id,
    request.company_name,
    request.contact_name,
    request.email,
    request.message,
    request.created_at,
    request.customer_company_id,
    company.company_name AS customer_company_name,
    latest_quote.quote_id,
    latest_quote.quote_number,
    latest_quote.latest_status AS quote_status
  FROM app.quote_request AS request
  LEFT JOIN app.customer_company AS company
    ON company.company_id = request.customer_company_id
  LEFT JOIN LATERAL (
    SELECT quote.quote_id, quote.quote_number,
           (SELECT version.status FROM app.quote_version AS version
            WHERE version.quote_id = quote.quote_id
            ORDER BY version.version_number DESC LIMIT 1) AS latest_status
    FROM app.quote AS quote
    WHERE quote.quote_request_id = request.request_id
    ORDER BY quote.created_at DESC, quote.quote_id DESC
    LIMIT 1
  ) AS latest_quote ON true`;

const jobSelect = `
  SELECT
    job.job_id,
    job.file_number,
    job.service_line,
    job.customer_company_id,
    company.company_name AS customer_company_name,
    job.quote_request_id,
    job.quote_id,
    job.status,
    job.opened_by,
    job.opened_at,
    job.closed_at
  FROM app.job AS job
  JOIN app.customer_company AS company
    ON company.company_id = job.customer_company_id`;

const customerSelect = `
  SELECT
    company.company_id,
    company.customer_number,
    company.company_name,
    company.trading_name,
    company.registration_number,
    company.tax_number,
    company.phone AS company_phone,
    company.company_email,
    company.website,
    company.business_address,
    company.billing_address,
    company.country,
    company.created_at AS company_created_at,
    contact.contact_id,
    contact.contact_name,
    contact.role AS contact_role,
    contact.is_primary AS contact_is_primary,
    contact.email AS contact_email,
    contact.phone AS contact_phone,
    contact.notify AS contact_notify,
    contact.created_at AS contact_created_at
  FROM app.customer_company AS company
  LEFT JOIN app.customer_contact AS contact ON contact.company_id = company.company_id`;

/** A payment with its reversal (if any) and the receipt date as plain text. */
const PAYMENT_COLUMNS = `p.payment_id, p.invoice_id, p.receipt_number, p.amount_minor,
  to_char(p.received_on, 'YYYY-MM-DD') AS received_on_text, p.method,
  p.reference, p.evidence_document_id, p.note, p.recorded_by, p.recorded_at,
  r.reason AS reversal_reason, r.reversed_by, r.reversed_at`;

@Injectable()
export class PostgresDatabaseService implements DatabasePort, OnModuleDestroy {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: PostgresPool) {}

  async healthCheck(): Promise<DatabaseHealth> {
    try {
      await this.pool.query("SELECT 1");
      return { status: "ok", provider: "postgresql" };
    } catch {
      return { status: "error", provider: "postgresql" };
    }
  }

  async createQuoteRequest(
    request: QuoteRequestRecord,
  ): Promise<QuoteRequestRecord> {
    await this.pool.query(
      `INSERT INTO app.quote_request
        (request_id, company_name, contact_name, email, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        request.id,
        request.companyName,
        request.contactName,
        request.email,
        request.message,
        request.createdAt,
      ],
    );
    const created = await this.findQuoteRequest(request.id);
    if (!created) {
      throw new Error("Created quote request could not be loaded");
    }
    return created;
  }

  async listQuoteRequests(
    customerCompanyId?: string,
    allowedCompanyIds?: string[],
  ): Promise<QuoteRequestRecord[]> {
    if (allowedCompanyIds?.length === 0) return [];
    const result = await this.pool.query(
      `${quoteRequestSelect}
       WHERE ($1::text IS NULL OR request.customer_company_id::text = $1)
         AND ($2::uuid[] IS NULL OR request.customer_company_id = ANY($2::uuid[]))
       ORDER BY request.created_at DESC, request.request_id DESC`,
      [customerCompanyId ?? null, allowedCompanyIds ?? null],
    );
    return result.rows.map((row) => this.toQuoteRequest(row));
  }

  async findQuoteRequest(
    id: string,
    allowedCompanyIds?: string[],
  ): Promise<QuoteRequestRecord | null> {
    if (allowedCompanyIds?.length === 0) return null;
    const result = await this.pool.query(
      `${quoteRequestSelect}
       WHERE request.request_id::text = $1
         AND ($2::uuid[] IS NULL OR request.customer_company_id = ANY($2::uuid[]))`,
      [id, allowedCompanyIds ?? null],
    );
    return result.rows[0] ? this.toQuoteRequest(result.rows[0]) : null;
  }

  async linkQuoteRequestToCustomer(
    requestId: string,
    customerCompanyId: string,
  ): Promise<QuoteRequestRecord | null> {
    const result = await this.pool.query(
      `UPDATE app.quote_request
       SET customer_company_id = $2::uuid
       WHERE request_id::text = $1`,
      [requestId, customerCompanyId],
    );
    if (result.rowCount === 0) {
      return null;
    }
    return this.findQuoteRequest(requestId);
  }

  async createCustomer(
    customer: CustomerCompanyRecord,
  ): Promise<CustomerCompanyRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO app.customer_company
          (company_id, company_name, trading_name, registration_number,
           tax_number, phone, company_email, website, business_address,
           billing_address, country, created_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING customer_number`,
        [
          customer.id,
          customer.companyName,
          customer.tradingName,
          customer.registrationNumber,
          customer.taxNumber,
          customer.phone,
          customer.companyEmail,
          customer.website,
          customer.businessAddress,
          customer.billingAddress,
          customer.country,
          customer.createdAt,
        ],
      );
      customer.customerNumber = String(inserted.rows[0].customer_number);
      for (const contact of customer.contacts) {
        await client.query(
          `INSERT INTO app.customer_contact
            (contact_id, company_id, contact_name, role, email, phone, notify,
             is_primary, created_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
          [
            contact.id,
            customer.id,
            contact.name,
            contact.role,
            contact.email,
            contact.phone ?? null,
            contact.notify ?? true,
            contact.isPrimary ?? false,
            contact.createdAt,
          ],
        );
      }
      await client.query("COMMIT");
      return customer;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async addCustomerContact(
    companyId: string,
    contact: CustomerContactRecord,
  ): Promise<CustomerContactRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const company = await client.query(
        `SELECT 1 FROM app.customer_company WHERE company_id = $1::uuid FOR UPDATE`,
        [companyId],
      );
      if (company.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      if (contact.isPrimary) {
        await client.query(
          `UPDATE app.customer_contact SET is_primary = false
           WHERE company_id = $1::uuid AND is_primary`,
          [companyId],
        );
      }
      const inserted = await client.query(
        `INSERT INTO app.customer_contact
          (contact_id, company_id, contact_name, role, email, phone, notify,
           is_primary, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          contact.id,
          companyId,
          contact.name,
          contact.role,
          contact.email,
          contact.phone ?? null,
          contact.notify ?? true,
          contact.isPrimary,
          contact.createdAt,
        ],
      );
      await client.query("COMMIT");
      return this.mapContact(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateCustomer(
    companyId: string,
    update: CustomerCompanyUpdate,
  ): Promise<CustomerCompanyRecord | null> {
    const result = await this.pool.query(
      `UPDATE app.customer_company
       SET company_name = $2, trading_name = $3, registration_number = $4,
           tax_number = $5, phone = $6, company_email = $7, website = $8,
           business_address = $9, billing_address = $10, country = $11
       WHERE company_id = $1::uuid`,
      [
        companyId,
        update.companyName,
        update.tradingName,
        update.registrationNumber,
        update.taxNumber,
        update.phone,
        update.companyEmail,
        update.website,
        update.businessAddress,
        update.billingAddress,
        update.country,
      ],
    );
    if (result.rowCount === 0) return null;
    return this.findCustomer(companyId);
  }

  async updateCustomerContact(
    companyId: string,
    contactId: string,
    update: CustomerContactUpdate,
  ): Promise<CustomerContactRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const company = await client.query(
        `SELECT 1 FROM app.customer_company WHERE company_id = $1::uuid FOR UPDATE`,
        [companyId],
      );
      if (company.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      if (update.isPrimary) {
        await client.query(
          `UPDATE app.customer_contact SET is_primary = false
           WHERE company_id = $1::uuid AND is_primary`,
          [companyId],
        );
      }
      const updated = await client.query(
        `UPDATE app.customer_contact
         SET contact_name = COALESCE($3, contact_name),
             role = CASE WHEN $4::boolean THEN $5 ELSE role END,
             email = COALESCE($6, email),
             phone = CASE WHEN $7::boolean THEN $8 ELSE phone END,
             notify = COALESCE($9::boolean, notify),
             is_primary = CASE WHEN $10::boolean THEN $11 ELSE is_primary END
         WHERE contact_id = $2::uuid AND company_id = $1::uuid
         RETURNING *`,
        [
          companyId,
          contactId,
          update.name,
          Object.hasOwn(update, "role"),
          update.role,
          update.email,
          Object.hasOwn(update, "phone"),
          update.phone,
          update.notify,
          Object.hasOwn(update, "isPrimary"),
          update.isPrimary,
        ],
      );
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      return this.mapContact(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private mapContact(row: Record<string, unknown>): CustomerContactRecord {
    return {
      id: String(row.contact_id),
      name: String(row.contact_name),
      role: row.role ? String(row.role) : null,
      email: String(row.email),
      isPrimary: row.is_primary === true,
      phone: row.phone ? String(row.phone) : null,
      notify: row.notify !== false,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  async listCustomers(
    search: string,
    companyIds?: string[],
  ): Promise<CustomerCompanyRecord[]> {
    if (companyIds?.length === 0) return [];
    const result = await this.pool.query(
      `${customerSelect}
       WHERE ($1 = ''
       OR strpos(lower(company.company_name), lower($1)) > 0
         OR strpos(lower(company.customer_number), lower($1)) > 0
         OR strpos(lower(COALESCE(company.trading_name, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.registration_number, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.tax_number, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.phone, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.company_email, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.website, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.business_address, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.billing_address, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(company.country, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(contact.role, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(contact.contact_name, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(contact.email, '')), lower($1)) > 0
         OR strpos(lower(COALESCE(contact.phone, '')), lower($1)) > 0)
         AND ($2::uuid[] IS NULL OR company.company_id = ANY($2::uuid[]))
       ORDER BY company.company_name, company.created_at, contact.contact_name`,
      [search, companyIds ?? null],
    );
    return this.groupCustomers(result.rows);
  }

  async findCustomer(
    id: string,
    companyIds?: string[],
  ): Promise<CustomerCompanyRecord | null> {
    if (companyIds?.length === 0) return null;
    const result = await this.pool.query(
      `${customerSelect}
       WHERE company.company_id::text = $1
         AND ($2::uuid[] IS NULL OR company.company_id = ANY($2::uuid[]))
       ORDER BY contact.contact_name`,
      [id, companyIds ?? null],
    );
    return this.groupCustomers(result.rows)[0] ?? null;
  }

  async createJob(
    input: {
      customerCompanyId: string;
      serviceLine: ServiceLine;
      quoteRequestId: string | null;
    },
    openedBy: string,
    year: number,
  ): Promise<JobRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const allocated = await client.query(
        "SELECT app.allocate_job_number($1, $2) AS file_number",
        [input.serviceLine, year],
      );
      const inserted = await client.query(
        `INSERT INTO app.job
          (file_number, service_line, customer_company_id, quote_request_id, opened_by)
         VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid)
         RETURNING job_id`,
        [
          String(allocated.rows[0].file_number),
          input.serviceLine,
          input.customerCompanyId,
          input.quoteRequestId,
          openedBy,
        ],
      );
      const created = await client.query(
        `${jobSelect} WHERE job.job_id = $1::uuid`,
        [String(inserted.rows[0].job_id)],
      );
      await client.query("COMMIT");
      return this.mapJob(created.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listJobs(search: string, scope: JobScope): Promise<JobRecord[]> {
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `${jobSelect}
       WHERE ($1 = ''
         OR strpos(lower(job.file_number), lower($1)) > 0
         OR strpos(lower(company.company_name), lower($1)) > 0
         OR EXISTS (
           SELECT 1 FROM app.shipment_reference AS reference
           WHERE reference.job_id = job.job_id AND reference.removed_at IS NULL
             AND (strpos(lower(reference.reference_value), lower($1)) > 0
               OR strpos(lower(COALESCE(reference.seal_number, '')), lower($1)) > 0))
         OR strpos(to_char(job.opened_at, 'YYYY-MM-DD'), $1) > 0
         OR EXISTS (
           SELECT 1 FROM app.document AS document
           LEFT JOIN app.document_version AS version
             ON version.document_id = document.document_id
           WHERE document.job_id = job.job_id
             AND (strpos(lower(replace(document.document_type, '_', ' ')), lower($1)) > 0
               OR strpos(lower(COALESCE(version.original_filename, '')), lower($1)) > 0
               OR strpos(to_char(document.created_at, 'YYYY-MM-DD'), $1) > 0))
         OR EXISTS (
           SELECT 1 FROM app.job_party AS party
           WHERE party.job_id = job.job_id AND party.removed_at IS NULL
             AND strpos(lower(party.party_name), lower($1)) > 0)
         OR ($2::uuid[] IS NULL AND EXISTS (
           SELECT 1 FROM app.job_correspondence AS entry
           WHERE entry.job_id = job.job_id
             AND (strpos(lower(entry.body), lower($1)) > 0
               OR strpos(lower(COALESCE(entry.subject, '')), lower($1)) > 0
               OR strpos(lower(COALESCE(entry.counterparty, '')), lower($1)) > 0))))
         AND ($2::uuid[] IS NULL OR job.customer_company_id = ANY($2::uuid[]))
         AND ($3::text[] IS NULL OR job.service_line = ANY($3::text[]))
       ORDER BY job.opened_at DESC, job.file_number DESC`,
      [search, scope.companyIds ?? null, scope.serviceLines ?? null],
    );
    return result.rows.map((row) => this.mapJob(row));
  }

  async findJob(id: string, scope: JobScope): Promise<JobRecord | null> {
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return null;
    }
    const result = await this.pool.query(
      `${jobSelect}
       WHERE job.job_id = $1::uuid
         AND ($2::uuid[] IS NULL OR job.customer_company_id = ANY($2::uuid[]))
         AND ($3::text[] IS NULL OR job.service_line = ANY($3::text[]))`,
      [id, scope.companyIds ?? null, scope.serviceLines ?? null],
    );
    return result.rows[0] ? this.mapJob(result.rows[0]) : null;
  }

  private mapJob(row: Record<string, unknown>): JobRecord {
    return {
      id: String(row.job_id),
      fileNumber: String(row.file_number),
      serviceLine: row.service_line as ServiceLine,
      customerCompanyId: String(row.customer_company_id),
      customerCompanyName: String(row.customer_company_name),
      quoteRequestId: row.quote_request_id
        ? String(row.quote_request_id)
        : null,
      quoteId: row.quote_id ? String(row.quote_id) : null,
      status: row.status as JobRecord["status"],
      openedBy: String(row.opened_by),
      openedAt: this.toIsoString(row.opened_at),
      closedAt: row.closed_at ? this.toIsoString(row.closed_at) : null,
    };
  }

  async addJobParty(party: {
    jobId: string;
    role: PartyRole;
    name: string;
    details: string | null;
    createdBy: string;
  }): Promise<JobPartyRecord> {
    const result = await this.pool.query(
      `INSERT INTO app.job_party (job_id, role, party_name, details, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid) RETURNING *`,
      [party.jobId, party.role, party.name, party.details, party.createdBy],
    );
    return this.mapParty(result.rows[0]);
  }

  async listJobParties(jobId: string): Promise<JobPartyRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.job_party
       WHERE job_id = $1::uuid AND removed_at IS NULL
       ORDER BY created_at, party_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapParty(row));
  }

  async removeJobParty(
    jobId: string,
    partyId: string,
    removedBy: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE app.job_party SET removed_by = $3::uuid, removed_at = clock_timestamp()
       WHERE party_id = $2::uuid AND job_id = $1::uuid AND removed_at IS NULL
       RETURNING party_id`,
      [jobId, partyId, removedBy],
    );
    return result.rows.length > 0;
  }

  async addShipmentReference(reference: {
    jobId: string;
    kind: ReferenceKind;
    value: string;
    sealNumber: string | null;
    parentReferenceId: string | null;
    createdBy: string;
  }): Promise<
    ShipmentReferenceRecord | "parent_invalid" | "duplicate_reference"
  > {
    try {
      const result = await this.pool.query(
        `INSERT INTO app.shipment_reference
          (job_id, kind, reference_value, seal_number, parent_reference_id, created_by)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid) RETURNING *`,
        [
          reference.jobId,
          reference.kind,
          reference.value,
          reference.sealNumber,
          reference.parentReferenceId,
          reference.createdBy,
        ],
      );
      return this.mapReference(result.rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return "duplicate_reference";
      if ((error as Error).message?.includes("active master of the same job")) {
        return "parent_invalid";
      }
      throw error;
    }
  }

  async listShipmentReferences(
    jobId: string,
  ): Promise<ShipmentReferenceRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.shipment_reference
       WHERE job_id = $1::uuid AND removed_at IS NULL
       ORDER BY created_at, reference_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapReference(row));
  }

  async removeShipmentReference(
    jobId: string,
    referenceId: string,
    removedBy: string,
  ): Promise<boolean | "has_children"> {
    const children = await this.pool.query(
      `SELECT 1 FROM app.shipment_reference
       WHERE parent_reference_id = $1::uuid AND removed_at IS NULL`,
      [referenceId],
    );
    if (children.rows.length > 0) return "has_children";
    const result = await this.pool.query(
      `UPDATE app.shipment_reference
       SET removed_by = $3::uuid, removed_at = clock_timestamp()
       WHERE reference_id = $2::uuid AND job_id = $1::uuid AND removed_at IS NULL
       RETURNING reference_id`,
      [jobId, referenceId, removedBy],
    );
    return result.rows.length > 0;
  }

  private mapParty(row: Record<string, unknown>): JobPartyRecord {
    return {
      id: String(row.party_id),
      jobId: String(row.job_id),
      role: row.role as PartyRole,
      name: String(row.party_name),
      details: row.details ? String(row.details) : null,
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapReference(row: Record<string, unknown>): ShipmentReferenceRecord {
    return {
      id: String(row.reference_id),
      jobId: String(row.job_id),
      kind: row.kind as ReferenceKind,
      value: String(row.reference_value),
      sealNumber: row.seal_number ? String(row.seal_number) : null,
      parentReferenceId: row.parent_reference_id
        ? String(row.parent_reference_id)
        : null,
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
    };
  }

  async saveDocumentVersion(upload: {
    jobId: string;
    documentId: string | null;
    documentType: DocumentType;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    objectKey: string;
    uploadedBy: string;
  }): Promise<DocumentRecord | "document_not_found"> {
    const documentId = await this.insertDocumentVersion(upload);
    if (documentId === "document_not_found") return documentId;
    const documents = await this.listDocuments(upload.jobId);
    return documents.find((document) => document.id === documentId)!;
  }

  private async insertDocumentVersion(upload: {
    jobId: string | null;
    companyId?: string | null;
    title?: string | null;
    documentId: string | null;
    documentType: DocumentType;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    objectKey: string;
    uploadedBy: string;
  }): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let documentId = upload.documentId;
      if (documentId) {
        const existing = await client.query(
          `SELECT document_id FROM app.document
           WHERE document_id = $1::uuid AND job_id = $2::uuid FOR UPDATE`,
          [documentId, upload.jobId],
        );
        if (existing.rows.length === 0) {
          await client.query("ROLLBACK");
          return "document_not_found";
        }
      } else {
        const created = await client.query(
          `INSERT INTO app.document (job_id, company_id, title, document_type, created_by)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid) RETURNING document_id`,
          [
            upload.jobId,
            upload.companyId ?? null,
            upload.title ?? null,
            upload.documentType,
            upload.uploadedBy,
          ],
        );
        documentId = String(created.rows[0].document_id);
      }
      await client.query(
        `INSERT INTO app.document_version
          (document_id, version_number, original_filename, content_type,
           size_bytes, sha256, object_key, uploaded_by)
         VALUES ($1::uuid,
           (SELECT COALESCE(MAX(version_number), 0) + 1
            FROM app.document_version WHERE document_id = $1::uuid),
           $2, $3, $4, $5, $6, $7::uuid)`,
        [
          documentId,
          upload.filename,
          upload.contentType,
          upload.sizeBytes,
          upload.sha256,
          upload.objectKey,
          upload.uploadedBy,
        ],
      );
      await client.query("COMMIT");
      return documentId;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async saveLibraryDocument(upload: {
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
  }): Promise<string> {
    return this.insertDocumentVersion({ ...upload, documentId: null });
  }

  async searchDocuments(
    query: {
      terms: string[];
      documentType: DocumentType | null;
      documentId: string | null;
    },
    scope: JobScope,
  ): Promise<LibraryDocumentRecord[]> {
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT document.document_id, document.job_id, job.file_number,
              company.company_id, company.company_name, document.title,
              document.document_type, document.created_at,
              (SELECT count(*) FROM app.document_version AS counted
               WHERE counted.document_id = document.document_id) AS version_count,
              latest.*
       FROM app.document AS document
       LEFT JOIN app.job AS job ON job.job_id = document.job_id
       LEFT JOIN app.customer_company AS company
         ON company.company_id = COALESCE(job.customer_company_id, document.company_id)
       CROSS JOIN LATERAL (
         SELECT * FROM app.document_version AS newest
         WHERE newest.document_id = document.document_id
         ORDER BY newest.version_number DESC LIMIT 1
       ) AS latest
       CROSS JOIN LATERAL (
         SELECT lower(concat_ws(' ',
           document.title,
           replace(document.document_type, '_', ' '),
           job.file_number,
           company.company_name,
           to_char(latest.uploaded_at, 'YYYY-MM-DD'),
           (SELECT string_agg(named.original_filename, ' ')
            FROM app.document_version AS named
            WHERE named.document_id = document.document_id),
           (SELECT string_agg(reference.reference_value || ' ' || COALESCE(reference.seal_number, ''), ' ')
            FROM app.shipment_reference AS reference
            WHERE reference.job_id = document.job_id AND reference.removed_at IS NULL),
           (SELECT string_agg(party.party_name, ' ')
            FROM app.job_party AS party
            WHERE party.job_id = document.job_id AND party.removed_at IS NULL)
         )) AS text
       ) AS searchable
       WHERE NOT EXISTS (
           SELECT 1 FROM unnest($1::text[]) AS term
           WHERE strpos(searchable.text, term) = 0)
         AND ($2::text IS NULL OR document.document_type = $2)
         AND ($3::uuid IS NULL OR document.document_id = $3::uuid)
         AND (($4::uuid[] IS NULL AND $5::text[] IS NULL)
           OR ($4::uuid[] IS NOT NULL
               AND COALESCE(job.customer_company_id, document.company_id) = ANY($4::uuid[]))
           OR ($5::text[] IS NOT NULL
               AND (document.job_id IS NULL OR job.service_line = ANY($5::text[]))))
       ORDER BY latest.uploaded_at DESC, document.document_id
       LIMIT 200`,
      [
        query.terms,
        query.documentType,
        query.documentId,
        scope.companyIds ?? null,
        scope.serviceLines ?? null,
      ],
    );
    return result.rows.map((row) => ({
      id: String(row.document_id),
      jobId: row.job_id ? String(row.job_id) : null,
      fileNumber: row.file_number ? String(row.file_number) : null,
      companyId: row.company_id ? String(row.company_id) : null,
      companyName: row.company_name ? String(row.company_name) : null,
      title: row.title ? String(row.title) : null,
      documentType: row.document_type as DocumentType,
      createdAt: this.toIsoString(row.created_at),
      versionCount: Number(row.version_count),
      latest: this.mapDocumentVersion(row),
    }));
  }

  async findDocumentVersionById(
    documentId: string,
    versionNumber?: number,
  ): Promise<StoredDocumentVersion | null> {
    const result = await this.pool.query(
      `SELECT * FROM app.document_version
       WHERE document_id = $1::uuid
         AND ($2::int IS NULL OR version_number = $2::int)
       ORDER BY version_number DESC LIMIT 1`,
      [documentId, versionNumber ?? null],
    );
    const row = result.rows[0];
    return row
      ? {
          ...this.mapDocumentVersion(row),
          objectKey: String(row.object_key),
          documentId: String(row.document_id),
        }
      : null;
  }

  async listDocuments(jobId: string): Promise<DocumentRecord[]> {
    const documents = await this.pool.query(
      `SELECT * FROM app.document WHERE job_id = $1::uuid ORDER BY created_at, document_id`,
      [jobId],
    );
    const versions = await this.pool.query(
      `SELECT version.* FROM app.document_version AS version
       JOIN app.document AS document ON document.document_id = version.document_id
       WHERE document.job_id = $1::uuid
       ORDER BY version.document_id, version.version_number`,
      [jobId],
    );
    return documents.rows.map((row) => ({
      id: String(row.document_id),
      jobId: String(row.job_id),
      documentType: row.document_type as DocumentType,
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
      versions: versions.rows
        .filter((version) => version.document_id === row.document_id)
        .map((version) => this.mapDocumentVersion(version)),
    }));
  }

  async findDocumentVersion(
    jobId: string,
    documentId: string,
    versionNumber?: number,
  ): Promise<StoredDocumentVersion | null> {
    const result = await this.pool.query(
      `SELECT version.* FROM app.document_version AS version
       JOIN app.document AS document ON document.document_id = version.document_id
       WHERE document.document_id = $1::uuid AND document.job_id = $2::uuid
         AND ($3::int IS NULL OR version.version_number = $3::int)
       ORDER BY version.version_number DESC LIMIT 1`,
      [documentId, jobId, versionNumber ?? null],
    );
    const row = result.rows[0];
    return row
      ? {
          ...this.mapDocumentVersion(row),
          objectKey: String(row.object_key),
          documentId: String(row.document_id),
        }
      : null;
  }

  private mapDocumentVersion(
    row: Record<string, unknown>,
  ): DocumentVersionRecord {
    return {
      id: String(row.version_id),
      versionNumber: Number(row.version_number),
      filename: String(row.original_filename),
      contentType: String(row.content_type),
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
      uploadedBy: String(row.uploaded_by),
      uploadedAt: this.toIsoString(row.uploaded_at),
    };
  }

  async changeJobStatus(change: {
    jobId: string;
    from: JobStatus;
    to: JobStatus;
    reason: string | null;
    changedBy: string;
  }): Promise<JobRecord | "status_changed"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE app.job
         SET status = $3,
             closed_at = CASE WHEN $3 IN ('closed', 'cancelled') THEN now() ELSE NULL END
         WHERE job_id = $1::uuid AND status = $2
         RETURNING job_id`,
        [change.jobId, change.from, change.to],
      );
      if (updated.rows.length === 0) {
        await client.query("ROLLBACK");
        return "status_changed";
      }
      await client.query(
        `INSERT INTO app.job_status_history
          (job_id, from_status, to_status, reason, changed_by)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid)`,
        [change.jobId, change.from, change.to, change.reason, change.changedBy],
      );
      const job = await client.query(
        `${jobSelect} WHERE job.job_id = $1::uuid`,
        [change.jobId],
      );
      await client.query("COMMIT");
      return this.mapJob(job.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listJobStatusHistory(jobId: string): Promise<JobStatusChangeRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.job_status_history
       WHERE job_id = $1::uuid ORDER BY changed_at, history_id`,
      [jobId],
    );
    return result.rows.map((row) => ({
      id: String(row.history_id),
      jobId: String(row.job_id),
      fromStatus: row.from_status as JobStatus,
      toStatus: row.to_status as JobStatus,
      reason: row.reason ? String(row.reason) : null,
      changedBy: String(row.changed_by),
      changedAt: this.toIsoString(row.changed_at),
    }));
  }

  async appendMilestoneEvent(event: {
    jobId: string;
    milestoneKey: string;
    occurredAt: string;
    recordedBy: string;
    note: string | null;
    correctionOf: string | null;
  }): Promise<MilestoneEventRecord | "correction_target_not_found"> {
    if (event.correctionOf) {
      const target = await this.pool.query(
        `SELECT 1 FROM app.milestone_event
         WHERE event_id = $1::uuid AND job_id = $2::uuid`,
        [event.correctionOf, event.jobId],
      );
      if (target.rows.length === 0) return "correction_target_not_found";
    }
    const result = await this.pool.query(
      `INSERT INTO app.milestone_event
        (job_id, milestone_key, occurred_at, recorded_by, note, correction_of)
       VALUES ($1::uuid, $2, $3::timestamptz, $4::uuid, $5, $6::uuid)
       RETURNING *`,
      [
        event.jobId,
        event.milestoneKey,
        event.occurredAt,
        event.recordedBy,
        event.note,
        event.correctionOf,
      ],
    );
    return this.mapMilestoneEvent(result.rows[0]);
  }

  async listMilestoneEvents(jobId: string): Promise<MilestoneEventRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.milestone_event
       WHERE job_id = $1::uuid ORDER BY occurred_at, recorded_at, event_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapMilestoneEvent(row));
  }

  private mapMilestoneEvent(
    row: Record<string, unknown>,
  ): MilestoneEventRecord {
    return {
      id: String(row.event_id),
      jobId: String(row.job_id),
      milestoneKey: String(row.milestone_key),
      occurredAt: this.toIsoString(row.occurred_at),
      recordedAt: this.toIsoString(row.recorded_at),
      recordedBy: String(row.recorded_by),
      source: row.source as MilestoneEventRecord["source"],
      note: row.note ? String(row.note) : null,
      correctionOf: row.correction_of ? String(row.correction_of) : null,
    };
  }

  async appendEtaEvent(event: {
    jobId: string;
    etaAt: string;
    source: string;
    note: string | null;
    recordedBy: string;
    correctionOf: string | null;
  }): Promise<EtaEventRecord | "correction_target_not_found"> {
    if (event.correctionOf) {
      const target = await this.pool.query(
        `SELECT 1 FROM app.eta_event
         WHERE eta_id = $1::uuid AND job_id = $2::uuid`,
        [event.correctionOf, event.jobId],
      );
      if (target.rows.length === 0) return "correction_target_not_found";
    }
    const result = await this.pool.query(
      `INSERT INTO app.eta_event
        (job_id, eta_at, source, note, recorded_by, correction_of)
       VALUES ($1::uuid, $2::timestamptz, $3, $4, $5::uuid, $6::uuid)
       RETURNING *`,
      [
        event.jobId,
        event.etaAt,
        event.source,
        event.note,
        event.recordedBy,
        event.correctionOf,
      ],
    );
    return this.mapEtaEvent(result.rows[0]);
  }

  async listEtaEvents(jobId: string): Promise<EtaEventRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.eta_event
       WHERE job_id = $1::uuid ORDER BY recorded_at, eta_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapEtaEvent(row));
  }

  private mapEtaEvent(row: Record<string, unknown>): EtaEventRecord {
    return {
      id: String(row.eta_id),
      jobId: String(row.job_id),
      etaAt: this.toIsoString(row.eta_at),
      source: String(row.source),
      note: row.note ? String(row.note) : null,
      recordedAt: this.toIsoString(row.recorded_at),
      recordedBy: String(row.recorded_by),
      correctionOf: row.correction_of ? String(row.correction_of) : null,
    };
  }

  async createJobTask(task: {
    jobId: string;
    kind: TaskKind;
    title: string;
    details: string | null;
    assignedRole: StaffRoleKey;
    dueDate: string | null;
    createdBy: string;
  }): Promise<JobTaskRecord> {
    const result = await this.pool.query(
      `WITH inserted AS (
         INSERT INTO app.job_task
           (job_id, kind, title, details, assigned_role, due_date, created_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7::uuid)
         RETURNING *)
       ${jobTaskSelect("inserted")}`,
      [
        task.jobId,
        task.kind,
        task.title,
        task.details,
        task.assignedRole,
        task.dueDate,
        task.createdBy,
      ],
    );
    return this.mapJobTask(result.rows[0]);
  }

  async listJobTasks(
    filter: { jobId?: string; assignedRole?: StaffRoleKey; open?: boolean },
    scope: JobScope,
  ): Promise<JobTaskRecord[]> {
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `${jobTaskSelect("app.job_task")}
       WHERE ($1::uuid IS NULL OR task.job_id = $1::uuid)
         AND ($2::text IS NULL OR task.assigned_role = $2)
         AND (NOT $3::boolean OR task.status = 'open')
         AND ($4::uuid[] IS NULL OR job.customer_company_id = ANY($4::uuid[]))
         AND ($5::text[] IS NULL OR job.service_line = ANY($5::text[]))
       ORDER BY (task.status = 'done'), task.due_date NULLS LAST,
         task.created_at, task.task_id`,
      [
        filter.jobId ?? null,
        filter.assignedRole ?? null,
        filter.open ?? false,
        scope.companyIds ?? null,
        scope.serviceLines ?? null,
      ],
    );
    return result.rows.map((row) => this.mapJobTask(row));
  }

  async completeJobTask(
    jobId: string,
    taskId: string,
    completedBy: string,
    note: string | null,
  ): Promise<JobTaskRecord | "not_found" | "already_done"> {
    const updated = await this.pool.query(
      `WITH updated AS (
         UPDATE app.job_task
         SET status = 'done', completed_at = clock_timestamp(),
             completed_by = $3::uuid, completion_note = $4
         WHERE task_id = $2::uuid AND job_id = $1::uuid AND status = 'open'
         RETURNING *)
       ${jobTaskSelect("updated")}`,
      [jobId, taskId, completedBy, note],
    );
    if (updated.rows.length > 0) return this.mapJobTask(updated.rows[0]);
    const existing = await this.pool.query(
      `SELECT 1 FROM app.job_task WHERE task_id = $2::uuid AND job_id = $1::uuid`,
      [jobId, taskId],
    );
    return existing.rows.length > 0 ? "already_done" : "not_found";
  }

  private mapJobTask(row: Record<string, unknown>): JobTaskRecord {
    return {
      id: String(row.task_id),
      jobId: String(row.job_id),
      fileNumber: String(row.file_number),
      customerCompanyName: String(row.company_name),
      kind: row.kind as TaskKind,
      title: String(row.title),
      details: row.details ? String(row.details) : null,
      assignedRole: row.assigned_role as StaffRoleKey,
      dueDate: row.due_date ? String(row.due_date) : null,
      status: row.status as "open" | "done",
      createdAt: this.toIsoString(row.created_at),
      createdBy: String(row.created_by),
      completedAt: row.completed_at ? this.toIsoString(row.completed_at) : null,
      completedBy: row.completed_by ? String(row.completed_by) : null,
      completionNote: row.completion_note ? String(row.completion_note) : null,
    };
  }

  async createQuote(
    input: {
      customerCompanyId: string;
      serviceLine: ServiceLine;
      quoteRequestId: string | null;
      version: QuoteVersionInput;
    },
    createdBy: string,
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const quote = await client.query(
        `INSERT INTO app.quote
          (service_line, customer_company_id, quote_request_id, created_by)
         VALUES ($1, $2::uuid, $3::uuid, $4::uuid)
         RETURNING quote_id`,
        [
          input.serviceLine,
          input.customerCompanyId,
          input.quoteRequestId,
          createdBy,
        ],
      );
      const quoteId = String(quote.rows[0].quote_id);
      const version = await client.query(
        `INSERT INTO app.quote_version
          (quote_id, version_number, currency, title, subtitle, shipment_scope,
           intro, at_cost_note, procedure_steps, required_documents,
           documents_note, timeline, terms, size_labels, created_by)
         VALUES ($1::uuid, 1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[],
           $10, $11, $12::text[], $13::text[], $14::uuid)
         RETURNING version_id`,
        [quoteId, ...quoteVersionValues(input.version), createdBy],
      );
      await this.insertQuoteLines(
        client,
        String(version.rows[0].version_id),
        input.version,
      );
      await client.query("COMMIT");
      return quoteId;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listQuotes(scope: JobScope): Promise<QuoteSummaryRecord[]> {
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT quote.*, company.company_name,
         version.version_number, version.status, version.title, version.currency
       FROM app.quote AS quote
       JOIN app.customer_company AS company
         ON company.company_id = quote.customer_company_id
       JOIN LATERAL (
         SELECT * FROM app.quote_version AS candidate
         WHERE candidate.quote_id = quote.quote_id
           AND (NOT $1::boolean OR candidate.status = 'issued')
         ORDER BY candidate.version_number DESC LIMIT 1
       ) AS version ON true
       WHERE ($2::uuid[] IS NULL OR quote.customer_company_id = ANY($2::uuid[]))
         AND ($3::text[] IS NULL OR quote.service_line = ANY($3::text[]))
       ORDER BY quote.created_at DESC, quote.quote_id`,
      [
        scope.companyIds !== undefined,
        scope.companyIds ?? null,
        scope.serviceLines ?? null,
      ],
    );
    return result.rows.map((row) => ({
      ...this.mapQuoteHead(row),
      latestVersionNumber: Number(row.version_number),
      latestStatus: row.status as "draft" | "issued",
      title: String(row.title),
      currency: String(row.currency),
    }));
  }

  async findQuote(id: string, scope: JobScope): Promise<QuoteRecord | null> {
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return null;
    }
    const head = await this.pool.query(
      `SELECT quote.*, company.company_name
       FROM app.quote AS quote
       JOIN app.customer_company AS company
         ON company.company_id = quote.customer_company_id
       WHERE quote.quote_id = $1::uuid
         AND ($2::uuid[] IS NULL OR quote.customer_company_id = ANY($2::uuid[]))
         AND ($3::text[] IS NULL OR quote.service_line = ANY($3::text[]))`,
      [id, scope.companyIds ?? null, scope.serviceLines ?? null],
    );
    if (head.rows.length === 0) return null;
    const versions = await this.pool.query(
      `SELECT * FROM app.quote_version
       WHERE quote_id = $1::uuid AND (NOT $2::boolean OR status = 'issued')
       ORDER BY version_number`,
      [id, scope.companyIds !== undefined],
    );
    if (versions.rows.length === 0 && scope.companyIds !== undefined) {
      return null;
    }
    const lines = await this.pool.query(
      `SELECT line.* FROM app.quote_line AS line
       JOIN app.quote_version AS version ON version.version_id = line.version_id
       WHERE version.quote_id = $1::uuid
       ORDER BY line.version_id, line.position`,
      [id],
    );
    const decisions = await this.pool.query(
      `SELECT decision.*, version.version_number
       FROM app.quote_decision AS decision
       JOIN app.quote_version AS version
         ON version.version_id = decision.version_id
       WHERE decision.quote_id = $1::uuid
       ORDER BY decision.recorded_at, decision.decision_id`,
      [id],
    );
    const job = await this.pool.query(
      "SELECT job_id FROM app.job WHERE quote_id = $1::uuid",
      [id],
    );
    return {
      ...this.mapQuoteHead(head.rows[0]),
      versions: versions.rows.map((row) =>
        this.mapQuoteVersion(
          row,
          lines.rows.filter((line) => line.version_id === row.version_id),
        ),
      ),
      decisions: decisions.rows.map((row) => this.mapQuoteDecision(row)),
      jobId: job.rows.length > 0 ? String(job.rows[0].job_id) : null,
    };
  }

  async decideQuote(input: {
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
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialises concurrent decisions on the same quote.
      const quote = await client.query(
        `SELECT service_line, customer_company_id, quote_request_id
         FROM app.quote WHERE quote_id = $1::uuid FOR UPDATE`,
        [input.quoteId],
      );
      const version = await client.query(
        `SELECT version_id, status FROM app.quote_version
         WHERE quote_id = $1::uuid AND version_number = $2::integer`,
        [input.quoteId, input.versionNumber],
      );
      if (version.rows.length === 0) {
        await client.query("ROLLBACK");
        return "version_not_found";
      }
      if (version.rows[0].status !== "issued") {
        await client.query("ROLLBACK");
        return "not_issued";
      }
      const versionId = String(version.rows[0].version_id);

      const existing = await client.query(
        `SELECT decision.*, $2::integer AS version_number
         FROM app.quote_decision AS decision
         WHERE decision.version_id = $1::uuid`,
        [versionId, input.versionNumber],
      );
      if (existing.rows.length > 0) {
        const replay =
          existing.rows[0].decision === input.decision
            ? {
                decision: this.mapQuoteDecision(existing.rows[0]),
                job: await this.findJobForQuote(client, input.quoteId),
              }
            : ("already_decided" as const);
        await client.query("ROLLBACK");
        return replay;
      }

      const latest = await client.query(
        `SELECT max(version_number) AS latest FROM app.quote_version
         WHERE quote_id = $1::uuid AND status = 'issued'`,
        [input.quoteId],
      );
      if (Number(latest.rows[0].latest) !== input.versionNumber) {
        await client.query("ROLLBACK");
        return "not_latest";
      }

      const inserted = await client.query(
        `INSERT INTO app.quote_decision
          (quote_id, version_id, decision, client_signatory, decided_at, note, recorded_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6, $7::uuid)
         RETURNING *, $8::integer AS version_number`,
        [
          input.quoteId,
          versionId,
          input.decision,
          input.clientSignatory,
          input.decidedAt,
          input.note,
          input.recordedBy,
          input.versionNumber,
        ],
      );

      let job: JobRecord | null = null;
      if (input.decision === "accepted") {
        const allocated = await client.query(
          "SELECT app.allocate_job_number($1, $2) AS file_number",
          [String(quote.rows[0].service_line), input.year],
        );
        const created = await client.query(
          `INSERT INTO app.job
            (file_number, service_line, customer_company_id, quote_request_id, quote_id, opened_by)
           VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid)
           RETURNING job_id`,
          [
            String(allocated.rows[0].file_number),
            String(quote.rows[0].service_line),
            String(quote.rows[0].customer_company_id),
            quote.rows[0].quote_request_id
              ? String(quote.rows[0].quote_request_id)
              : null,
            input.quoteId,
            input.recordedBy,
          ],
        );
        const row = await client.query(
          `${jobSelect} WHERE job.job_id = $1::uuid`,
          [String(created.rows[0].job_id)],
        );
        job = this.mapJob(row.rows[0]);
      }
      await client.query("COMMIT");
      return { decision: this.mapQuoteDecision(inserted.rows[0]), job };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async findJobForQuote(
    client: PostgresClient,
    quoteId: string,
  ): Promise<JobRecord | null> {
    const result = await client.query(
      `${jobSelect} WHERE job.quote_id = $1::uuid`,
      [quoteId],
    );
    return result.rows.length > 0 ? this.mapJob(result.rows[0]) : null;
  }

  private mapQuoteDecision(row: Record<string, unknown>): QuoteDecisionRecord {
    return {
      id: String(row.decision_id),
      versionNumber: Number(row.version_number),
      decision: row.decision as QuoteDecision,
      clientSignatory: String(row.client_signatory),
      decidedAt: this.toIsoString(row.decided_at),
      note: row.note ? String(row.note) : null,
      recordedAt: this.toIsoString(row.recorded_at),
      recordedBy: String(row.recorded_by),
    };
  }

  async saveQuoteVersionDraft(
    quoteId: string,
    content: QuoteVersionInput,
  ): Promise<"saved" | "no_draft"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const draft = await client.query(
        `SELECT version_id FROM app.quote_version
         WHERE quote_id = $1::uuid AND status = 'draft' FOR UPDATE`,
        [quoteId],
      );
      if (draft.rows.length === 0) {
        await client.query("ROLLBACK");
        return "no_draft";
      }
      const versionId = String(draft.rows[0].version_id);
      await client.query(
        "DELETE FROM app.quote_line WHERE version_id = $1::uuid",
        [versionId],
      );
      await client.query(
        `UPDATE app.quote_version
         SET currency = $2, title = $3, subtitle = $4, shipment_scope = $5,
             intro = $6, at_cost_note = $7, procedure_steps = $8::text[],
             required_documents = $9::text[], documents_note = $10,
             timeline = $11, terms = $12::text[], size_labels = $13::text[],
             updated_at = clock_timestamp()
         WHERE version_id = $1::uuid`,
        [versionId, ...quoteVersionValues(content)],
      );
      await this.insertQuoteLines(client, versionId, content);
      await client.query("COMMIT");
      return "saved";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async startQuoteVersion(
    quoteId: string,
    createdBy: string,
  ): Promise<"started" | "draft_exists"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT 1 FROM app.quote WHERE quote_id = $1::uuid FOR UPDATE",
        [quoteId],
      );
      const draft = await client.query(
        "SELECT 1 FROM app.quote_version WHERE quote_id = $1::uuid AND status = 'draft'",
        [quoteId],
      );
      if (draft.rows.length > 0) {
        await client.query("ROLLBACK");
        return "draft_exists";
      }
      const copied = await client.query(
        `INSERT INTO app.quote_version
          (quote_id, version_number, currency, title, subtitle, shipment_scope,
           intro, at_cost_note, procedure_steps, required_documents,
           documents_note, timeline, terms, size_labels, created_by)
         SELECT quote_id, version_number + 1, currency, title, subtitle,
           shipment_scope, intro, at_cost_note, procedure_steps,
           required_documents, documents_note, timeline, terms, size_labels,
           $2::uuid
         FROM app.quote_version WHERE quote_id = $1::uuid
         ORDER BY version_number DESC LIMIT 1
         RETURNING version_id, version_number`,
        [quoteId, createdBy],
      );
      await client.query(
        `INSERT INTO app.quote_line
          (version_id, position, section, description, details, basis,
           basis_note, amount_minor, size_amounts_minor)
         SELECT $2::uuid, position, section, description, details, basis,
           basis_note, amount_minor, size_amounts_minor
         FROM app.quote_line
         WHERE version_id = (
           SELECT version_id FROM app.quote_version
           WHERE quote_id = $1::uuid AND version_number = $3::integer - 1)`,
        [
          quoteId,
          String(copied.rows[0].version_id),
          Number(copied.rows[0].version_number),
        ],
      );
      await client.query("COMMIT");
      return "started";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async issueQuoteVersion(
    quoteId: string,
    issuedBy: string,
    year: number,
  ): Promise<"issued" | "no_draft" | "no_lines"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const quote = await client.query(
        `SELECT quote_number, service_line FROM app.quote
         WHERE quote_id = $1::uuid FOR UPDATE`,
        [quoteId],
      );
      const draft = await client.query(
        `SELECT version_id,
           EXISTS (SELECT 1 FROM app.quote_line
                   WHERE version_id = quote_version.version_id) AS has_lines
         FROM app.quote_version
         WHERE quote_id = $1::uuid AND status = 'draft'`,
        [quoteId],
      );
      if (draft.rows.length === 0) {
        await client.query("ROLLBACK");
        return "no_draft";
      }
      if (!draft.rows[0].has_lines) {
        await client.query("ROLLBACK");
        return "no_lines";
      }
      if (!quote.rows[0].quote_number) {
        const allocated = await client.query(
          `SELECT app.allocate_quote_number($1, $2, COALESCE(
             (SELECT settings #>> '{numbering,quotePrefix}'
              FROM app.business_settings_revision
              ORDER BY revision_number DESC LIMIT 1), 'BJH/Q')) AS quote_number`,
          [String(quote.rows[0].service_line), year],
        );
        await client.query(
          "UPDATE app.quote SET quote_number = $2 WHERE quote_id = $1::uuid",
          [quoteId, String(allocated.rows[0].quote_number)],
        );
      }
      await client.query(
        `UPDATE app.quote_version
         SET status = 'issued', issued_by = $2::uuid,
             issued_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE version_id = $1::uuid`,
        [String(draft.rows[0].version_id), issuedBy],
      );
      await client.query("COMMIT");
      return "issued";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertQuoteLines(
    client: PostgresClient,
    versionId: string,
    content: QuoteVersionInput,
  ): Promise<void> {
    for (const [position, line] of content.lines.entries()) {
      await client.query(
        `INSERT INTO app.quote_line
          (version_id, position, section, description, details, basis,
           basis_note, amount_minor, size_amounts_minor)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::bigint[])`,
        [
          versionId,
          position,
          line.section,
          line.description,
          line.details,
          line.basis,
          line.basisNote,
          line.amountMinor,
          line.sizeAmountsMinor,
        ],
      );
    }
  }

  private mapQuoteHead(
    row: Record<string, unknown>,
  ): Omit<QuoteRecord, "versions" | "decisions" | "jobId"> {
    return {
      id: String(row.quote_id),
      quoteNumber: row.quote_number ? String(row.quote_number) : null,
      serviceLine: row.service_line as ServiceLine,
      customerCompanyId: String(row.customer_company_id),
      customerCompanyName: String(row.company_name),
      quoteRequestId: row.quote_request_id
        ? String(row.quote_request_id)
        : null,
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapQuoteVersion(
    row: Record<string, unknown>,
    lines: Array<Record<string, unknown>>,
  ): QuoteVersionRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    return {
      id: String(row.version_id),
      versionNumber: Number(row.version_number),
      status: row.status as "draft" | "issued",
      currency: String(row.currency),
      title: String(row.title),
      subtitle: optional(row.subtitle),
      shipmentScope: optional(row.shipment_scope),
      intro: optional(row.intro),
      atCostNote: optional(row.at_cost_note),
      procedureSteps: row.procedure_steps as string[],
      requiredDocuments: row.required_documents as string[],
      documentsNote: optional(row.documents_note),
      timeline: optional(row.timeline),
      terms: row.terms as string[],
      sizeLabels: row.size_labels as string[],
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at),
      issuedBy: optional(row.issued_by),
      issuedAt: row.issued_at ? this.toIsoString(row.issued_at) : null,
      lines: lines.map((line) => this.mapQuoteLine(line)),
    };
  }

  private mapQuoteLine(line: Record<string, unknown>): QuoteLineRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    const minor = (value: unknown) =>
      value === null || value === undefined ? null : Number(value);
    return {
      id: String(line.line_id),
      position: Number(line.position),
      section: optional(line.section),
      description: String(line.description),
      details: optional(line.details),
      basis: line.basis as QuoteBasis,
      basisNote: optional(line.basis_note),
      amountMinor: minor(line.amount_minor),
      sizeAmountsMinor: line.size_amounts_minor
        ? (line.size_amounts_minor as unknown[]).map(Number)
        : null,
    };
  }

  async getBusinessSettings(): Promise<BusinessSettingsRevisionRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM app.business_settings_revision
       ORDER BY revision_number DESC LIMIT 1`,
    );
    return result.rows.length > 0
      ? this.mapSettingsRevision(result.rows[0])
      : null;
  }

  async listBusinessSettingsRevisions(): Promise<
    BusinessSettingsRevisionRecord[]
  > {
    const result = await this.pool.query(
      `SELECT * FROM app.business_settings_revision
       ORDER BY revision_number DESC`,
    );
    return result.rows.map((row) => this.mapSettingsRevision(row));
  }

  async saveBusinessSettings(
    settings: BusinessSettings,
    changedBy: string,
  ): Promise<BusinessSettingsRevisionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialises writers so revision numbers never collide.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('app.business_settings_revision'))",
      );
      const result = await client.query(
        `INSERT INTO app.business_settings_revision
          (revision_number, settings, changed_by)
         SELECT COALESCE(max(revision_number), 0) + 1, $1::jsonb, $2::uuid
         FROM app.business_settings_revision
         RETURNING *`,
        [JSON.stringify(settings), changedBy],
      );
      await client.query("COMMIT");
      return this.mapSettingsRevision(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private mapSettingsRevision(
    row: Record<string, unknown>,
  ): BusinessSettingsRevisionRecord {
    return {
      revisionNumber: Number(row.revision_number),
      settings: row.settings as BusinessSettings,
      changedBy: String(row.changed_by),
      changedAt: this.toIsoString(row.changed_at),
    };
  }

  async createJobCharge(charge: {
    jobId: string;
    kind: ChargeKind;
    description: string;
    currency: string;
    quantity: number;
    unitQuotedMinor: number | null;
    quoteLineId: string | null;
    quoteContainerSize: string | null;
    createdBy: string;
  }): Promise<JobChargeRecord | null> {
    const result = await this.pool.query(
      `INSERT INTO app.job_charge
        (job_id, kind, description, currency, quantity, unit_quoted_minor,
         quote_line_id, quote_container_size, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8, $9::uuid)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        charge.jobId,
        charge.kind,
        charge.description,
        charge.currency,
        charge.quantity,
        charge.unitQuotedMinor,
        charge.quoteLineId,
        charge.quoteContainerSize,
        charge.createdBy,
      ],
    );
    return result.rows.length > 0
      ? this.mapJobCharge(result.rows[0], [])
      : null;
  }

  async listJobCharges(jobId: string): Promise<JobChargeRecord[]> {
    const charges = await this.pool.query(
      `SELECT * FROM app.job_charge
       WHERE job_id = $1::uuid AND removed_at IS NULL
       ORDER BY created_at, charge_id`,
      [jobId],
    );
    const actuals = await this.pool.query(
      `SELECT actual.* FROM app.job_charge_actual AS actual
       JOIN app.job_charge AS charge ON charge.charge_id = actual.charge_id
       WHERE charge.job_id = $1::uuid AND charge.removed_at IS NULL
       ORDER BY actual.recorded_at, actual.actual_id`,
      [jobId],
    );
    return charges.rows.map((row) =>
      this.mapJobCharge(
        row,
        actuals.rows.filter((actual) => actual.charge_id === row.charge_id),
      ),
    );
  }

  async removeJobCharge(
    jobId: string,
    chargeId: string,
    removedBy: string,
  ): Promise<"removed" | "not_found" | "has_actuals"> {
    const existing = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM app.job_charge_actual WHERE charge_id = charge.charge_id
       ) AS has_actuals
       FROM app.job_charge AS charge
       WHERE charge.charge_id = $2::uuid AND charge.job_id = $1::uuid
         AND charge.removed_at IS NULL`,
      [jobId, chargeId],
    );
    if (existing.rows.length === 0) return "not_found";
    if (existing.rows[0].has_actuals) return "has_actuals";
    await this.pool.query(
      `UPDATE app.job_charge
       SET removed_at = clock_timestamp(), removed_by = $3::uuid
       WHERE charge_id = $2::uuid AND job_id = $1::uuid`,
      [jobId, chargeId, removedBy],
    );
    return "removed";
  }

  async appendChargeActual(actual: {
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
  > {
    const charge = await this.pool.query(
      `SELECT 1 FROM app.job_charge
       WHERE charge_id = $2::uuid AND job_id = $1::uuid AND removed_at IS NULL`,
      [actual.jobId, actual.chargeId],
    );
    if (charge.rows.length === 0) return "charge_not_found";
    if (actual.supplierDocumentId) {
      const document = await this.pool.query(
        `SELECT 1 FROM app.document
         WHERE document_id = $2::uuid AND job_id = $1::uuid
           AND document_type IN ('supplier_invoice', 'disbursement_evidence')`,
        [actual.jobId, actual.supplierDocumentId],
      );
      if (document.rows.length === 0) return "document_invalid";
    }
    if (actual.correctionOf) {
      const earlier = await this.pool.query(
        `SELECT 1 FROM app.job_charge_actual
         WHERE actual_id = $1::uuid AND charge_id = $2::uuid`,
        [actual.correctionOf, actual.chargeId],
      );
      if (earlier.rows.length === 0) return "correction_not_found";
    }
    const result = await this.pool.query(
      `INSERT INTO app.job_charge_actual
        (charge_id, amount_minor, currency, exchange_rate, converted_minor,
         rate_note, supplier_document_id, note, correction_of, recorded_by)
       VALUES ($1::uuid, $2, $3, $4::numeric, $5, $6, $7::uuid, $8, $9::uuid, $10::uuid)
       RETURNING *`,
      [
        actual.chargeId,
        actual.amountMinor,
        actual.currency,
        actual.exchangeRate,
        actual.convertedMinor,
        actual.rateNote,
        actual.supplierDocumentId,
        actual.note,
        actual.correctionOf,
        actual.recordedBy,
      ],
    );
    return this.mapChargeActual(result.rows[0]);
  }

  async findAcceptedQuoteLines(jobId: string): Promise<{
    currency: string;
    sizeLabels: string[];
    lines: QuoteLineRecord[];
  } | null> {
    const result = await this.pool.query(
      `SELECT version.currency, version.size_labels, line.*
       FROM app.job AS job
       JOIN app.quote_decision AS decision
         ON decision.quote_id = job.quote_id AND decision.decision = 'accepted'
       JOIN app.quote_version AS version ON version.version_id = decision.version_id
       JOIN app.quote_line AS line ON line.version_id = version.version_id
       WHERE job.job_id = $1::uuid
       ORDER BY line.position`,
      [jobId],
    );
    if (result.rows.length === 0) return null;
    return {
      currency: String(result.rows[0].currency),
      sizeLabels: result.rows[0].size_labels as string[],
      lines: result.rows.map((row) => this.mapQuoteLine(row)),
    };
  }

  private mapJobCharge(
    row: Record<string, unknown>,
    actuals: Array<Record<string, unknown>>,
  ): JobChargeRecord {
    return {
      id: String(row.charge_id),
      jobId: String(row.job_id),
      kind: row.kind as ChargeKind,
      description: String(row.description),
      currency: String(row.currency),
      quantity: Number(row.quantity),
      unitQuotedMinor:
        row.unit_quoted_minor === null ? null : Number(row.unit_quoted_minor),
      quoteLineId: row.quote_line_id ? String(row.quote_line_id) : null,
      quoteContainerSize: row.quote_container_size
        ? String(row.quote_container_size)
        : null,
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
      actuals: actuals.map((actual) => this.mapChargeActual(actual)),
    };
  }

  private mapChargeActual(row: Record<string, unknown>): ChargeActualRecord {
    return {
      id: String(row.actual_id),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      exchangeRate:
        row.exchange_rate === null
          ? null
          : String(row.exchange_rate)
              .replace(/(\.\d*?)0+$/, "$1")
              .replace(/\.$/, ""),
      convertedMinor:
        row.converted_minor === null ? null : Number(row.converted_minor),
      rateNote: row.rate_note ? String(row.rate_note) : null,
      supplierDocumentId: row.supplier_document_id
        ? String(row.supplier_document_id)
        : null,
      note: row.note ? String(row.note) : null,
      correctionOf: row.correction_of ? String(row.correction_of) : null,
      recordedBy: String(row.recorded_by),
      recordedAt: this.toIsoString(row.recorded_at),
    };
  }

  async createDriver(
    driver: { name: string; phone: string },
    createdBy: string,
  ): Promise<DriverRecord> {
    const result = await this.pool.query(
      `INSERT INTO app.driver (driver_name, phone, created_by)
       VALUES ($1, $2, $3::uuid) RETURNING *`,
      [driver.name, driver.phone, createdBy],
    );
    return this.mapDriver(result.rows[0]);
  }

  async listDrivers(): Promise<DriverRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.driver
       ORDER BY (deactivated_at IS NOT NULL), lower(driver_name), driver_id`,
    );
    return result.rows.map((row) => this.mapDriver(row));
  }

  async setDriverActive(
    id: string,
    active: boolean,
  ): Promise<DriverRecord | null> {
    const result = await this.pool.query(
      `UPDATE app.driver
       SET deactivated_at = CASE WHEN $2::boolean THEN NULL
                                 ELSE COALESCE(deactivated_at, clock_timestamp()) END
       WHERE driver_id = $1::uuid RETURNING *`,
      [id, active],
    );
    return result.rows.length > 0 ? this.mapDriver(result.rows[0]) : null;
  }

  async createVehicle(
    vehicle: { registration: string; description: string | null },
    createdBy: string,
  ): Promise<VehicleRecord | "duplicate_registration"> {
    const result = await this.pool.query(
      `INSERT INTO app.vehicle (registration, description, created_by)
       VALUES ($1, $2, $3::uuid)
       ON CONFLICT (upper(registration)) DO NOTHING
       RETURNING *`,
      [vehicle.registration, vehicle.description, createdBy],
    );
    return result.rows.length > 0
      ? this.mapVehicle(result.rows[0])
      : "duplicate_registration";
  }

  async listVehicles(): Promise<VehicleRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.vehicle
       ORDER BY (deactivated_at IS NOT NULL), upper(registration), vehicle_id`,
    );
    return result.rows.map((row) => this.mapVehicle(row));
  }

  async setVehicleActive(
    id: string,
    active: boolean,
  ): Promise<VehicleRecord | null> {
    const result = await this.pool.query(
      `UPDATE app.vehicle
       SET deactivated_at = CASE WHEN $2::boolean THEN NULL
                                 ELSE COALESCE(deactivated_at, clock_timestamp()) END
       WHERE vehicle_id = $1::uuid RETURNING *`,
      [id, active],
    );
    return result.rows.length > 0 ? this.mapVehicle(result.rows[0]) : null;
  }

  async createDelivery(
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
  ): Promise<DeliveryRecord | "driver_unavailable" | "vehicle_unavailable"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const driver = await client.query(
        `SELECT driver_name, phone FROM app.driver
         WHERE driver_id = $1::uuid AND deactivated_at IS NULL FOR SHARE`,
        [delivery.driverId],
      );
      if (driver.rows.length === 0) {
        await client.query("ROLLBACK");
        return "driver_unavailable";
      }
      const vehicle = await client.query(
        `SELECT registration FROM app.vehicle
         WHERE vehicle_id = $1::uuid AND deactivated_at IS NULL FOR SHARE`,
        [delivery.vehicleId],
      );
      if (vehicle.rows.length === 0) {
        await client.query("ROLLBACK");
        return "vehicle_unavailable";
      }
      const allocated = await client.query(
        `SELECT app.allocate_waybill_number($1, COALESCE(
           (SELECT settings #>> '{numbering,waybillPrefix}'
            FROM app.business_settings_revision
            ORDER BY revision_number DESC LIMIT 1), 'BJH/WB')) AS waybill_number`,
        [year],
      );
      const inserted = await client.query(
        `INSERT INTO app.delivery
          (job_id, waybill_number, driver_id, vehicle_id, driver_name,
           driver_phone, vehicle_registration, cargo_description, packages,
           gross_weight_kg, pickup_location, delivery_address, dispatched_by)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13::uuid)
         RETURNING *`,
        [
          delivery.jobId,
          String(allocated.rows[0].waybill_number),
          delivery.driverId,
          delivery.vehicleId,
          String(driver.rows[0].driver_name),
          String(driver.rows[0].phone),
          String(vehicle.rows[0].registration),
          delivery.cargoDescription,
          delivery.packages,
          delivery.grossWeightKg,
          delivery.pickupLocation,
          delivery.deliveryAddress,
          dispatchedBy,
        ],
      );
      await client.query("COMMIT");
      return this.mapDelivery(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listDeliveries(jobId: string): Promise<DeliveryRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.delivery
       WHERE job_id = $1::uuid ORDER BY dispatched_at, delivery_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapDelivery(row));
  }

  async recordProofOfDelivery(
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
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT status FROM app.delivery
         WHERE delivery_id = $2::uuid AND job_id = $1::uuid FOR UPDATE`,
        [jobId, deliveryId],
      );
      if (current.rows.length === 0) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (current.rows[0].status === "delivered") {
        await client.query("ROLLBACK");
        return "already_delivered";
      }
      if (proof.podDocumentId) {
        const document = await client.query(
          `SELECT 1 FROM app.document
           WHERE document_id = $2::uuid AND job_id = $1::uuid
             AND document_type = 'delivery_note'`,
          [jobId, proof.podDocumentId],
        );
        if (document.rows.length === 0) {
          await client.query("ROLLBACK");
          return "document_invalid";
        }
      }
      const updated = await client.query(
        `UPDATE app.delivery
         SET status = 'delivered', receiver_name = $3, receiver_phone = $4,
             delivered_at = $5::timestamptz, damage_notes = $6,
             pod_document_id = $7::uuid, pod_recorded_by = $8::uuid,
             pod_recorded_at = clock_timestamp()
         WHERE delivery_id = $2::uuid AND job_id = $1::uuid
         RETURNING *`,
        [
          jobId,
          deliveryId,
          proof.receiverName,
          proof.receiverPhone,
          proof.deliveredAt,
          proof.damageNotes,
          proof.podDocumentId,
          recordedBy,
        ],
      );
      await client.query("COMMIT");
      return this.mapDelivery(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvoice(invoice: {
    jobId: string;
    currency: string;
    lines: InvoiceLineRecord[];
    dueDate: string | null;
    notes: string | null;
    totals: InvoiceTotals;
    createdBy: string;
  }): Promise<InvoiceRecord> {
    const inserted = await this.pool.query(
      `INSERT INTO app.invoice
        (job_id, currency, lines, due_date, notes, subtotal_minor, tax_lines,
         tax_total_minor, total_minor, created_by)
       VALUES ($1::uuid, $2, $3::jsonb, $4::date, $5, $6, $7::jsonb, $8, $9, $10::uuid)
       RETURNING *, to_char(due_date, 'YYYY-MM-DD') AS due_date_text`,
      [
        invoice.jobId,
        invoice.currency,
        JSON.stringify(invoice.lines),
        invoice.dueDate,
        invoice.notes,
        invoice.totals.subtotalMinor,
        JSON.stringify(invoice.totals.taxLines),
        invoice.totals.taxTotalMinor,
        invoice.totals.totalMinor,
        invoice.createdBy,
      ],
    );
    return this.mapInvoice(inserted.rows[0]);
  }

  async listInvoices(jobId: string): Promise<InvoiceRecord[]> {
    const result = await this.pool.query(
      `SELECT *, to_char(due_date, 'YYYY-MM-DD') AS due_date_text
       FROM app.invoice WHERE job_id = $1::uuid ORDER BY created_at, invoice_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapInvoice(row));
  }

  async listInvoicePayments(jobId: string): Promise<InvoicePaymentRecord[]> {
    const result = await this.pool.query(
      `SELECT ${PAYMENT_COLUMNS}
       FROM app.invoice_payment p
       JOIN app.invoice i ON i.invoice_id = p.invoice_id
       LEFT JOIN app.invoice_payment_reversal r ON r.payment_id = p.payment_id
       WHERE i.job_id = $1::uuid
       ORDER BY p.recorded_at, p.payment_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapPayment(row));
  }

  async updateDraftInvoice(
    jobId: string,
    invoiceId: string,
    draft: {
      currency: string;
      lines: InvoiceLineRecord[];
      dueDate: string | null;
      notes: string | null;
      totals: InvoiceTotals;
    },
  ): Promise<InvoiceRecord | "not_found" | "not_draft"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT status FROM app.invoice
         WHERE invoice_id = $2::uuid AND job_id = $1::uuid FOR UPDATE`,
        [jobId, invoiceId],
      );
      if (current.rows.length === 0) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (current.rows[0].status !== "draft") {
        await client.query("ROLLBACK");
        return "not_draft";
      }
      const updated = await client.query(
        `UPDATE app.invoice
         SET currency = $3, lines = $4::jsonb, due_date = $5::date, notes = $6,
             subtotal_minor = $7, tax_lines = $8::jsonb, tax_total_minor = $9,
             total_minor = $10, updated_at = clock_timestamp()
         WHERE invoice_id = $2::uuid AND job_id = $1::uuid
         RETURNING *, to_char(due_date, 'YYYY-MM-DD') AS due_date_text`,
        [
          jobId,
          invoiceId,
          draft.currency,
          JSON.stringify(draft.lines),
          draft.dueDate,
          draft.notes,
          draft.totals.subtotalMinor,
          JSON.stringify(draft.totals.taxLines),
          draft.totals.taxTotalMinor,
          draft.totals.totalMinor,
        ],
      );
      await client.query("COMMIT");
      return this.mapInvoice(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async issueInvoice(
    jobId: string,
    invoiceId: string,
    issue: {
      issuedBy: string;
      year: number;
      dueDate: string | null;
      totals: InvoiceTotals;
    },
  ): Promise<InvoiceRecord | "not_found" | "not_draft" | "no_lines"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT status, jsonb_array_length(lines) AS line_count FROM app.invoice
         WHERE invoice_id = $2::uuid AND job_id = $1::uuid FOR UPDATE`,
        [jobId, invoiceId],
      );
      if (current.rows.length === 0) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (current.rows[0].status !== "draft") {
        await client.query("ROLLBACK");
        return "not_draft";
      }
      if (Number(current.rows[0].line_count) === 0) {
        await client.query("ROLLBACK");
        return "no_lines";
      }
      const allocated = await client.query(
        `SELECT app.allocate_invoice_number($1, COALESCE(
           (SELECT settings #>> '{numbering,invoicePrefix}'
            FROM app.business_settings_revision
            ORDER BY revision_number DESC LIMIT 1), 'BJH/INV')) AS invoice_number`,
        [issue.year],
      );
      const updated = await client.query(
        `UPDATE app.invoice
         SET status = 'issued', invoice_number = $3, issued_by = $4::uuid,
             issued_at = clock_timestamp(), due_date = $5::date,
             subtotal_minor = $6, tax_lines = $7::jsonb, tax_total_minor = $8,
             total_minor = $9, updated_at = clock_timestamp()
         WHERE invoice_id = $2::uuid AND job_id = $1::uuid
         RETURNING *, to_char(due_date, 'YYYY-MM-DD') AS due_date_text`,
        [
          jobId,
          invoiceId,
          String(allocated.rows[0].invoice_number),
          issue.issuedBy,
          issue.dueDate,
          issue.totals.subtotalMinor,
          JSON.stringify(issue.totals.taxLines),
          issue.totals.taxTotalMinor,
          issue.totals.totalMinor,
        ],
      );
      await client.query("COMMIT");
      return this.mapInvoice(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async voidInvoice(
    jobId: string,
    invoiceId: string,
    voidedBy: string,
    reason: string,
  ): Promise<InvoiceRecord | "not_found" | "already_void" | "has_payments"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT status FROM app.invoice
         WHERE invoice_id = $2::uuid AND job_id = $1::uuid FOR UPDATE`,
        [jobId, invoiceId],
      );
      if (current.rows.length === 0) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (current.rows[0].status === "void") {
        await client.query("ROLLBACK");
        return "already_void";
      }
      const standing = await client.query(
        `SELECT 1 FROM app.invoice_payment p
         WHERE p.invoice_id = $1::uuid
           AND NOT EXISTS (
             SELECT 1 FROM app.invoice_payment_reversal r WHERE r.payment_id = p.payment_id
           )`,
        [invoiceId],
      );
      if (standing.rows.length > 0) {
        await client.query("ROLLBACK");
        return "has_payments";
      }
      const updated = await client.query(
        `UPDATE app.invoice
         SET status = 'void', voided_by = $3::uuid, voided_at = clock_timestamp(),
             void_reason = $4, updated_at = clock_timestamp()
         WHERE invoice_id = $2::uuid AND job_id = $1::uuid
         RETURNING *, to_char(due_date, 'YYYY-MM-DD') AS due_date_text`,
        [jobId, invoiceId, voidedBy, reason],
      );
      await client.query("COMMIT");
      return this.mapInvoice(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordInvoicePayment(
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
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // The invoice row is locked so simultaneous payments are checked one by one.
      const invoice = await client.query(
        `SELECT status, total_minor FROM app.invoice
         WHERE invoice_id = $2::uuid AND job_id = $1::uuid FOR UPDATE`,
        [jobId, invoiceId],
      );
      if (invoice.rows.length === 0) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (invoice.rows[0].status !== "issued") {
        await client.query("ROLLBACK");
        return "not_issued";
      }
      const standing = await client.query(
        `SELECT COALESCE(sum(p.amount_minor), 0) AS paid
         FROM app.invoice_payment p
         WHERE p.invoice_id = $1::uuid
           AND NOT EXISTS (
             SELECT 1 FROM app.invoice_payment_reversal r WHERE r.payment_id = p.payment_id
           )`,
        [invoiceId],
      );
      if (
        Number(standing.rows[0].paid) + payment.amountMinor >
        Number(invoice.rows[0].total_minor)
      ) {
        await client.query("ROLLBACK");
        return "exceeds_balance";
      }
      if (payment.evidenceDocumentId) {
        const document = await client.query(
          `SELECT 1 FROM app.document
           WHERE document_id = $2::uuid AND job_id = $1::uuid`,
          [jobId, payment.evidenceDocumentId],
        );
        if (document.rows.length === 0) {
          await client.query("ROLLBACK");
          return "document_invalid";
        }
      }
      const receipt = await client.query(
        `SELECT app.allocate_receipt_number($1, COALESCE(
           (SELECT settings #>> '{numbering,receiptPrefix}'
            FROM app.business_settings_revision
            ORDER BY revision_number DESC LIMIT 1), 'BJH/RCT')) AS receipt_number`,
        [year],
      );
      const inserted = await client.query(
        `INSERT INTO app.invoice_payment
          (invoice_id, receipt_number, amount_minor, received_on, method,
           reference, evidence_document_id, note, recorded_by)
         VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7::uuid, $8, $9::uuid)
         RETURNING payment_id`,
        [
          invoiceId,
          String(receipt.rows[0].receipt_number),
          payment.amountMinor,
          payment.receivedOn,
          payment.method,
          payment.reference,
          payment.evidenceDocumentId,
          payment.note,
          recordedBy,
        ],
      );
      const saved = await this.selectPayment(
        client,
        String(inserted.rows[0].payment_id),
      );
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reverseInvoicePayment(
    jobId: string,
    invoiceId: string,
    paymentId: string,
    reason: string,
    reversedBy: string,
  ): Promise<InvoicePaymentRecord | "not_found" | "already_reversed"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const payment = await client.query(
        `SELECT 1
         FROM app.invoice_payment p
         JOIN app.invoice i ON i.invoice_id = p.invoice_id
         WHERE p.payment_id = $3::uuid AND p.invoice_id = $2::uuid
           AND i.job_id = $1::uuid
         FOR UPDATE OF p`,
        [jobId, invoiceId, paymentId],
      );
      if (payment.rows.length === 0) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      // A separate statement, so a reversal committed while this one waited
      // for the row lock is seen.
      const reversed = await client.query(
        `SELECT 1 FROM app.invoice_payment_reversal WHERE payment_id = $1::uuid`,
        [paymentId],
      );
      if (reversed.rows.length > 0) {
        await client.query("ROLLBACK");
        return "already_reversed";
      }
      await client.query(
        `INSERT INTO app.invoice_payment_reversal (payment_id, reason, reversed_by)
         VALUES ($1::uuid, $2, $3::uuid)`,
        [paymentId, reason, reversedBy],
      );
      const saved = await this.selectPayment(client, paymentId);
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async selectPayment(
    client: {
      query: (
        text: string,
        values: unknown[],
      ) => Promise<{ rows: Record<string, unknown>[] }>;
    },
    paymentId: string,
  ): Promise<InvoicePaymentRecord> {
    const result = await client.query(
      `SELECT ${PAYMENT_COLUMNS}
       FROM app.invoice_payment p
       LEFT JOIN app.invoice_payment_reversal r ON r.payment_id = p.payment_id
       WHERE p.payment_id = $1::uuid`,
      [paymentId],
    );
    return this.mapPayment(result.rows[0]);
  }

  async addJobCorrespondence(entry: {
    jobId: string;
    channel: JobCorrespondenceRecord["channel"];
    direction: JobCorrespondenceRecord["direction"];
    occurredAt: string;
    counterparty: string | null;
    subject: string | null;
    body: string;
    documentId: string | null;
    recordedBy: string;
  }): Promise<JobCorrespondenceRecord | "document_invalid"> {
    if (entry.documentId) {
      const document = await this.pool.query(
        `SELECT 1 FROM app.document
         WHERE document_id = $2::uuid AND job_id = $1::uuid`,
        [entry.jobId, entry.documentId],
      );
      if (document.rows.length === 0) return "document_invalid";
    }
    const inserted = await this.pool.query(
      `INSERT INTO app.job_correspondence
        (job_id, channel, direction, occurred_at, counterparty, subject, body,
         document_id, recorded_by)
       VALUES ($1::uuid, $2, $3, $4::timestamptz, $5, $6, $7, $8::uuid, $9::uuid)
       RETURNING *`,
      [
        entry.jobId,
        entry.channel,
        entry.direction,
        entry.occurredAt,
        entry.counterparty,
        entry.subject,
        entry.body,
        entry.documentId,
        entry.recordedBy,
      ],
    );
    return this.mapCorrespondence(inserted.rows[0]);
  }

  async listJobCorrespondence(
    jobId: string,
  ): Promise<JobCorrespondenceRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.job_correspondence
       WHERE job_id = $1::uuid ORDER BY occurred_at DESC, recorded_at DESC, entry_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapCorrespondence(row));
  }

  private mapCorrespondence(
    row: Record<string, unknown>,
  ): JobCorrespondenceRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    return {
      id: String(row.entry_id),
      jobId: String(row.job_id),
      channel: row.channel as JobCorrespondenceRecord["channel"],
      direction: row.direction as JobCorrespondenceRecord["direction"],
      occurredAt: this.toIsoString(row.occurred_at),
      counterparty: optional(row.counterparty),
      subject: optional(row.subject),
      body: String(row.body),
      documentId: optional(row.document_id),
      recordedBy: String(row.recorded_by),
      recordedAt: this.toIsoString(row.recorded_at),
    };
  }

  async listWarehouseLocations(): Promise<WarehouseLocationRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.warehouse_location ORDER BY lower(location_name)`,
    );
    return result.rows.map((row) => this.mapLocation(row));
  }

  async createWarehouseLocation(
    name: string,
    createdBy: string,
  ): Promise<WarehouseLocationRecord | "duplicate_name"> {
    const result = await this.pool.query(
      `INSERT INTO app.warehouse_location (location_name, created_by)
       VALUES ($1, $2::uuid)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [name, createdBy],
    );
    return result.rows[0] ? this.mapLocation(result.rows[0]) : "duplicate_name";
  }

  async setWarehouseLocationActive(
    id: string,
    active: boolean,
  ): Promise<WarehouseLocationRecord | null> {
    const result = await this.pool.query(
      `UPDATE app.warehouse_location
       SET deactivated_at = CASE WHEN $2 THEN NULL ELSE COALESCE(deactivated_at, clock_timestamp()) END
       WHERE location_id = $1::uuid
       RETURNING *`,
      [id, active],
    );
    return result.rows[0] ? this.mapLocation(result.rows[0]) : null;
  }

  async addStockMovement(movement: {
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
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const location = await client.query(
        `SELECT 1 FROM app.warehouse_location
         WHERE location_id = $1::uuid AND deactivated_at IS NULL FOR SHARE`,
        [movement.locationId],
      );
      if (location.rows.length === 0) {
        await client.query("ROLLBACK");
        return "location_unavailable";
      }
      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO app.stock_movement
            (job_id, location_id, kind, item, unit, quantity, condition_notes,
             reference, occurred_at, recorded_by)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::uuid)
           RETURNING movement_id`,
          [
            movement.jobId,
            movement.locationId,
            movement.kind,
            movement.item,
            movement.unit,
            movement.quantity,
            movement.conditionNotes,
            movement.reference,
            movement.occurredAt,
            movement.recordedBy,
          ],
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("insufficient stock")
        ) {
          await client.query("ROLLBACK");
          return "insufficient_stock";
        }
        throw error;
      }
      const saved = await client.query(
        `SELECT m.*, l.location_name
         FROM app.stock_movement m
         JOIN app.warehouse_location l ON l.location_id = m.location_id
         WHERE m.movement_id = $1::uuid`,
        [String(inserted.rows[0].movement_id)],
      );
      await client.query("COMMIT");
      return this.mapStockMovement(saved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listStockMovements(jobId: string): Promise<StockMovementRecord[]> {
    const result = await this.pool.query(
      `SELECT m.*, l.location_name
       FROM app.stock_movement m
       JOIN app.warehouse_location l ON l.location_id = m.location_id
       WHERE m.job_id = $1::uuid
       ORDER BY m.occurred_at DESC, m.recorded_at DESC, m.movement_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapStockMovement(row));
  }

  async listStockBalances(filter: {
    asOf: string | null;
    jobId: string | null;
    companyId: string | null;
    scope: JobScope;
  }): Promise<StockBalanceRecord[]> {
    const { scope } = filter;
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT job.job_id, job.file_number, job.customer_company_id,
              company.company_name AS customer_company_name,
              location.location_id, location.location_name,
              (array_agg(m.item ORDER BY m.recorded_at))[1] AS item,
              (array_agg(m.unit ORDER BY m.recorded_at))[1] AS unit,
              sum(CASE WHEN m.kind = 'receipt' THEN m.quantity ELSE -m.quantity END) AS balance
       FROM app.stock_movement m
       JOIN app.job job ON job.job_id = m.job_id
       JOIN app.customer_company company ON company.company_id = job.customer_company_id
       JOIN app.warehouse_location location ON location.location_id = m.location_id
       WHERE ($1::date IS NULL OR m.occurred_at < ($1::date + 1))
         AND ($2::uuid IS NULL OR job.job_id = $2::uuid)
         AND ($3::uuid IS NULL OR job.customer_company_id = $3::uuid)
         AND ($4::uuid[] IS NULL OR job.customer_company_id = ANY($4::uuid[]))
         AND ($5::text[] IS NULL OR job.service_line = ANY($5::text[]))
       GROUP BY job.job_id, job.file_number, job.customer_company_id, company.company_name,
                location.location_id, location.location_name,
                lower(btrim(m.item)), lower(btrim(m.unit))
       HAVING sum(CASE WHEN m.kind = 'receipt' THEN m.quantity ELSE -m.quantity END) > 0
       ORDER BY company.company_name, job.file_number, location.location_name, item`,
      [
        filter.asOf,
        filter.jobId,
        filter.companyId,
        scope.companyIds ?? null,
        scope.serviceLines ?? null,
      ],
    );
    return result.rows.map((row) => ({
      jobId: String(row.job_id),
      fileNumber: String(row.file_number),
      customerCompanyId: String(row.customer_company_id),
      customerCompanyName: String(row.customer_company_name),
      locationId: String(row.location_id),
      locationName: String(row.location_name),
      item: String(row.item),
      unit: String(row.unit),
      balance: Number(row.balance),
    }));
  }

  private mapLocation(row: Record<string, unknown>): WarehouseLocationRecord {
    return {
      id: String(row.location_id),
      name: String(row.location_name),
      createdAt: this.toIsoString(row.created_at),
      deactivatedAt: row.deactivated_at
        ? this.toIsoString(row.deactivated_at)
        : null,
    };
  }

  private mapStockMovement(row: Record<string, unknown>): StockMovementRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    return {
      id: String(row.movement_id),
      jobId: String(row.job_id),
      locationId: String(row.location_id),
      locationName: String(row.location_name),
      kind: row.kind as StockMovementRecord["kind"],
      item: String(row.item),
      unit: String(row.unit),
      quantity: Number(row.quantity),
      conditionNotes: optional(row.condition_notes),
      reference: optional(row.reference),
      occurredAt: this.toIsoString(row.occurred_at),
      recordedBy: String(row.recorded_by),
      recordedAt: this.toIsoString(row.recorded_at),
    };
  }

  async queueNotification(notification: {
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
      skipReason: string | null;
    }>;
  }): Promise<NotificationRecord | "duplicate"> {
    const client = await this.pool.connect();
    let notificationId: string;
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO app.notification
          (company_id, job_id, event, dedupe_key, subject, body, sms_text, link_url, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING *`,
        [
          notification.companyId,
          notification.jobId,
          notification.event,
          notification.dedupeKey,
          notification.subject,
          notification.body,
          notification.smsText,
          notification.linkUrl,
          notification.createdBy,
        ],
      );
      if (inserted.rows.length === 0) {
        await client.query("ROLLBACK");
        return "duplicate";
      }
      notificationId = String(inserted.rows[0].notification_id);
      for (const delivery of notification.deliveries) {
        await client.query(
          `INSERT INTO app.notification_delivery
            (notification_id, contact_id, channel, recipient, status, last_error)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
          [
            notificationId,
            delivery.contactId,
            delivery.channel,
            delivery.recipient,
            delivery.skipReason ? "skipped" : "pending",
            delivery.skipReason,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const [saved] = await this.selectNotifications(
      "n.notification_id = $1::uuid",
      [notificationId],
    );
    return saved;
  }

  async claimDueDeliveries(limit: number): Promise<DueDelivery[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `WITH due AS (
           SELECT d.delivery_id FROM app.notification_delivery d
           WHERE d.status = 'pending' AND d.next_attempt_at <= clock_timestamp()
           ORDER BY d.next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE app.notification_delivery d
         SET attempts = d.attempts + 1,
             -- A lease: if the worker dies, the delivery comes back after 5 minutes.
             next_attempt_at = clock_timestamp() + interval '5 minutes'
         FROM due
         WHERE d.delivery_id = due.delivery_id
         RETURNING d.delivery_id, d.channel, d.recipient, d.attempts, d.notification_id`,
        [limit],
      );
      const ids = claimed.rows.map((row) => String(row.notification_id));
      const notifications = ids.length
        ? await client.query(
            `SELECT notification_id, subject, body, sms_text, link_url
             FROM app.notification WHERE notification_id = ANY($1::uuid[])`,
            [ids],
          )
        : { rows: [] as Array<Record<string, unknown>> };
      await client.query("COMMIT");
      const byId = new Map(
        notifications.rows.map((row) => [String(row.notification_id), row]),
      );
      return claimed.rows.map((row) => {
        const notification = byId.get(String(row.notification_id))!;
        return {
          id: String(row.delivery_id),
          channel: row.channel as "email" | "sms",
          recipient: String(row.recipient),
          attempts: Number(row.attempts),
          subject: String(notification.subject),
          body: String(notification.body),
          smsText: String(notification.sms_text),
          linkUrl: notification.link_url ? String(notification.link_url) : null,
        };
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markDeliverySent(
    id: string,
    provider: string,
    providerMessageId: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app.notification_delivery
       SET status = 'sent', sent_at = clock_timestamp(), provider = $2,
           provider_message_id = $3, last_error = NULL
       WHERE delivery_id = $1::uuid AND status = 'pending'`,
      [id, provider, providerMessageId],
    );
  }

  async markDeliveryFailed(
    id: string,
    error: string,
    retryInSeconds: number | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app.notification_delivery
       SET last_error = left($2, 1000),
           status = CASE WHEN $3::integer IS NULL THEN 'failed' ELSE 'pending' END,
           next_attempt_at = CASE WHEN $3::integer IS NULL THEN next_attempt_at
                                  ELSE clock_timestamp() + ($3::integer * interval '1 second') END
       WHERE delivery_id = $1::uuid AND status = 'pending'`,
      [id, error, retryInSeconds],
    );
  }

  async listJobNotifications(jobId: string): Promise<NotificationRecord[]> {
    return this.selectNotifications("n.job_id = $1::uuid", [jobId]);
  }

  private async selectNotifications(
    where: string,
    values: unknown[],
    limit?: number,
  ): Promise<NotificationRecord[]> {
    const notifications = await this.pool.query(
      `SELECT n.* FROM app.notification n WHERE ${where}
       ORDER BY n.created_at DESC, n.notification_id${
         limit ? ` LIMIT ${Math.trunc(limit)}` : ""
       }`,
      values,
    );
    if (notifications.rows.length === 0) return [];
    const deliveries = await this.pool.query(
      `SELECT d.*, c.contact_name
       FROM app.notification_delivery d
       LEFT JOIN app.customer_contact c ON c.contact_id = d.contact_id
       WHERE d.notification_id = ANY($1::uuid[])
       ORDER BY d.created_at, d.delivery_id`,
      [notifications.rows.map((row) => String(row.notification_id))],
    );
    return notifications.rows.map((row) => ({
      id: String(row.notification_id),
      companyId: String(row.company_id),
      jobId: row.job_id ? String(row.job_id) : null,
      event: String(row.event),
      subject: String(row.subject),
      body: String(row.body),
      smsText: String(row.sms_text),
      linkUrl: row.link_url ? String(row.link_url) : null,
      createdBy: row.created_by ? String(row.created_by) : null,
      createdAt: this.toIsoString(row.created_at),
      deliveries: deliveries.rows
        .filter((delivery) => delivery.notification_id === row.notification_id)
        .map((delivery) => this.mapDelivery2(delivery)),
    }));
  }

  private mapDelivery2(
    row: Record<string, unknown>,
  ): NotificationDeliveryRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    return {
      id: String(row.delivery_id),
      notificationId: String(row.notification_id),
      channel: row.channel as "email" | "sms",
      contactId: optional(row.contact_id),
      contactName: optional(row.contact_name),
      recipient: optional(row.recipient),
      status: row.status as NotificationDeliveryRecord["status"],
      attempts: Number(row.attempts),
      lastError: optional(row.last_error),
      provider: optional(row.provider),
      providerMessageId: optional(row.provider_message_id),
      nextAttemptAt: this.toIsoString(row.next_attempt_at),
      sentAt: row.sent_at ? this.toIsoString(row.sent_at) : null,
      createdAt: this.toIsoString(row.created_at),
    };
  }

  async listNotificationFeed(filter: {
    companyId: string | null;
    event: string | null;
    serviceLines: ServiceLine[] | null;
    limit: number;
  }): Promise<NotificationFeedRow[]> {
    const notifications = await this.selectNotifications(
      `($1::uuid IS NULL OR n.company_id = $1::uuid)
       AND ($2::text IS NULL OR n.event = $2)
       AND ($3::text[] IS NULL OR n.job_id IS NULL OR EXISTS (
         SELECT 1 FROM app.job scoped
         WHERE scoped.job_id = n.job_id AND scoped.service_line = ANY($3::text[])))`,
      [filter.companyId, filter.event, filter.serviceLines],
      filter.limit,
    );
    if (notifications.length === 0) return [];
    const [companies, jobs] = await Promise.all([
      this.pool.query(
        `SELECT company_id, company_name FROM app.customer_company
         WHERE company_id = ANY($1::uuid[])`,
        [[...new Set(notifications.map((item) => item.companyId))]],
      ),
      this.pool.query(
        `SELECT job_id, file_number FROM app.job WHERE job_id = ANY($1::uuid[])`,
        [notifications.flatMap((item) => (item.jobId ? [item.jobId] : []))],
      ),
    ]);
    const companyNames = new Map<string, string>(
      companies.rows.map((row) => [
        String(row.company_id),
        String(row.company_name),
      ]),
    );
    const fileNumbers = new Map<string, string>(
      jobs.rows.map((row) => [String(row.job_id), String(row.file_number)]),
    );
    return notifications.map((item) => ({
      ...item,
      companyName: companyNames.get(item.companyId) ?? "",
      fileNumber: item.jobId ? (fileNumbers.get(item.jobId) ?? null) : null,
    }));
  }

  async listNotificationLog(filter: {
    status: NotificationDeliveryRecord["status"] | null;
    limit: number;
  }): Promise<NotificationLogRow[]> {
    const result = await this.pool.query(
      `SELECT d.*, c.contact_name, n.event, n.subject, company.company_name,
              job.file_number
       FROM app.notification_delivery d
       JOIN app.notification n ON n.notification_id = d.notification_id
       JOIN app.customer_company company ON company.company_id = n.company_id
       LEFT JOIN app.customer_contact c ON c.contact_id = d.contact_id
       LEFT JOIN app.job job ON job.job_id = n.job_id
       WHERE ($1::text IS NULL OR d.status = $1)
       ORDER BY d.created_at DESC, d.delivery_id
       LIMIT $2`,
      [filter.status, filter.limit],
    );
    return result.rows.map((row) => ({
      ...this.mapDelivery2(row),
      event: String(row.event),
      subject: String(row.subject),
      companyName: String(row.company_name),
      fileNumber: row.file_number ? String(row.file_number) : null,
    }));
  }

  async retryNotificationDelivery(
    id: string,
  ): Promise<NotificationDeliveryRecord | "not_found" | "not_failed"> {
    const current = await this.pool.query(
      `SELECT status FROM app.notification_delivery WHERE delivery_id = $1::uuid`,
      [id],
    );
    if (current.rows.length === 0) return "not_found";
    if (current.rows[0].status !== "failed") return "not_failed";
    const updated = await this.pool.query(
      `UPDATE app.notification_delivery
       SET status = 'pending', attempts = 0, next_attempt_at = clock_timestamp()
       WHERE delivery_id = $1::uuid AND status = 'failed'
       RETURNING *`,
      [id],
    );
    return updated.rows[0] ? this.mapDelivery2(updated.rows[0]) : "not_failed";
  }

  async listEtaReminderCandidates(
    withinHours: number,
  ): Promise<EtaReminderCandidate[]> {
    const result = await this.pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (e.job_id) e.eta_id, e.eta_at, job.job_id, job.file_number,
                job.customer_company_id
         FROM app.eta_event e
         JOIN app.job job ON job.job_id = e.job_id
         WHERE job.status NOT IN ('closed', 'cancelled')
         ORDER BY e.job_id, e.recorded_at DESC, e.eta_id DESC
       ) latest
       WHERE latest.eta_at > clock_timestamp()
         AND latest.eta_at <= clock_timestamp() + ($1::integer * interval '1 hour')`,
      [withinHours],
    );
    return result.rows.map((row) => ({
      jobId: String(row.job_id),
      fileNumber: String(row.file_number),
      companyId: String(row.customer_company_id),
      etaId: String(row.eta_id),
      etaAt: this.toIsoString(row.eta_at),
    }));
  }

  private static readonly EXTRACTION_SELECT = `
    SELECT x.*, (
      SELECT v.original_filename FROM app.document_version v
      WHERE v.document_id = x.document_id AND v.version_number = x.version_number
    ) AS filename
    FROM app.document_extraction x`;

  async createDocumentExtraction(extraction: {
    jobId: string;
    documentId: string;
    versionNumber: number;
    textFound: boolean;
    fields: ExtractionFieldRecord[];
    createdBy: string;
  }): Promise<DocumentExtractionRecord> {
    const inserted = await this.pool.query(
      `INSERT INTO app.document_extraction
        (job_id, document_id, version_number, text_found, fields, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::uuid)
       RETURNING extraction_id`,
      [
        extraction.jobId,
        extraction.documentId,
        extraction.versionNumber,
        extraction.textFound,
        JSON.stringify(extraction.fields),
        extraction.createdBy,
      ],
    );
    const [saved] = await this.selectExtractions("x.extraction_id = $1::uuid", [
      String(inserted.rows[0].extraction_id),
    ]);
    return saved;
  }

  listDocumentExtractions(jobId: string): Promise<DocumentExtractionRecord[]> {
    return this.selectExtractions("x.job_id = $1::uuid", [jobId]);
  }

  async reviewDocumentExtraction(
    jobId: string,
    extractionId: string,
    review: {
      status: "approved" | "rejected";
      applied: ExtractionApplyResult[] | null;
      reviewedBy: string;
    },
  ): Promise<DocumentExtractionRecord | "not_found" | "not_draft"> {
    const current = await this.pool.query(
      `SELECT status FROM app.document_extraction
       WHERE extraction_id = $2::uuid AND job_id = $1::uuid`,
      [jobId, extractionId],
    );
    if (current.rows.length === 0) return "not_found";
    if (current.rows[0].status !== "draft") return "not_draft";
    const updated = await this.pool.query(
      `UPDATE app.document_extraction
       SET status = $3, applied = $4::jsonb, reviewed_by = $5::uuid,
           reviewed_at = clock_timestamp()
       WHERE extraction_id = $2::uuid AND job_id = $1::uuid AND status = 'draft'
       RETURNING extraction_id`,
      [
        jobId,
        extractionId,
        review.status,
        review.applied ? JSON.stringify(review.applied) : null,
        review.reviewedBy,
      ],
    );
    if (updated.rows.length === 0) return "not_draft";
    const [saved] = await this.selectExtractions("x.extraction_id = $1::uuid", [
      extractionId,
    ]);
    return saved;
  }

  private async selectExtractions(
    where: string,
    values: unknown[],
  ): Promise<DocumentExtractionRecord[]> {
    const result = await this.pool.query(
      `${PostgresDatabaseService.EXTRACTION_SELECT}
       WHERE ${where} ORDER BY x.created_at DESC, x.extraction_id`,
      values,
    );
    return result.rows.map((row) => ({
      id: String(row.extraction_id),
      jobId: String(row.job_id),
      documentId: String(row.document_id),
      versionNumber: Number(row.version_number),
      filename: row.filename ? String(row.filename) : null,
      textFound: row.text_found === true,
      fields: row.fields as ExtractionFieldRecord[],
      status: row.status as DocumentExtractionRecord["status"],
      applied: (row.applied as ExtractionApplyResult[] | null) ?? null,
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
      reviewedAt: row.reviewed_at ? this.toIsoString(row.reviewed_at) : null,
    }));
  }

  async createTransportDocument(document: {
    jobId: string;
    kind: TransportDocumentRecord["kind"];
    documentNumber: string | null;
    fields: Record<string, string>;
    createdBy: string;
  }): Promise<TransportDocumentRecord> {
    const inserted = await this.pool.query(
      `INSERT INTO app.transport_document (job_id, kind, document_number, fields, created_by)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid) RETURNING *`,
      [
        document.jobId,
        document.kind,
        document.documentNumber,
        JSON.stringify(document.fields),
        document.createdBy,
      ],
    );
    return this.mapTransportDocument(inserted.rows[0]);
  }

  async listTransportDocuments(
    jobId: string,
  ): Promise<TransportDocumentRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.transport_document WHERE job_id = $1::uuid
       ORDER BY created_at, document_id`,
      [jobId],
    );
    return result.rows.map((row) => this.mapTransportDocument(row));
  }

  async updateTransportDocumentDraft(
    jobId: string,
    documentId: string,
    draft: { documentNumber: string | null; fields: Record<string, string> },
  ): Promise<TransportDocumentRecord | "not_found" | "not_draft"> {
    const updated = await this.pool.query(
      `UPDATE app.transport_document
       SET document_number = $3, fields = $4::jsonb, updated_at = clock_timestamp()
       WHERE document_id = $2::uuid AND job_id = $1::uuid AND status = 'draft'
       RETURNING *`,
      [jobId, documentId, draft.documentNumber, JSON.stringify(draft.fields)],
    );
    if (updated.rows[0]) return this.mapTransportDocument(updated.rows[0]);
    const exists = await this.pool.query(
      `SELECT 1 FROM app.transport_document WHERE document_id = $2::uuid AND job_id = $1::uuid`,
      [jobId, documentId],
    );
    return exists.rows.length > 0 ? "not_draft" : "not_found";
  }

  async issueTransportDocument(
    jobId: string,
    documentId: string,
    issuedBy: string,
  ): Promise<
    | TransportDocumentRecord
    | "not_found"
    | "not_draft"
    | "no_number"
    | "number_taken"
  > {
    const current = await this.pool.query(
      `SELECT status, document_number FROM app.transport_document
       WHERE document_id = $2::uuid AND job_id = $1::uuid`,
      [jobId, documentId],
    );
    if (current.rows.length === 0) return "not_found";
    if (current.rows[0].status !== "draft") return "not_draft";
    if (!current.rows[0].document_number) return "no_number";
    try {
      const updated = await this.pool.query(
        `UPDATE app.transport_document
         SET status = 'issued', issued_by = $3::uuid, issued_at = clock_timestamp(),
             updated_at = clock_timestamp()
         WHERE document_id = $2::uuid AND job_id = $1::uuid AND status = 'draft'
         RETURNING *`,
        [jobId, documentId, issuedBy],
      );
      return updated.rows[0]
        ? this.mapTransportDocument(updated.rows[0])
        : "not_draft";
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return "number_taken";
      throw error;
    }
  }

  async voidTransportDocument(
    jobId: string,
    documentId: string,
    voidedBy: string,
    reason: string,
  ): Promise<TransportDocumentRecord | "not_found" | "already_void"> {
    const current = await this.pool.query(
      `SELECT status FROM app.transport_document
       WHERE document_id = $2::uuid AND job_id = $1::uuid`,
      [jobId, documentId],
    );
    if (current.rows.length === 0) return "not_found";
    if (current.rows[0].status === "void") return "already_void";
    const updated = await this.pool.query(
      `UPDATE app.transport_document
       SET status = 'void', voided_by = $3::uuid, voided_at = clock_timestamp(),
           void_reason = $4, updated_at = clock_timestamp()
       WHERE document_id = $2::uuid AND job_id = $1::uuid AND status <> 'void'
       RETURNING *`,
      [jobId, documentId, voidedBy, reason],
    );
    return updated.rows[0]
      ? this.mapTransportDocument(updated.rows[0])
      : "already_void";
  }

  private mapTransportDocument(
    row: Record<string, unknown>,
  ): TransportDocumentRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    const timestamp = (value: unknown) =>
      value ? this.toIsoString(value) : null;
    return {
      id: String(row.document_id),
      jobId: String(row.job_id),
      kind: row.kind as TransportDocumentRecord["kind"],
      documentNumber: optional(row.document_number),
      status: row.status as TransportDocumentRecord["status"],
      fields: row.fields as Record<string, string>,
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at),
      issuedBy: optional(row.issued_by),
      issuedAt: timestamp(row.issued_at),
      voidedBy: optional(row.voided_by),
      voidedAt: timestamp(row.voided_at),
      voidReason: optional(row.void_reason),
    };
  }

  async listJobFinance(scope: JobScope): Promise<JobFinanceRecord[]> {
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT job.job_id, job.file_number, company.company_name, money.currency,
              sum(money.invoiced_minor) AS invoiced_minor,
              sum(money.received_minor) AS received_minor,
              sum(money.cost_minor) AS cost_minor
       FROM app.job job
       JOIN app.customer_company company ON company.company_id = job.customer_company_id
       JOIN (
         SELECT i.job_id, i.currency, i.total_minor AS invoiced_minor,
                COALESCE((
                  SELECT sum(p.amount_minor) FROM app.invoice_payment p
                  WHERE p.invoice_id = i.invoice_id
                    AND NOT EXISTS (
                      SELECT 1 FROM app.invoice_payment_reversal r
                      WHERE r.payment_id = p.payment_id)
                ), 0) AS received_minor,
                0::bigint AS cost_minor
         FROM app.invoice i
         WHERE i.status = 'issued'
         UNION ALL
         SELECT c.job_id, actual.currency, 0::bigint, 0::bigint, actual.amount_minor
         FROM app.job_charge c
         JOIN LATERAL (
           SELECT a.currency, a.amount_minor FROM app.job_charge_actual a
           WHERE a.charge_id = c.charge_id
           ORDER BY a.recorded_at DESC, a.actual_id DESC LIMIT 1
         ) actual ON true
         WHERE c.removed_at IS NULL
       ) money ON money.job_id = job.job_id
       WHERE ($1::uuid[] IS NULL OR job.customer_company_id = ANY($1::uuid[]))
         AND ($2::text[] IS NULL OR job.service_line = ANY($2::text[]))
       GROUP BY job.job_id, job.file_number, job.opened_at, company.company_name, money.currency
       ORDER BY job.opened_at DESC, job.job_id, money.currency`,
      [scope.companyIds ?? null, scope.serviceLines ?? null],
    );
    return result.rows.map((row) => ({
      jobId: String(row.job_id),
      fileNumber: String(row.file_number),
      customerCompanyName: String(row.company_name),
      currency: String(row.currency),
      invoicedMinor: Number(row.invoiced_minor),
      receivedMinor: Number(row.received_minor),
      costMinor: Number(row.cost_minor),
    }));
  }

  async listCustomerInsights(
    companyId: string | null,
  ): Promise<CustomerInsightRecord[]> {
    const counts = await this.pool.query(
      `SELECT company.company_id,
              (SELECT count(*) FROM app.job j
                WHERE j.customer_company_id = company.company_id) AS total_jobs,
              (SELECT count(*) FROM app.job j
                WHERE j.customer_company_id = company.company_id
                  AND j.status NOT IN ('closed', 'cancelled')) AS active_jobs,
              (SELECT max(j.opened_at) FROM app.job j
                WHERE j.customer_company_id = company.company_id) AS last_job_at,
              greatest(
                (SELECT max(c.occurred_at) FROM app.job_correspondence c
                  JOIN app.job j ON j.job_id = c.job_id
                  WHERE j.customer_company_id = company.company_id),
                (SELECT max(n.created_at) FROM app.notification n
                  WHERE n.company_id = company.company_id)
              ) AS last_contact_at,
              (SELECT count(*) FROM app.quote q
                WHERE q.customer_company_id = company.company_id
                  AND EXISTS (SELECT 1 FROM app.quote_version v
                    WHERE v.quote_id = q.quote_id AND v.status = 'issued')
              ) AS quotes_sent,
              (SELECT count(*) FROM app.quote q
                WHERE q.customer_company_id = company.company_id
                  AND EXISTS (SELECT 1 FROM app.quote_decision d
                    WHERE d.quote_id = q.quote_id AND d.decision = 'accepted')
              ) AS quotes_accepted,
              (SELECT count(*) FROM app.quote q
                WHERE q.customer_company_id = company.company_id
                  AND EXISTS (
                    SELECT 1 FROM app.quote_version v
                    WHERE v.quote_id = q.quote_id AND v.status = 'issued'
                      AND v.version_number = (
                        SELECT max(l.version_number) FROM app.quote_version l
                        WHERE l.quote_id = q.quote_id AND l.status = 'issued')
                      AND NOT EXISTS (
                        SELECT 1 FROM app.quote_decision d
                        WHERE d.version_id = v.version_id))
              ) AS quotes_awaiting
       FROM app.customer_company company
       WHERE ($1::uuid IS NULL OR company.company_id = $1::uuid)`,
      [companyId],
    );
    const money = await this.pool.query(
      `SELECT job.customer_company_id AS company_id, i.currency,
              sum(i.total_minor) AS invoiced_minor,
              sum(COALESCE(paid.received_minor, 0)) AS received_minor,
              avg(paid.last_received_on - i.issued_at::date)
                FILTER (WHERE paid.received_minor >= i.total_minor) AS days_to_pay
       FROM app.invoice i
       JOIN app.job job ON job.job_id = i.job_id
       LEFT JOIN LATERAL (
         SELECT sum(p.amount_minor) AS received_minor,
                max(p.received_on) AS last_received_on
         FROM app.invoice_payment p
         WHERE p.invoice_id = i.invoice_id
           AND NOT EXISTS (
             SELECT 1 FROM app.invoice_payment_reversal r
             WHERE r.payment_id = p.payment_id)
       ) paid ON true
       WHERE i.status = 'issued'
         AND ($1::uuid IS NULL OR job.customer_company_id = $1::uuid)
       GROUP BY job.customer_company_id, i.currency
       ORDER BY i.currency`,
      [companyId],
    );
    return counts.rows.map((row) => ({
      companyId: String(row.company_id),
      totalJobs: Number(row.total_jobs),
      activeJobs: Number(row.active_jobs),
      lastJobAt: row.last_job_at ? this.toIsoString(row.last_job_at) : null,
      lastContactAt: row.last_contact_at
        ? this.toIsoString(row.last_contact_at)
        : null,
      quotesSent: Number(row.quotes_sent),
      quotesAccepted: Number(row.quotes_accepted),
      quotesAwaiting: Number(row.quotes_awaiting),
      money: money.rows
        .filter((entry) => String(entry.company_id) === String(row.company_id))
        .map((entry) => ({
          currency: String(entry.currency),
          invoicedMinor: Number(entry.invoiced_minor),
          receivedMinor: Number(entry.received_minor),
          averageDaysToPay:
            entry.days_to_pay === null
              ? null
              : Math.round(Number(entry.days_to_pay)),
        })),
    }));
  }

  private readonly leadSelect = `
    SELECT lead.lead_id, lead.company_name, lead.contact_name, lead.email,
           lead.phone, lead.source, lead.stage, lead.owner_id,
           owner.email AS owner_email,
           to_char(lead.next_follow_up, 'YYYY-MM-DD') AS next_follow_up_text,
           lead.notes, lead.lost_reason, lead.quote_request_id,
           lead.customer_company_id, company.company_name AS customer_company_name,
           lead.created_at, lead.updated_at, lead.stage_changed_at
    FROM app.lead lead
    LEFT JOIN auth.users owner ON owner.id = lead.owner_id
    LEFT JOIN app.customer_company company
      ON company.company_id = lead.customer_company_id`;

  private mapLead(row: Record<string, unknown>): LeadRecord {
    const optional = (value: unknown) =>
      value === null || value === undefined ? null : String(value);
    return {
      id: String(row.lead_id),
      companyName: String(row.company_name),
      contactName: optional(row.contact_name),
      email: optional(row.email),
      phone: optional(row.phone),
      source: String(row.source) as LeadSource,
      stage: String(row.stage) as LeadStage,
      ownerId: optional(row.owner_id),
      ownerEmail: optional(row.owner_email),
      nextFollowUp: optional(row.next_follow_up_text),
      notes: optional(row.notes),
      lostReason: optional(row.lost_reason),
      quoteRequestId: optional(row.quote_request_id),
      customerCompanyId: optional(row.customer_company_id),
      customerCompanyName: optional(row.customer_company_name),
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at),
      stageChangedAt: this.toIsoString(row.stage_changed_at),
    };
  }

  async listLeads(): Promise<LeadRecord[]> {
    const result = await this.pool.query(
      `${this.leadSelect} ORDER BY lead.created_at DESC, lead.lead_id`,
    );
    return result.rows.map((row) => this.mapLead(row));
  }

  async findLead(id: string): Promise<LeadRecord | null> {
    const result = await this.pool.query(
      `${this.leadSelect} WHERE lead.lead_id = $1::uuid`,
      [id],
    );
    return result.rows[0] ? this.mapLead(result.rows[0]) : null;
  }

  async createLead(
    input: Parameters<DatabasePort["createLead"]>[0],
  ): Promise<LeadRecord | "duplicate_request" | "unknown_reference"> {
    try {
      await this.pool.query(
        `INSERT INTO app.lead
           (lead_id, company_name, contact_name, email, phone, source, stage,
            owner_id, next_follow_up, notes, lost_reason, quote_request_id,
            customer_company_id, created_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9::date, $10, $11,
                 $12::uuid, $13::uuid, $14::uuid)`,
        [
          input.id,
          input.companyName,
          input.contactName,
          input.email,
          input.phone,
          input.source,
          input.stage,
          input.ownerId,
          input.nextFollowUp,
          input.notes,
          input.lostReason,
          input.quoteRequestId,
          input.customerCompanyId,
          input.createdBy,
        ],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return "duplicate_request";
      if (code === "23503") return "unknown_reference";
      throw error;
    }
    return (await this.findLead(input.id))!;
  }

  async saveLead(
    lead: LeadRecord,
  ): Promise<LeadRecord | "unknown_reference" | null> {
    try {
      const result = await this.pool.query(
        `UPDATE app.lead SET
           company_name = $2, contact_name = $3, email = $4, phone = $5,
           stage = $6, owner_id = $7::uuid, next_follow_up = $8::date,
           notes = $9, lost_reason = $10, customer_company_id = $11::uuid,
           updated_at = clock_timestamp(),
           stage_changed_at = CASE WHEN stage <> $6
             THEN clock_timestamp() ELSE stage_changed_at END
         WHERE lead_id = $1::uuid`,
        [
          lead.id,
          lead.companyName,
          lead.contactName,
          lead.email,
          lead.phone,
          lead.stage,
          lead.ownerId,
          lead.nextFollowUp,
          lead.notes,
          lead.lostReason,
          lead.customerCompanyId,
        ],
      );
      if (result.rowCount === 0) return null;
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        return "unknown_reference";
      }
      throw error;
    }
    return this.findLead(lead.id);
  }

  async listOutstandingInvoices(filter: {
    companyId: string | null;
    scope: JobScope;
  }): Promise<OutstandingInvoiceRecord[]> {
    const { scope } = filter;
    if (scope.companyIds?.length === 0 || scope.serviceLines?.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT * FROM (
         SELECT i.invoice_id, i.invoice_number, i.currency, i.total_minor,
                to_char(i.due_date, 'YYYY-MM-DD') AS due_date_text, i.issued_at,
                job.job_id, job.file_number, job.customer_company_id,
                company.company_name,
                i.total_minor - COALESCE((
                  SELECT sum(p.amount_minor) FROM app.invoice_payment p
                  WHERE p.invoice_id = i.invoice_id
                    AND NOT EXISTS (
                      SELECT 1 FROM app.invoice_payment_reversal r
                      WHERE r.payment_id = p.payment_id)
                ), 0) AS outstanding_minor
         FROM app.invoice i
         JOIN app.job job ON job.job_id = i.job_id
         JOIN app.customer_company company ON company.company_id = job.customer_company_id
         WHERE i.status = 'issued'
           AND ($1::uuid IS NULL OR job.customer_company_id = $1::uuid)
           AND ($2::uuid[] IS NULL OR job.customer_company_id = ANY($2::uuid[]))
           AND ($3::text[] IS NULL OR job.service_line = ANY($3::text[]))
       ) owing
       WHERE outstanding_minor > 0
       ORDER BY due_date_text NULLS LAST, issued_at, invoice_id`,
      [filter.companyId, scope.companyIds ?? null, scope.serviceLines ?? null],
    );
    return result.rows.map((row) => ({
      invoiceId: String(row.invoice_id),
      invoiceNumber: String(row.invoice_number),
      jobId: String(row.job_id),
      fileNumber: String(row.file_number),
      customerCompanyId: String(row.customer_company_id),
      customerCompanyName: String(row.company_name),
      currency: String(row.currency),
      totalMinor: Number(row.total_minor),
      outstandingMinor: Number(row.outstanding_minor),
      dueDate: row.due_date_text ? String(row.due_date_text) : null,
      issuedAt: this.toIsoString(row.issued_at),
    }));
  }

  private mapDriver(row: Record<string, unknown>): DriverRecord {
    return {
      id: String(row.driver_id),
      name: String(row.driver_name),
      phone: String(row.phone),
      createdAt: this.toIsoString(row.created_at),
      deactivatedAt: row.deactivated_at
        ? this.toIsoString(row.deactivated_at)
        : null,
    };
  }

  private mapVehicle(row: Record<string, unknown>): VehicleRecord {
    return {
      id: String(row.vehicle_id),
      registration: String(row.registration),
      description: row.description ? String(row.description) : null,
      createdAt: this.toIsoString(row.created_at),
      deactivatedAt: row.deactivated_at
        ? this.toIsoString(row.deactivated_at)
        : null,
    };
  }

  private mapInvoice(row: Record<string, unknown>): InvoiceRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    const timestamp = (value: unknown) =>
      value ? this.toIsoString(value) : null;
    return {
      id: String(row.invoice_id),
      jobId: String(row.job_id),
      invoiceNumber: optional(row.invoice_number),
      status: row.status as InvoiceRecord["status"],
      currency: String(row.currency),
      lines: row.lines as InvoiceLineRecord[],
      dueDate: optional(row.due_date_text),
      notes: optional(row.notes),
      subtotalMinor: Number(row.subtotal_minor),
      taxLines: row.tax_lines as InvoiceRecord["taxLines"],
      taxTotalMinor: Number(row.tax_total_minor),
      totalMinor: Number(row.total_minor),
      createdBy: String(row.created_by),
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at),
      issuedBy: optional(row.issued_by),
      issuedAt: timestamp(row.issued_at),
      voidedBy: optional(row.voided_by),
      voidedAt: timestamp(row.voided_at),
      voidReason: optional(row.void_reason),
    };
  }

  private mapPayment(row: Record<string, unknown>): InvoicePaymentRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    return {
      id: String(row.payment_id),
      invoiceId: String(row.invoice_id),
      receiptNumber: optional(row.receipt_number),
      amountMinor: Number(row.amount_minor),
      receivedOn: String(row.received_on_text),
      method: row.method as InvoicePaymentRecord["method"],
      reference: optional(row.reference),
      evidenceDocumentId: optional(row.evidence_document_id),
      note: optional(row.note),
      recordedBy: String(row.recorded_by),
      recordedAt: this.toIsoString(row.recorded_at),
      reversal: row.reversal_reason
        ? {
            reason: String(row.reversal_reason),
            reversedBy: String(row.reversed_by),
            reversedAt: this.toIsoString(row.reversed_at),
          }
        : null,
    };
  }

  private mapDelivery(row: Record<string, unknown>): DeliveryRecord {
    const optional = (value: unknown) => (value ? String(value) : null);
    return {
      id: String(row.delivery_id),
      jobId: String(row.job_id),
      waybillNumber: String(row.waybill_number),
      driverId: String(row.driver_id),
      vehicleId: String(row.vehicle_id),
      driverName: String(row.driver_name),
      driverPhone: String(row.driver_phone),
      vehicleRegistration: String(row.vehicle_registration),
      cargoDescription: String(row.cargo_description),
      packages: row.packages === null ? null : Number(row.packages),
      grossWeightKg:
        row.gross_weight_kg === null ? null : Number(row.gross_weight_kg),
      pickupLocation: optional(row.pickup_location),
      deliveryAddress: String(row.delivery_address),
      dispatchedAt: this.toIsoString(row.dispatched_at),
      dispatchedBy: String(row.dispatched_by),
      status: row.status as "dispatched" | "delivered",
      receiverName: optional(row.receiver_name),
      receiverPhone: optional(row.receiver_phone),
      deliveredAt: row.delivered_at ? this.toIsoString(row.delivered_at) : null,
      damageNotes: optional(row.damage_notes),
      podDocumentId: optional(row.pod_document_id),
      podRecordedBy: optional(row.pod_recorded_by),
      podRecordedAt: row.pod_recorded_at
        ? this.toIsoString(row.pod_recorded_at)
        : null,
    };
  }

  async recordActivity(entry: ActivityEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO app.activity_log
        (actor_user_id, actor_email, method, route, entity_id, status_code, client_ip)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7)`,
      [
        entry.actorUserId,
        entry.actorEmail,
        entry.method,
        entry.route,
        entry.entityId,
        entry.statusCode,
        entry.clientIp,
      ],
    );
  }

  async listActivity(filter: ActivityFilter): Promise<ActivityRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM app.activity_log
       WHERE ($1::uuid IS NULL OR actor_user_id = $1::uuid)
         AND ($2::uuid IS NULL OR entity_id = $2::uuid)
         AND ($3::timestamptz IS NULL OR occurred_at >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR occurred_at <= $4::timestamptz)
       ORDER BY occurred_at DESC, activity_id DESC
       LIMIT $5 OFFSET $6`,
      [
        filter.actorUserId ?? null,
        filter.entityId ?? null,
        filter.from ?? null,
        filter.to ?? null,
        filter.limit,
        filter.offset,
      ],
    );
    return result.rows.map((row) => ({
      id: String(row.activity_id),
      occurredAt: this.toIsoString(row.occurred_at),
      actorUserId: String(row.actor_user_id),
      actorEmail: row.actor_email ? String(row.actor_email) : null,
      method: String(row.method),
      route: String(row.route),
      entityId: row.entity_id ? String(row.entity_id) : null,
      statusCode: Number(row.status_code),
      clientIp: row.client_ip ? String(row.client_ip) : null,
    }));
  }

  /** A suspended (banned) account gets no companies, even with a token issued before the ban. */
  async getActiveCustomerCompanyIds(userId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT company_id FROM app.customer_membership
       WHERE user_id = $1::uuid AND revoked_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM auth.users
           WHERE id = $1::uuid AND banned_until > now())
       ORDER BY company_id`,
      [userId],
    );
    return result.rows.map((row) => String(row.company_id));
  }

  async listActiveCustomerMemberships(): Promise<
    ActiveCustomerMembershipRecord[]
  > {
    const result = await this.pool.query(
      `SELECT m.user_id, m.company_id, c.company_name, m.granted_at
       FROM app.customer_membership m
       JOIN app.customer_company c ON c.company_id = m.company_id
       WHERE m.revoked_at IS NULL
       ORDER BY c.company_name, m.granted_at`,
    );
    return result.rows.map((row) => ({
      userId: String(row.user_id),
      companyId: String(row.company_id),
      companyName: String(row.company_name),
      grantedAt: this.toIsoString(row.granted_at),
    }));
  }

  async listCustomerMemberships(
    userId: string,
  ): Promise<CustomerMembershipRecord[]> {
    const result = await this.pool.query(
      `SELECT membership_id, company_id, user_id, granted_by, granted_at, revoked_at
       FROM app.customer_membership WHERE user_id = $1::uuid
       ORDER BY granted_at DESC, membership_id DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: String(row.membership_id),
      companyId: String(row.company_id),
      userId: String(row.user_id),
      grantedBy: String(row.granted_by),
      grantedAt: this.toIsoString(row.granted_at),
      revokedAt: row.revoked_at ? this.toIsoString(row.revoked_at) : null,
    }));
  }

  async grantCustomerMembership(
    companyId: string,
    userId: string,
    grantedBy: string,
  ): Promise<CustomerMembershipRecord | "already_active"> {
    const result = await this.pool.query(
      `INSERT INTO app.customer_membership (company_id, user_id, granted_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid)
       ON CONFLICT DO NOTHING
       RETURNING membership_id, company_id, user_id, granted_by, granted_at, revoked_at`,
      [companyId, userId, grantedBy],
    );
    const row = result.rows[0];
    if (!row) return "already_active";
    return {
      id: String(row.membership_id),
      companyId: String(row.company_id),
      userId: String(row.user_id),
      grantedBy: String(row.granted_by),
      grantedAt: this.toIsoString(row.granted_at),
      revokedAt: row.revoked_at ? this.toIsoString(row.revoked_at) : null,
    };
  }

  async revokeCustomerMembership(
    companyId: string,
    userId: string,
    revokedBy: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [revokedBy],
      );
      const result = await client.query(
        `UPDATE app.customer_membership SET revoked_at = now()
         WHERE company_id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL`,
        [companyId, userId],
      );
      await client.query("COMMIT");
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async hasActiveSuperAdmin(): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM app.super_admin_bootstrap_claim WHERE singleton = true
       ) OR EXISTS (
         SELECT 1 FROM app.staff_role_assignment
         WHERE role_key = 'super_admin' AND revoked_at IS NULL
       ) AS claimed`,
    );
    return Boolean(result.rows[0]?.claimed);
  }

  async claimInitialSuperAdmin(userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('bjh_super_admin_role')::bigint)",
      );
      const existing = await client.query(
        `SELECT 1 FROM app.super_admin_bootstrap_claim WHERE singleton = true
         UNION ALL
         SELECT 1 FROM app.staff_role_assignment
         WHERE role_key = 'super_admin' AND revoked_at IS NULL
         LIMIT 1`,
      );
      if (existing.rows.length > 0) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `INSERT INTO app.super_admin_bootstrap_claim
          (singleton, claimed_user_id) VALUES (true, $1::uuid)`,
        [userId],
      );
      await client.query(
        `INSERT INTO app.staff_role_assignment
          (user_id, role_key, assigned_by)
         VALUES ($1::uuid, 'super_admin', $1::uuid)`,
        [userId],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getActiveStaffRoles(userId: string): Promise<StaffRoleKey[]> {
    const result = await this.pool.query(
      `SELECT role_key FROM app.staff_role_assignment
       WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [userId],
    );
    return result.rows.map((row) => String(row.role_key) as StaffRoleKey);
  }

  async listStaffRoleAssignments(): Promise<StaffRoleAssignmentRecord[]> {
    const result = await this.pool.query(
      `SELECT assignment_id, user_id, role_key, assigned_by, assigned_at, revoked_at
       FROM app.staff_role_assignment
       ORDER BY assigned_at DESC, assignment_id DESC`,
    );
    return result.rows.map((row) => ({
      id: String(row.assignment_id),
      userId: String(row.user_id),
      roleKey: String(row.role_key) as StaffRoleKey,
      assignedBy: String(row.assigned_by),
      assignedAt: this.toIsoString(row.assigned_at),
      revokedAt: row.revoked_at ? this.toIsoString(row.revoked_at) : null,
    }));
  }

  async assignStaffRole(
    userId: string,
    roleKey: StaffRoleKey,
    assignedBy: string,
  ): Promise<
    StaffRoleAssignmentRecord | "super_admin_exists" | "already_active"
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (roleKey === "super_admin") {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('bjh_super_admin_role')::bigint)",
        );
        const existing = await client.query(
          `SELECT 1 FROM app.staff_role_assignment
           WHERE role_key = 'super_admin' AND revoked_at IS NULL LIMIT 1`,
        );
        if (existing.rows.length) {
          await client.query("COMMIT");
          return "super_admin_exists";
        }
      }
      const result = await client.query(
        `INSERT INTO app.staff_role_assignment (user_id, role_key, assigned_by)
         VALUES ($1::uuid, $2, $3::uuid)
         ON CONFLICT DO NOTHING
         RETURNING assignment_id, user_id, role_key, assigned_by, assigned_at, revoked_at`,
        [userId, roleKey, assignedBy],
      );
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return "already_active";
      }
      const row = result.rows[0];
      await client.query("COMMIT");
      return {
        id: String(row.assignment_id),
        userId: String(row.user_id),
        roleKey: String(row.role_key) as StaffRoleKey,
        assignedBy: String(row.assigned_by),
        assignedAt: this.toIsoString(row.assigned_at),
        revokedAt: null,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeStaffRole(
    userId: string,
    roleKey: StaffRoleKey,
    revokedBy: string,
  ): Promise<"revoked" | "not_found" | "last_super_admin"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (roleKey === "super_admin") {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('bjh_super_admin_role')::bigint)",
        );
        const count = await client.query(
          `SELECT COUNT(*) AS count FROM app.staff_role_assignment
           WHERE role_key = 'super_admin' AND revoked_at IS NULL`,
        );
        const active = await client.query(
          `SELECT assignment_id FROM app.staff_role_assignment
           WHERE user_id = $1::uuid AND role_key = 'super_admin' AND revoked_at IS NULL`,
          [userId],
        );
        if (active.rows.length === 0) {
          await client.query("COMMIT");
          return "not_found";
        }
        if (Number(count.rows[0].count) <= 1) {
          await client.query("COMMIT");
          return "last_super_admin";
        }
      }
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [revokedBy],
      );
      const result = await client.query(
        `UPDATE app.staff_role_assignment SET revoked_at = now()
         WHERE user_id = $1::uuid AND role_key = $2 AND revoked_at IS NULL`,
        [userId, roleKey],
      );
      await client.query("COMMIT");
      return result.rowCount ? "revoked" : "not_found";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private toQuoteRequest(row: Record<string, unknown>): QuoteRequestRecord {
    return {
      id: String(row.request_id),
      companyName: String(row.company_name),
      contactName: String(row.contact_name),
      email: String(row.email),
      message: String(row.message),
      createdAt: this.toIsoString(row.created_at),
      customerCompanyId:
        row.customer_company_id === null
          ? null
          : String(row.customer_company_id),
      customerCompanyName:
        row.customer_company_name === null
          ? null
          : String(row.customer_company_name),
      quoteId: row.quote_id === null ? null : String(row.quote_id),
      quoteNumber: row.quote_number === null ? null : String(row.quote_number),
      quoteStatus:
        row.quote_status === null
          ? null
          : (row.quote_status as "draft" | "issued"),
    };
  }

  private groupCustomers(
    rows: Array<Record<string, unknown>>,
  ): CustomerCompanyRecord[] {
    const customers = new Map<string, CustomerCompanyRecord>();
    for (const row of rows) {
      const id = String(row.company_id);
      let customer = customers.get(id);
      if (!customer) {
        customer = {
          id,
          customerNumber: String(row.customer_number),
          companyName: String(row.company_name),
          tradingName: row.trading_name ? String(row.trading_name) : null,
          registrationNumber: row.registration_number
            ? String(row.registration_number)
            : null,
          taxNumber: row.tax_number ? String(row.tax_number) : null,
          phone: row.company_phone ? String(row.company_phone) : null,
          companyEmail: row.company_email ? String(row.company_email) : null,
          website: row.website ? String(row.website) : null,
          businessAddress: row.business_address
            ? String(row.business_address)
            : null,
          billingAddress: row.billing_address
            ? String(row.billing_address)
            : null,
          country: row.country ? String(row.country) : null,
          createdAt: this.toIsoString(row.company_created_at),
          contacts: [],
        };
        customers.set(id, customer);
      }
      if (row.contact_id !== null && row.contact_id !== undefined) {
        customer.contacts.push({
          id: String(row.contact_id),
          name: String(row.contact_name),
          role: row.contact_role ? String(row.contact_role) : null,
          email: String(row.contact_email),
          isPrimary: row.contact_is_primary === true,
          phone: row.contact_phone ? String(row.contact_phone) : null,
          notify: row.contact_notify !== false,
          createdAt: this.toIsoString(row.contact_created_at),
        });
      }
    }
    return [...customers.values()];
  }

  private toIsoString(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value));
    return date.toISOString();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
