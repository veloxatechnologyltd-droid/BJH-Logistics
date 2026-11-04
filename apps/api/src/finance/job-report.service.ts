import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  jobReportQuerySchema,
  milestoneTemplates,
  parseContract,
  type JobReportQuery,
} from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type { JobRecord, JobScope } from "../database/database.port";
import { renderJobReportPdf } from "./job-report-pdf";
import { NotificationsService } from "../notifications/notifications.service";
import { jobReportSentMessage } from "../notifications/notification-messages";

export interface JobReportInvoice {
  invoiceNumber: string;
  issuedOn: string;
  dueDate: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
}

export interface JobReportJob {
  job: JobRecord;
  /** The latest expected arrival, when one is recorded. */
  etaAt: string | null;
  parties: Array<{ role: string; name: string }>;
  references: Array<{ kind: string; value: string }>;
  /** The job's steps in order, each with when it happened (null: not yet). */
  milestones: Array<{ label: string; occurredAt: string | null }>;
  deliveries: Array<{
    waybillNumber: string;
    dispatchedAt: string;
    deliveryAddress: string;
    status: "dispatched" | "delivered";
    deliveredAt: string | null;
    receiverName: string | null;
  }>;
  /** Issued invoices only; drafts and void ones are left out. */
  invoices: JobReportInvoice[];
}

export interface JobReportView {
  company: { id: string; name: string; customerNumber: string | null };
  from: string | null;
  to: string | null;
  generatedOn: string;
  jobs: JobReportJob[];
  /** Per currency, across the jobs in the report. */
  totals: Array<{
    currency: string;
    invoicedMinor: number;
    paidMinor: number;
    outstandingMinor: number;
  }>;
  /** Credit on the customer's account, per currency, not yet applied. */
  credit: Array<{ currency: string; availableMinor: number }>;
}

/**
 * A customer's job report (client walkthrough, 2026-11-03): each of their jobs
 * in detail, with its invoices and what is paid and owed, to download and
 * share with the client. Finance roles only, like statements.
 */
