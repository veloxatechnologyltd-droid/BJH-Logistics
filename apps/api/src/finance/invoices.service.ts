import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  invoiceAcceptanceInputSchema,
  invoiceFromChargesInputSchema,
  invoiceInputSchema,
  invoiceReasonInputSchema,
  isUuid,
  parseContract,
  paymentBatchInputSchema,
  paymentInputSchema,
} from "@bjh/contracts";
import {
  DatabasePort,
  InvoiceAcceptanceRecord,
  InvoiceLineRecord,
  InvoicePaymentRecord,
  InvoiceRecord,
  JobRecord,
  JobScope,
  StaffRoleKey,
} from "../database/database.port";
import { JobsService } from "../jobs/jobs.service";
import { JobChargesService, JobChargeView } from "./job-charges.service";
import { computeInvoiceTotals } from "./invoice-totals";
import {
  invoiceIssuedMessage,
  paymentReceivedMessage,
  receiptSentMessage,
  paymentsReceivedMessage,
} from "../notifications/notification-messages";
import { NotificationsService } from "../notifications/notifications.service";
import { renderInvoicePdf } from "./invoice-pdf";
import { renderReceiptPdf } from "./receipt-pdf";

export interface InvoiceView extends InvoiceRecord {
  /** Payments still standing (not reversed). */
  paidMinor: number;
  /** What is still owed: zero for drafts and voided invoices. */
  outstandingMinor: number;
  paymentStatus: "draft" | "void" | "unpaid" | "partial" | "paid";
  /** The full ledger, for staff only; customers see the balance, not the ledger. */
  payments?: InvoicePaymentRecord[];
  /** The client's acceptance, once given; it lets customer service assign the job. */
  acceptance: InvoiceAcceptanceRecord | null;
}

/** A job charge an invoice started from charges did not include, and why. */
export interface ChargeLeftOut {
  description: string;
  /** `no_amount`: at cost with nothing recorded; `other_currency`: belongs on the `currency` invoice. */
  reason: "no_amount" | "other_currency";
  currency?: string;
}

/** Which invoice currency a charge is billed in, and for how much; null when it has no amount yet. */
export function chargeBilling(
  charge: JobChargeView,
): { currency: string; amountMinor: number } | null {
  const actual = charge.currentActual;
  if (charge.quotedTotalMinor !== null) {
    return {
      currency: charge.currency,
      amountMinor: actual?.convertedMinor ?? charge.quotedTotalMinor,
    };
  }
  if (!actual) return null;
  return actual.convertedMinor !== null
    ? { currency: charge.currency, amountMinor: actual.convertedMinor }
    : { currency: actual.currency, amountMinor: actual.amountMinor };
}

