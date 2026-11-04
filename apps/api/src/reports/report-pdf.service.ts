import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isUuid,
  milestoneTemplates,
  serviceLineKeys,
  type ServiceLine,
} from "@bjh/contracts";
import { financeRoles } from "../auth/auth.guards";
import {
  DatabasePort,
  JobScope,
  StaffRoleKey,
} from "../database/database.port";
import {
  deliveriesDocument,
  delaysTasksDocument,
  financeReportTypes,
  invoicesPaymentsDocument,
  jobActivityDocument,
  jobMarginDocument,
  quotesRequestsDocument,
  receivablesDocument,
  reportTypes,
  salesPipelineDocument,
  shipmentStatusDocument,
  warehouseInventoryDocument,
  type ReportType,
  type ShipmentStatusRow,
} from "./report-documents";
import { renderReportPdf, type ReportDocument } from "./report-pdf";

/** A shipment update lists this many open jobs, and this many completed ones, at most. */
const SHIPMENT_STATUS_LIMIT = 150;
const SHIPMENT_COMPLETED_LIMIT = 100;

/** Billing facts are not shipment progress, so they never stand in for the last step. */
const billingMilestoneKeys = new Set([
  "customer_invoice_issued",
  "customer_payment_recorded",
]);
/** House numbers come before master numbers on an update. */
const billKinds = ["house_bl", "house_awb", "master_bl", "master_awb"];

const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

/**
 * Downloadable PDF reports for a chosen period. Everything is read through the
 * caller's own scope (service lines), and the three money reports are for
 * finance roles only, like the figures on the Reports page.
 */