@Injectable()
export class JobReportService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  report(query: unknown, scope: JobScope): Promise<JobReportView> {
    return this.build(this.parse(query), scope);
  }

  private parse(query: unknown): JobReportQuery {
    const parsed = parseContract(jobReportQuerySchema, query);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    return parsed.data;
  }

  private async build(
    query: JobReportQuery,
    scope: JobScope,
  ): Promise<JobReportView> {
    const { companyId, jobIds, from, to } = query;
    const company = await this.database.findCustomer(companyId);
    if (!company) throw new NotFoundException("Customer was not found");

    const listed = await this.database.listJobs("", scope, {
      customerCompanyId: companyId,
      openedFrom: from ?? undefined,
      openedTo: to ?? undefined,
    });
    const wanted = jobIds ? new Set(jobIds) : null;
    const chosen = listed
      .filter((job) => !wanted || wanted.has(job.id))
      .sort(
        (a, b) =>
          a.openedAt.localeCompare(b.openedAt) ||
          a.fileNumber.localeCompare(b.fileNumber),
      )
      .slice(0, 100);
    if (wanted && chosen.length !== wanted.size) {
      throw new NotFoundException(
        "A chosen job was not found for this customer",
      );
    }

    const jobs = await Promise.all(chosen.map((job) => this.jobDetail(job)));
    const totals = new Map<
      string,
      { invoicedMinor: number; paidMinor: number; outstandingMinor: number }
    >();
    for (const invoice of jobs.flatMap((item) => item.invoices)) {
      const sum = totals.get(invoice.currency) ?? {
        invoicedMinor: 0,
        paidMinor: 0,
        outstandingMinor: 0,
      };
      sum.invoicedMinor += invoice.totalMinor;
      sum.paidMinor += invoice.paidMinor;
      sum.outstandingMinor += invoice.outstandingMinor;
      totals.set(invoice.currency, sum);
    }
    const credit = new Map<string, number>();
    for (const item of await this.database.listCustomerCredits(
      companyId,
      scope,
    )) {
      if (item.availableMinor > 0) {
        credit.set(
          item.currency,
          (credit.get(item.currency) ?? 0) + item.availableMinor,
        );
      }
    }
    return {
      company: {
        id: company.id,
        name: company.companyName,
        customerNumber: company.customerNumber ?? null,
      },
      from,
      to,
      generatedOn: new Date().toISOString().slice(0, 10),
      jobs,
      totals: [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, sum]) => ({ currency, ...sum })),
      credit: [...credit]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, availableMinor]) => ({ currency, availableMinor })),
    };
  }

  pdf(
    query: unknown,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    return this.pdfOf(this.parse(query), scope);
  }

  /** The PDF for a report already checked, as the dispatcher attaches it. */
  async pdfOf(
    query: JobReportQuery,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    const report = await this.build(query, scope);
    const settings = await this.database.getBusinessSettings();
    const file = await renderJobReportPdf({
      report,
      settings: settings?.settings ?? null,
    });
    const name = report.company.name
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    return { file, filename: `Job-report-${name}-${report.generatedOn}.pdf` };
  }

  /**
   * Emails the report to the customer's contacts. The PDF is built when the
   * email goes out, from the same jobs and dates.
   */
  async send(
    query: unknown,
    sentBy: string,
    scope: JobScope,
  ): Promise<{ queued: boolean }> {
    const parsed = this.parse(query);
    const report = await this.build(parsed, scope);
    if (report.jobs.length === 0) {
      throw new BadRequestException("No jobs match this report");
    }
    const result = await this.notifications.notify({
      companyId: report.company.id,
      event: "job_report_sent",
      dedupeKey: `job-report:${report.company.id}:${Date.now()}`,
      message: (sender) =>
        jobReportSentMessage(sender, report.company.name, report.jobs.length),
      jobReportQuery: parsed,
      createdBy: sentBy,
    });
    if (!result || result === "duplicate") {
      throw new ConflictException("The job report could not be queued");
    }
    if (result.deliveries.length === 0) {
      throw new ConflictException(
        "This customer has no contact to send the job report to",
      );
    }
    return { queued: true };
  }

  private async jobDetail(job: JobRecord): Promise<JobReportJob> {
    const [parties, references, events, etas, deliveries, invoices, payments] =
      await Promise.all([
        this.database.listJobParties(job.id),
        this.database.listShipmentReferences(job.id),
        this.database.listMilestoneEvents(job.id),
        this.database.listEtaEvents(job.id),
        this.database.listDeliveries(job.id),
        this.database.listInvoices(job.id),
        this.database.listInvoicePayments(job.id),
      ]);
    const latest = new Map<string, string>();
    for (const event of [...events].sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    )) {
      latest.set(event.milestoneKey, event.occurredAt);
    }
    const eta = [...etas].sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    )[0];
    const paidOf = (invoiceId: string) =>
      payments
        .filter(
          (payment) => payment.invoiceId === invoiceId && !payment.reversal,
        )
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
    return {
      job,
      etaAt: eta?.etaAt ?? null,
      parties: parties.map((party) => ({ role: party.role, name: party.name })),
      references: references.map((reference) => ({
        kind: reference.kind,
        value: reference.value,
      })),
      milestones: milestoneTemplates[job.serviceLine].map((step) => ({
        label: step.label,
        occurredAt: latest.get(step.key) ?? null,
      })),
      deliveries: deliveries.map((delivery) => ({
        waybillNumber: delivery.waybillNumber,
        dispatchedAt: delivery.dispatchedAt,
        deliveryAddress: delivery.deliveryAddress,
        status: delivery.status,
        deliveredAt: delivery.deliveredAt,
        receiverName: delivery.receiverName,
      })),
      invoices: invoices
        .filter((invoice) => invoice.status === "issued")
        .map((invoice) => {
          const paid = paidOf(invoice.id);
          return {
            invoiceNumber: invoice.invoiceNumber ?? "",
            issuedOn: (invoice.issuedAt ?? invoice.createdAt).slice(0, 10),
            dueDate: invoice.dueDate,
            currency: invoice.currency,
            totalMinor: invoice.totalMinor,
            paidMinor: paid,
            outstandingMinor: Math.max(invoice.totalMinor - paid, 0),
          };
        }),
    };
  }
}