/**
 * Customer invoices on a job and the payments staff record against them.
 * A draft is editable; issuing numbers it and freezes lines, tax and totals;
 * a mistake is corrected by voiding and issuing a new invoice. Payments are
 * received outside the system, never reduce below zero, and are reversed, not
 * edited. The balance is always derived from the standing payments.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(JobChargesService) private readonly charges: JobChargesService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  async list(id: string, scope: JobScope): Promise<InvoiceView[]> {
    const job = await this.jobs.get(id, scope);
    const isCustomer = scope.companyIds !== undefined;
    const [invoices, payments, acceptances] = await Promise.all([
      this.database.listInvoices(job.id),
      this.database.listInvoicePayments(job.id),
      this.database.listInvoiceAcceptances(job.id),
    ]);
    return (
      invoices
        // A draft, even one voided before issue, was never sent to the customer.
        .filter((invoice) => !isCustomer || invoice.issuedAt !== null)
        .map((invoice) =>
          this.view(
            invoice,
            payments.filter((payment) => payment.invoiceId === invoice.id),
            !isCustomer,
            acceptances.find((item) => item.invoiceId === invoice.id),
          ),
        )
    );
  }

  /**
   * Records that the client accepted an issued invoice, once. A customer accepts
   * their own company's in the portal; on the staff side customer service (or
   * the super admin) records it on the client's word.
   */
  async accept(
    id: string,
    invoiceId: string,
    input: unknown,
    actorId: string,
    roles: StaffRoleKey[],
    scope: JobScope,
  ): Promise<InvoiceAcceptanceRecord> {
    const isCustomer = scope.companyIds !== undefined;
    if (
      !isCustomer &&
      !roles.includes("super_admin") &&
      !roles.includes("customer_service_rep")
    ) {
      throw new ForbiddenException(
        "Only customer service records a client's acceptance",
      );
    }
    const parsed = parseContract(invoiceAcceptanceInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const job = await this.jobs.get(id, scope);
    const result = isUuid(invoiceId)
      ? await this.database.recordInvoiceAcceptance(job.id, invoiceId, {
          acceptedBy: actorId,
          signatoryName: parsed.data.signatoryName,
          via: isCustomer ? "portal" : "staff",
        })
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Invoice was not found on this job");
    }
    if (result === "not_issued") {
      // A customer is never shown drafts, so they get the same answer as for a missing one.
      if (isCustomer) {
        throw new NotFoundException("Invoice was not found on this job");
      }
      throw new ConflictException("Only an issued invoice can be accepted");
    }
    if (result === "already_accepted") {
      throw new ConflictException("This invoice has already been accepted");
    }
    return result;
  }

  async create(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<InvoiceView> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(invoiceInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const settings = await this.requireConfiguredCurrency(parsed.data.currency);
    const invoice = await this.database.createInvoice({
      jobId: job.id,
      currency: parsed.data.currency,
      lines: parsed.data.lines,
      dueDate: parsed.data.dueDate,
      notes: parsed.data.notes,
      totals: computeInvoiceTotals(parsed.data.lines, settings?.taxLines ?? []),
      createdBy,
    });
    return this.view(invoice, [], true);
  }

  /**
   * Starts a draft from the job's charges. Each charge belongs to exactly one
   * invoice currency, so nothing is billed twice: a priced charge goes on its
   * own currency's invoice at its comparable actual, or its quoted total when
   * the actual is in GHS and the charge currency differs; an "at cost" charge
   * (no quoted amount) goes on the invoice in its actual's currency at that
   * actual. Currencies are never converted here. Every charge left out is
   * returned with the reason; `skipped` counts those with no amount yet.
   */
  async createFromCharges(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<{
    invoice: InvoiceView;
    skipped: number;
    leftOut: ChargeLeftOut[];
  }> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(invoiceFromChargesInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const settings = await this.requireConfiguredCurrency(parsed.data.currency);

    const { charges } = await this.charges.list(job.id, scope);
    const lines: InvoiceLineRecord[] = [];
    const leftOut: ChargeLeftOut[] = [];
    for (const charge of charges) {
      const billing = chargeBilling(charge);
      if (billing === null) {
        leftOut.push({ description: charge.description, reason: "no_amount" });
      } else if (billing.currency !== parsed.data.currency) {
        leftOut.push({
          description: charge.description,
          reason: "other_currency",
          currency: billing.currency,
        });
      } else {
        lines.push({
          description: charge.description,
          amountMinor: billing.amountMinor,
          taxable: true,
        });
      }
    }
    if (lines.length === 0) {
      throw new ConflictException(
        `No charge on this job has an amount in ${parsed.data.currency} to invoice`,
      );
    }
    const invoice = await this.database.createInvoice({
      jobId: job.id,
      currency: parsed.data.currency,
      lines,
      dueDate: parsed.data.dueDate,
      notes: parsed.data.notes,
      totals: computeInvoiceTotals(lines, settings?.taxLines ?? []),
      createdBy,
    });
    return {
      invoice: this.view(invoice, [], true),
      skipped: leftOut.filter((item) => item.reason === "no_amount").length,
      leftOut,
    };
  }

  async update(
    id: string,
    invoiceId: string,
    input: unknown,
    scope: JobScope,
  ): Promise<InvoiceView> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(invoiceInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const settings = await this.requireConfiguredCurrency(parsed.data.currency);
    const result = isUuid(invoiceId)
      ? await this.database.updateDraftInvoice(job.id, invoiceId, {
          currency: parsed.data.currency,
          lines: parsed.data.lines,
          dueDate: parsed.data.dueDate,
          notes: parsed.data.notes,
          totals: computeInvoiceTotals(
            parsed.data.lines,
            settings?.taxLines ?? [],
          ),
        })
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Invoice was not found on this job");
    }
    if (result === "not_draft") {
      throw new ConflictException(
        "Only a draft invoice can be edited; void this one and issue a new invoice",
      );
    }
    return this.view(result, [], true);
  }

  /** Numbers the invoice and freezes its lines, tax lines and totals. */
  async issue(
    id: string,
    invoiceId: string,
    issuedBy: string,
    scope: JobScope,
  ): Promise<InvoiceView> {
    const job = await this.editableJob(id, scope);
    const invoice = await this.find(job.id, invoiceId);
    const current = await this.database.getBusinessSettings();
    if (!current) {
      throw new ConflictException(
        "Configure the business settings before issuing an invoice",
      );
    }
    const settings = current.settings;
    if (!settings.currencies.includes(invoice.currency)) {
      throw new BadRequestException(
        `currency must be one of the configured currencies: ${settings.currencies.join(", ")}`,
      );
    }
    const dueDate =
      invoice.dueDate ??
      (settings.paymentTermsDays === null
        ? null
        : new Date(Date.now() + settings.paymentTermsDays * 86_400_000)
            .toISOString()
            .slice(0, 10));
    const result = await this.database.issueInvoice(job.id, invoice.id, {
      issuedBy,
      year: new Date().getUTCFullYear(),
      dueDate,
      totals: computeInvoiceTotals(invoice.lines, settings.taxLines),
    });
    if (result === "not_found") {
      throw new NotFoundException("Invoice was not found on this job");
    }
    if (result === "not_draft") {
      throw new ConflictException("This invoice is already issued or void");
    }
    if (result === "no_lines") {
      throw new BadRequestException("Add at least one line before issuing");
    }
    const invoiceNumber = result.invoiceNumber;
    if (invoiceNumber) {
      await this.notifications.notify({
        companyId: job.customerCompanyId,
        jobId: job.id,
        event: "invoice_issued",
        dedupeKey: `invoice-issued:${result.id}`,
        message: (sender) =>
          invoiceIssuedMessage(
            sender,
            invoiceNumber,
            result.totalMinor,
            result.currency,
            result.dueDate,
          ),
        linkPath: `/jobs/${job.id}`,
        createdBy: issuedBy,
      });
    }
    return this.view(result, [], true);
  }

  async voidInvoice(
    id: string,
    invoiceId: string,
    input: unknown,
    voidedBy: string,
    scope: JobScope,
  ): Promise<InvoiceView> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(invoiceReasonInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = isUuid(invoiceId)
      ? await this.database.voidInvoice(
          job.id,
          invoiceId,
          voidedBy,
          parsed.data.reason,
        )
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Invoice was not found on this job");
    }
    if (result === "already_void") {
      throw new ConflictException("This invoice is already void");
    }
    if (result === "has_payments") {
      throw new ConflictException(
        "Reverse the payments before voiding the invoice",
      );
    }
    return this.view(result, [], true);
  }

  /** Payments may arrive after a job is closed, so the job status is not checked. */
  async recordPayment(
    id: string,
    invoiceId: string,
    input: unknown,
    recordedBy: string,
    scope: JobScope,
  ): Promise<InvoicePaymentRecord> {
    const job = await this.jobs.get(id, scope);
    const parsed = parseContract(paymentInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    // One day of slack covers a client whose date is ahead of UTC.
    if (
      parsed.data.receivedOn >
      new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    ) {
      throw new BadRequestException("receivedOn cannot be in the future");
    }
    const result = isUuid(invoiceId)
      ? await this.database.recordInvoicePayment(
          job.id,
          invoiceId,
          parsed.data,
          recordedBy,
          new Date().getUTCFullYear(),
        )
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Invoice was not found on this job");
    }
    if (result === "not_issued") {
      throw new ConflictException(
        "Payments can only be recorded against an issued invoice",
      );
    }
    if (result === "exceeds_balance") {
      throw new ConflictException(
        "The payment is more than the outstanding balance",
      );
    }
    if (result === "document_invalid") {
      throw new BadRequestException(
        "evidenceDocumentId must be a document on this job",
      );
    }
    const invoice = await this.find(job.id, invoiceId);
    const standing = (await this.database.listInvoicePayments(job.id)).filter(
      (item) => item.invoiceId === invoice.id && item.reversal === null,
    );
    const paid = standing.reduce((sum, item) => sum + item.amountMinor, 0);
    const invoiceNumber = invoice.invoiceNumber ?? "";
    await this.notifications.notify({
      companyId: job.customerCompanyId,
      jobId: job.id,
      event: "payment_received",
      dedupeKey: `payment:${result.id}`,
      message: (sender) =>
        paymentReceivedMessage(
          sender,
          result.receiptNumber,
          invoiceNumber,
          result.amountMinor,
          invoice.totalMinor - paid,
          invoice.currency,
        ),
      linkPath: `/jobs/${job.id}`,
      createdBy: recordedBy,
    });
    return result;
  }

  /**
   * One payment from a customer applied across several of their invoices, all
   * or nothing. Each invoice gets its own payment and receipt; the customer
   * gets one message for the whole payment.
   */
  async recordPayments(
    input: unknown,
    recordedBy: string,
    scope: JobScope,
  ): Promise<{
    payments: InvoicePaymentRecord[];
    totalMinor: number;
    currency: string;
  }> {
    const parsed = parseContract(paymentBatchInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    // One day of slack covers a client whose date is ahead of UTC.
    if (
      parsed.data.receivedOn >
      new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    ) {
      throw new BadRequestException("receivedOn cannot be in the future");
    }
    const result = await this.database.recordPaymentBatch(
      parsed.data,
      recordedBy,
      new Date().getUTCFullYear(),
      scope,
    );
    if ("failed" in result) {
      switch (result.failed) {
        case "not_found":
          throw new NotFoundException("Invoice was not found");
        case "not_issued":
          throw new ConflictException(
            "Payments can only be recorded against an issued invoice",
          );
        case "mixed_customers":
          throw new BadRequestException(
            "All the invoices must belong to the same customer",
          );
        case "mixed_currencies":
          throw new BadRequestException(
            "All the invoices must be in the same currency",
          );
        case "exceeds_balance":
          throw new ConflictException(
            `The payment is more than the outstanding balance of ${result.invoiceNumber ?? "an invoice"}`,
          );
      }
    }
    const lines = result.recorded;
    const jobIds = new Set(lines.map((line) => line.jobId));
    const [only] = lines;
    await this.notifications.notify({
      companyId: result.companyId,
      jobId: jobIds.size === 1 ? only.jobId : null,
      event: "payment_received",
      dedupeKey: `payment:${only.payment.id}`,
      message: (sender) =>
        lines.length === 1
          ? paymentReceivedMessage(
              sender,
              only.payment.receiptNumber,
              only.invoiceNumber,
              only.payment.amountMinor,
              only.balanceMinor,
              result.currency,
            )
          : paymentsReceivedMessage(
              sender,
              result.currency,
              lines.map((line) => ({
                invoiceNumber: line.invoiceNumber,
                receiptNumber: line.payment.receiptNumber,
                amountMinor: line.payment.amountMinor,
                balanceMinor: line.balanceMinor,
              })),
            ),
      linkPath: jobIds.size === 1 ? `/jobs/${only.jobId}` : "/invoices",
      createdBy: recordedBy,
    });
    return {
      payments: lines.map((line) => line.payment),
      totalMinor: lines.reduce(
        (sum, line) => sum + line.payment.amountMinor,
        0,
      ),
      currency: result.currency,
    };
  }

  async reversePayment(
    id: string,
    invoiceId: string,
    paymentId: string,
    input: unknown,
    reversedBy: string,
    scope: JobScope,
  ): Promise<InvoicePaymentRecord> {
    const job = await this.jobs.get(id, scope);
    const parsed = parseContract(invoiceReasonInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result =
      isUuid(invoiceId) && isUuid(paymentId)
        ? await this.database.reverseInvoicePayment(
            job.id,
            invoiceId,
            paymentId,
            parsed.data.reason,
            reversedBy,
          )
        : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Payment was not found on this invoice");
    }
    if (result === "already_reversed") {
      throw new ConflictException("This payment is already reversed");
    }
    return result;
  }

  /**
   * Every issued invoice that still has a balance, oldest due date first, with
   * what is overdue and the totals per currency. Staff see their service
   * lines; a customer sees only their own company's.
   */
  /** Money per job and per currency: invoiced, received, owing, cost and margin. Never mixes currencies. */
  async financeSummary(scope: JobScope) {
    const rows = (await this.database.listJobFinance(scope)).map((row) => ({
      ...row,
      owingMinor: row.invoicedMinor - row.receivedMinor,
      // A margin needs both sides in the same currency; costs are recorded in GHS.
      marginMinor:
        row.invoicedMinor > 0 && row.costMinor > 0
          ? row.invoicedMinor - row.costMinor
          : null,
    }));
    const totals = new Map<
      string,
      {
        currency: string;
        invoicedMinor: number;
        receivedMinor: number;
        owingMinor: number;
        costMinor: number;
      }
    >();
    for (const row of rows) {
      const entry = totals.get(row.currency) ?? {
        currency: row.currency,
        invoicedMinor: 0,
        receivedMinor: 0,
        owingMinor: 0,
        costMinor: 0,
      };
      entry.invoicedMinor += row.invoicedMinor;
      entry.receivedMinor += row.receivedMinor;
      entry.owingMinor += row.owingMinor;
      entry.costMinor += row.costMinor;
      totals.set(row.currency, entry);
    }
    return {
      jobs: rows,
      totals: [...totals.values()],
      trend: await this.monthlyTrend(scope),
    };
  }

  /**
   * Invoiced (by the day issued) and received (by the day received; reversed
   * payments left out) for each of the last six calendar months, per currency
   * and customer. Ghana days are UTC. Only months with money appear in `rows`.
   */
  private async monthlyTrend(scope: JobScope) {
    const now = new Date();
    const months = [5, 4, 3, 2, 1, 0].map((back) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
        .toISOString()
        .slice(0, 7),
    );
    const from = `${months[0]}-01`;
    const to = now.toISOString().slice(0, 10);
    const [invoices, payments] = await Promise.all([
      this.database.listReportInvoices(from, to, scope),
      this.database.listReportPayments(from, to, scope),
    ]);
    const rows = new Map<
      string,
      {
        month: string;
        currency: string;
        customerCompanyName: string;
        invoicedMinor: number;
        receivedMinor: number;
      }
    >();
    const entry = (month: string, currency: string, name: string) => {
      const key = `${month}|${currency}|${name}`;
      const found = rows.get(key) ?? {
        month,
        currency,
        customerCompanyName: name,
        invoicedMinor: 0,
        receivedMinor: 0,
      };
      rows.set(key, found);
      return found;
    };
    for (const { customerCompanyName, invoice } of invoices) {
      if (!invoice.issuedAt) continue;
      entry(
        invoice.issuedAt.slice(0, 7),
        invoice.currency,
        customerCompanyName,
      ).invoicedMinor += invoice.totalMinor;
    }
    for (const row of payments) {
      if (row.payment.reversal) continue;
      entry(
        row.payment.receivedOn.slice(0, 7),
        row.currency,
        row.customerCompanyName,
      ).receivedMinor += row.payment.amountMinor;
    }
    return { months, rows: [...rows.values()] };
  }

  async outstanding(companyId: unknown, scope: JobScope) {
    if (companyId !== undefined && !isUuid(companyId)) {
      throw new BadRequestException("companyId must be a valid ID");
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = (
      await this.database.listOutstandingInvoices({
        companyId: (companyId as string | undefined) ?? null,
        scope,
      })
    ).map((row) => ({
      ...row,
      overdue: row.dueDate !== null && row.dueDate < today,
      daysOverdue:
        row.dueDate !== null && row.dueDate < today
          ? Math.floor(
              (Date.parse(today) - Date.parse(row.dueDate)) / 86_400_000,
            )
          : 0,
    }));
    const totals = new Map<
      string,
      { currency: string; outstandingMinor: number; overdueMinor: number }
    >();
    for (const row of rows) {
      const entry = totals.get(row.currency) ?? {
        currency: row.currency,
        outstandingMinor: 0,
        overdueMinor: 0,
      };
      entry.outstandingMinor += row.outstandingMinor;
      if (row.overdue) entry.overdueMinor += row.outstandingMinor;
      totals.set(row.currency, entry);
    }
    return { invoices: rows, totals: [...totals.values()] };
  }

  /** Customers reach only invoices that were issued, on their own company's jobs. */
  async pdf(
    id: string,
    invoiceId: string,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    const job = await this.jobs.get(id, scope);
    const invoice = await this.find(job.id, invoiceId);
    if (scope.companyIds !== undefined && invoice.issuedAt === null) {
      throw new NotFoundException("Invoice was not found on this job");
    }
    const [payments, settings] = await Promise.all([
      this.database.listInvoicePayments(job.id),
      this.database.getBusinessSettings(),
    ]);
    const view = this.view(
      invoice,
      payments.filter((payment) => payment.invoiceId === invoice.id),
      false,
    );
    const file = await renderInvoicePdf({
      invoice: view,
      job,
      settings: settings?.settings ?? null,
    });
    const base = (invoice.invoiceNumber ?? "invoice-draft").replace(
      /[^A-Za-z0-9-]+/g,
      "-",
    );
    return { file, filename: `${base}.pdf` };
  }

  /** A payment's receipt: staff hand it to the customer; it is not a bank confirmation. */
  async receiptPdf(
    id: string,
    invoiceId: string,
    paymentId: string,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    const job = await this.jobs.get(id, scope);
    const invoice = await this.find(job.id, invoiceId);
    const payments = await this.database.listInvoicePayments(job.id);
    const forInvoice = payments.filter((item) => item.invoiceId === invoice.id);
    const payment = isUuid(paymentId)
      ? forInvoice.find((item) => item.id === paymentId)
      : undefined;
    if (!payment?.receiptNumber) {
      throw new NotFoundException("Receipt was not found on this invoice");
    }
    const settings = await this.database.getBusinessSettings();
    const file = await renderReceiptPdf({
      payment,
      invoice: this.view(invoice, forInvoice, false),
      job,
      settings: settings?.settings ?? null,
    });
    return {
      file,
      filename: `${payment.receiptNumber.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`,
    };
  }

  /**
   * Every numbered receipt the caller may see, newest first. Customers get
   * their own companies' receipts, without staff-only evidence or recorder.
   */
  async receipts(scope: JobScope) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.database.listReportPayments(
      "2000-01-01",
      today,
      scope,
    );
    const isCustomer = scope.companyIds !== undefined;
    return rows
      .filter((row) => row.payment.receiptNumber !== null)
      .reverse()
      .map((row) => ({
        paymentId: row.payment.id,
        invoiceId: row.payment.invoiceId,
        jobId: row.jobId,
        fileNumber: row.fileNumber,
        customerCompanyName: row.customerCompanyName,
        invoiceNumber: row.invoiceNumber,
        receiptNumber: row.payment.receiptNumber,
        currency: row.currency,
        amountMinor: row.payment.amountMinor,
        receivedOn: row.payment.receivedOn,
        method: row.payment.method,
        reference: isCustomer ? null : row.payment.reference,
        reversed: row.payment.reversal !== null,
      }));
  }

  /** Queues the receipt, PDF attached, to the client's contacts; a resend is a new message. */
  async sendReceipt(
    id: string,
    invoiceId: string,
    paymentId: string,
    sentBy: string,
    scope: JobScope,
  ): Promise<{ queued: boolean }> {
    const job = await this.jobs.get(id, scope);
    const invoice = await this.find(job.id, invoiceId);
    const payment = isUuid(paymentId)
      ? (await this.database.listInvoicePayments(job.id)).find(
          (item) => item.id === paymentId && item.invoiceId === invoice.id,
        )
      : undefined;
    if (!payment?.receiptNumber || !invoice.invoiceNumber) {
      throw new NotFoundException("Receipt was not found on this invoice");
    }
    const receiptNumber = payment.receiptNumber;
    const invoiceNumber = invoice.invoiceNumber;
    const result = await this.notifications.notify({
      companyId: job.customerCompanyId,
      jobId: job.id,
      event: "receipt_sent",
      dedupeKey: `receipt-sent:${payment.id}:${Date.now()}`,
      message: (sender) =>
        receiptSentMessage(
          sender,
          receiptNumber,
          invoiceNumber,
          payment.amountMinor,
          invoice.currency,
        ),
      linkPath: `/jobs/${job.id}/money`,
      createdBy: sentBy,
    });
    if (!result || result === "duplicate") {
      throw new ConflictException("The receipt could not be queued");
    }
    if (result.deliveries.length === 0) {
      throw new ConflictException(
        "This customer has no contact to send the receipt to",
      );
    }
    return { queued: true };
  }

  private view(
    invoice: InvoiceRecord,
    payments: InvoicePaymentRecord[],
    includeLedger: boolean,
    acceptance?: InvoiceAcceptanceRecord,
  ): InvoiceView {
    return invoiceView(invoice, payments, includeLedger, acceptance);
  }

  private async find(jobId: string, invoiceId: string): Promise<InvoiceRecord> {
    const invoice = isUuid(invoiceId)
      ? (await this.database.listInvoices(jobId)).find(
          (item) => item.id === invoiceId,
        )
      : undefined;
    if (!invoice) {
      throw new NotFoundException("Invoice was not found on this job");
    }
    return invoice;
  }

  /** The current settings, after checking the currency is one of theirs. */
  private async requireConfiguredCurrency(currency: string) {
    const current = await this.database.getBusinessSettings();
    if (current && !current.settings.currencies.includes(currency)) {
      throw new BadRequestException(
        `currency must be one of the configured currencies: ${current.settings.currencies.join(", ")}`,
      );
    }
    return current?.settings ?? null;
  }

  private async editableJob(id: string, scope: JobScope): Promise<JobRecord> {
    const job = await this.jobs.get(id, scope);
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before changing it");
    }
    return job;
  }
}

/** An invoice with its balance worked out from the standing payments. */
export function invoiceView(
  invoice: InvoiceRecord,
  payments: InvoicePaymentRecord[],
  includeLedger: boolean,
  acceptance?: InvoiceAcceptanceRecord,
): InvoiceView {
  const paidMinor = payments
    .filter((payment) => payment.reversal === null)
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const open = invoice.status === "issued";
  const outstandingMinor = open ? invoice.totalMinor - paidMinor : 0;
  const paymentStatus =
    invoice.status !== "issued"
      ? invoice.status
      : paidMinor === 0
        ? "unpaid"
        : outstandingMinor === 0
          ? "paid"
          : "partial";
  return {
    ...invoice,
    paidMinor,
    outstandingMinor,
    paymentStatus,
    ...(includeLedger ? { payments } : {}),
    acceptance: acceptance ?? null,
  };
}