@Injectable()
export class ReportPdfService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  async pdf(
    query: unknown,
    scope: JobScope,
    roles: StaffRoleKey[],
  ): Promise<{ file: Buffer; filename: string }> {
    const { document, filename, today } = await this.document(
      query,
      scope,
      roles,
    );
    const settings = await this.database.getBusinessSettings();
    const file = await renderReportPdf({
      document,
      settings: settings?.settings ?? null,
      generatedOn: today,
    });
    return { file, filename };
  }

  /** What a report says, checked against the caller's role and scope, before it is drawn. */
  async document(
    query: unknown,
    scope: JobScope,
    roles: StaffRoleKey[],
  ): Promise<{ document: ReportDocument; filename: string; today: string }> {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      throw new BadRequestException("type, from and to are required");
    }
    const { type, from, to, serviceLine, companyId } = query as Record<
      string,
      unknown
    >;
    if (!(reportTypes as readonly unknown[]).includes(type)) {
      throw new BadRequestException(
        `type must be one of ${reportTypes.join(", ")}`,
      );
    }
    if (!isDate(from) || !isDate(to)) {
      throw new BadRequestException("from and to must be dates (YYYY-MM-DD)");
    }
    if (from > to) {
      throw new BadRequestException("from must be on or before to");
    }
    if (
      serviceLine !== undefined &&
      !(serviceLineKeys as readonly unknown[]).includes(serviceLine)
    ) {
      throw new BadRequestException(
        `serviceLine must be one of ${serviceLineKeys.join(", ")}`,
      );
    }
    const reportType = type as ReportType;
    if (
      financeReportTypes.includes(reportType) &&
      !roles.some((role) => financeRoles.includes(role))
    ) {
      throw new ForbiddenException("This report is for finance staff");
    }

    // Only the shipment update can be made for one customer; other reports ignore it.
    let customer: { id: string; name: string } | null = null;
    if (reportType === "shipment-status" && companyId !== undefined) {
      if (!isUuid(companyId)) {
        throw new BadRequestException("companyId must be a valid ID");
      }
      const found = await this.database.findCustomer(companyId);
      if (!found) throw new NotFoundException("Customer was not found");
      customer = { id: found.id, name: found.companyName };
    }

    const today = new Date().toISOString().slice(0, 10);
    const document = await this.build(
      reportType,
      from,
      to,
      today,
      scope,
      serviceLine as ServiceLine | undefined,
      customer,
    );
    const nameTag = customer
      ? `-${customer.name
          .replace(/[^A-Za-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50)}`
      : "";
    return {
      document,
      filename: `BJH-${reportType}${nameTag}-${from}-to-${to}.pdf`,
      today,
    };
  }

  private async build(
    type: ReportType,
    from: string,
    to: string,
    today: string,
    scope: JobScope,
    serviceLine: ServiceLine | undefined,
    customer: { id: string; name: string } | null,
  ): Promise<ReportDocument> {
    switch (type) {
      case "sales-pipeline": {
        const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10);
        const [service, conversions, leads] = await Promise.all([
          this.database.reportSalesAndService(from, to),
          this.database.salesPeriod(from, nextDay),
          this.database.listLeads(),
        ]);
        return salesPipelineDocument({
          from,
          to,
          today,
          sales: {
            newLeads: service.newLeads,
            leadsBySource: service.leadsBySource,
            pipeline: service.pipeline,
            converted: conversions.converted,
            convertedCompanies: conversions.convertedCompanies,
          },
          leads,
        });
      }
      case "quotes-requests":
        return quotesRequestsDocument({
          from,
          to,
          service: await this.database.reportSalesAndService(from, to),
        });
      case "shipment-status":
        return this.shipmentStatus(
          from,
          to,
          today,
          scope,
          serviceLine ?? null,
          customer,
        );
      case "job-activity":
        return jobActivityDocument({
          from,
          to,
          jobs: await this.database.listJobs("", scope),
        });
      case "delays-tasks": {
        const [tasks, jobs] = await Promise.all([
          this.database.listJobTasks({ open: true }, scope),
          this.database.listJobs("", scope, { statuses: ["on_hold"] }),
        ]);
        return delaysTasksDocument({ today, tasks, jobs });
      }
      case "deliveries":
        return deliveriesDocument({
          from,
          to,
          today,
          deliveries: await this.database.listReportDeliveries(from, to, scope),
        });
      case "warehouse-inventory": {
        const [balances, movements] = await Promise.all([
          this.database.listStockBalances({
            asOf: to,
            jobId: null,
            companyId: null,
            scope,
          }),
          this.database.listReportStockMovements(from, to, scope),
        ]);
        return warehouseInventoryDocument({ from, to, balances, movements });
      }
      case "invoices-payments": {
        const [invoices, payments] = await Promise.all([
          this.database.listReportInvoices(from, to, scope),
          this.database.listReportPayments(from, to, scope),
        ]);
        return invoicesPaymentsDocument({ from, to, invoices, payments });
      }
      case "receivables-ageing":
        return receivablesDocument({
          today,
          outstanding: await this.database.listOutstandingInvoices({
            companyId: null,
            scope,
          }),
        });
      case "job-margin": {
        const [finance, jobs] = await Promise.all([
          this.database.listJobFinance(scope),
          this.database.listJobs("", scope),
        ]);
        return jobMarginDocument({ from, to, finance, jobs });
      }
    }
  }

  /**
   * Open jobs now, each with its bill numbers and where it has got to, and the
   * jobs completed in the period; for one customer when `customer` is set.
   */
  private async shipmentStatus(
    from: string,
    to: string,
    today: string,
    scope: JobScope,
    serviceLine: ServiceLine | null,
    customer: { id: string; name: string } | null,
  ): Promise<ReportDocument> {
    const narrow = {
      serviceLines: serviceLine ? [serviceLine] : undefined,
      customerCompanyId: customer?.id,
    };
    const [open, closed] = await Promise.all([
      this.database.listJobs("", scope, {
        ...narrow,
        statuses: ["open", "in_progress", "on_hold", "ready_to_close"],
      }),
      this.database.listJobs("", scope, {
        ...narrow,
        statuses: ["closed"],
        closedSince: from,
      }),
    ]);
    const completedAll = closed.filter(
      (job) =>
        job.closedAt !== null &&
        job.closedAt.slice(0, 10) >= from &&
        job.closedAt.slice(0, 10) <= to,
    );
    const shownOpen = [...open]
      .sort(
        (a, b) =>
          (a.currentEtaAt ?? "9999").localeCompare(b.currentEtaAt ?? "9999") ||
          a.fileNumber.localeCompare(b.fileNumber),
      )
      .slice(0, SHIPMENT_STATUS_LIMIT);
    const shownCompleted = [...completedAll]
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
      .slice(0, SHIPMENT_COMPLETED_LIMIT);

    const billNumbers = async (jobId: string) => {
      const references = await this.database.listShipmentReferences(jobId);
      return billKinds.flatMap((kind) =>
        references
          .filter((reference) => reference.kind === kind)
          .map((reference) => reference.value),
      );
    };
    const [openRows, completedRows] = await Promise.all([
      Promise.all(
        shownOpen.map(async (job): Promise<ShipmentStatusRow> => {
          const [bills, events] = await Promise.all([
            billNumbers(job.id),
            this.database.listMilestoneEvents(job.id),
          ]);
          const latest = new Map<string, string>();
          for (const event of [...events].sort((a, b) =>
            a.recordedAt.localeCompare(b.recordedAt),
          )) {
            latest.set(event.milestoneKey, event.occurredAt);
          }
          const last = milestoneTemplates[job.serviceLine]
            .filter(
              (step) =>
                latest.has(step.key) && !billingMilestoneKeys.has(step.key),
            )
            .at(-1);
          return {
            job,
            billNumbers: bills,
            lastStep: last
              ? { label: last.label, at: latest.get(last.key)! }
              : null,
          };
        }),
      ),
      Promise.all(
        shownCompleted.map(async (job): Promise<ShipmentStatusRow> => ({
          job,
          billNumbers: await billNumbers(job.id),
          lastStep: null,
        })),
      ),
    ]);
    return shipmentStatusDocument({
      from,
      to,
      today,
      serviceLine,
      customerName: customer?.name ?? null,
      open: openRows,
      totalOpen: open.length,
      completed: completedRows,
      totalCompleted: completedAll.length,
    });
  }
}
