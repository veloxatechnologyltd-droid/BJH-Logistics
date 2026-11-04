import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  jobReportQuerySchema,
  milestoneTemplates,
  parseContract,
  serviceLineKeys,
} from "@bjh/contracts";
import type { JobReportQuery, ServiceLine } from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type {
  JobListRecord,
  JobScope,
  MilestoneEventRecord,
  ShipmentReferenceRecord,
} from "../database/database.port";
import { renderClientJobReportPdf } from "./client-job-report-pdf";

/** At most this many jobs go into one report; a longer list must be narrowed. */
const MAX_JOBS = 100;

/** Billing facts are not shipment progress, so they never stand in for the status. */
const billingMilestoneKeys = new Set([
  "customer_invoice_issued",
  "customer_payment_recorded",
]);

const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  ready_to_close: "Ready to close",
  closed: "Closed",
};

export interface ClientJobReportRow {
  jobId: string;
  fileNumber: string;
  customer: string;
  /** House and master B/L or AWB numbers, house first. */
  billNumbers: string[];
  goods: string | null;
  /** The vessel, or the flight for an air job. */
  vessel: string | null;
  /** YYYY-MM-DD, Ghana time. */
  eta: string | null;
  portOfDischarge: string | null;
  /** The remark staff wrote, else the latest step recorded, else the job's status. */
  status: string;
  /** Expected finish for an open job; the day it closed for a completed one. */
  completionDate: string | null;
}

export interface ClientJobReportView {
  company: { id: string; name: string };
  /** YYYY-MM-DD. */
  generatedOn: string;
  /** Jobs still being worked, one section per service with any. */
  sections: Array<{
    serviceLine: ServiceLine;
    rows: ClientJobReportRow[];
  }>;
  /** Jobs that are done, newest first. */
  completed: ClientJobReportRow[];
}

const accraDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(
    new Date(iso),
  );

const billKinds = ["house_bl", "house_awb", "master_bl", "master_awb"] as const;

function billNumbers(references: ShipmentReferenceRecord[]): string[] {
  const numbers: string[] = [];
  for (const kind of billKinds) {
    for (const reference of references) {
      if (reference.kind === kind && !numbers.includes(reference.value)) {
        numbers.push(reference.value);
      }
    }
  }
  return numbers;
}

/** The step with the latest date among those staff recorded, ignoring billing. */
function latestStepLabel(
  job: JobListRecord,
  events: MilestoneEventRecord[],
): string | null {
  const labels = new Map<string, string>(
    milestoneTemplates[job.serviceLine].map((step) => [step.key, step.label]),
  );
  const latest = new Map<string, MilestoneEventRecord>();
  for (const event of [...events].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  )) {
    latest.set(event.milestoneKey, event);
  }
  const last = [...latest.values()]
    .filter(
      (event) =>
        labels.has(event.milestoneKey) &&
        !billingMilestoneKeys.has(event.milestoneKey),
    )
    .sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) ||
        b.recordedAt.localeCompare(a.recordedAt),
    )[0];
  return last ? (labels.get(last.milestoneKey) ?? null) : null;
}

/**
 * A customer's jobs as a one-line-per-job status update to share with the
 * client (client sample, 2026-11-04): where each job stands, with no money.
 * Open to any staff member who can see the jobs, within their own service
 * lines.
 */
@Injectable()
export class ClientJobReportService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  report(query: unknown, scope: JobScope): Promise<ClientJobReportView> {
    return this.build(this.parse(query), scope);
  }

  async pdf(
    query: unknown,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    const report = await this.build(this.parse(query), scope);
    const settings = await this.database.getBusinessSettings();
    const file = await renderClientJobReportPdf({
      report,
      settings: settings?.settings ?? null,
    });
    const name = report.company.name
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    return {
      file,
      filename: `Client-job-report-${name}-${report.generatedOn}.pdf`,
    };
  }

  private parse(query: unknown): JobReportQuery {
    const parsed = parseContract(jobReportQuerySchema, query);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    return parsed.data;
  }

  private async build(
    query: JobReportQuery,
    scope: JobScope,
  ): Promise<ClientJobReportView> {
    const { companyId, jobIds, from, to } = query;
    const company = await this.database.findCustomer(companyId);
    if (!company) throw new NotFoundException("Customer was not found");

    const listed = await this.database.listJobs("", scope, {
      customerCompanyId: companyId,
      openedFrom: from ?? undefined,
      openedTo: to ?? undefined,
    });
    const wanted = jobIds ? new Set(jobIds) : null;
    const listedChosen = listed.filter((job) => !wanted || wanted.has(job.id));
    if (wanted && listedChosen.length !== wanted.size) {
      throw new NotFoundException(
        "A chosen job was not found for this customer",
      );
    }
    // A cancelled job is not an update the client needs.
    const chosen = listedChosen.filter((job) => job.status !== "cancelled");
    if (chosen.length > MAX_JOBS) {
      throw new BadRequestException(
        `A report covers at most ${MAX_JOBS} jobs: choose the jobs or a date range`,
      );
    }

    const rows = await Promise.all(
      chosen.map(async (job) => {
        const [references, events] = await Promise.all([
          this.database.listShipmentReferences(job.id),
          this.database.listMilestoneEvents(job.id),
        ]);
        const done = job.status === "closed";
        const row: ClientJobReportRow = {
          jobId: job.id,
          fileNumber: job.fileNumber,
          customer: job.customerCompanyName,
          billNumbers: billNumbers(references),
          goods: job.goodsDescription,
          vessel: job.vessel,
          eta: job.currentEtaAt ? accraDay(job.currentEtaAt) : null,
          portOfDischarge: job.portOfDischarge,
          status:
            job.remarks ??
            latestStepLabel(job, events) ??
            statusLabels[job.status] ??
            job.status,
          completionDate: done
            ? job.closedAt
              ? accraDay(job.closedAt)
              : null
            : job.expectedCompletionDate,
        };
        return { job, row };
      }),
    );

    const byEtaThenNumber = (
      a: { row: ClientJobReportRow },
      b: { row: ClientJobReportRow },
    ) =>
      (a.row.eta ?? "9999-12-31").localeCompare(b.row.eta ?? "9999-12-31") ||
      a.row.fileNumber.localeCompare(b.row.fileNumber);
    const open = rows.filter(({ job }) => job.status !== "closed");
    return {
      company: { id: company.id, name: company.companyName },
      generatedOn: new Date().toISOString().slice(0, 10),
      sections: serviceLineKeys
        .map((serviceLine) => ({
          serviceLine,
          rows: open
            .filter(({ job }) => job.serviceLine === serviceLine)
            .sort(byEtaThenNumber)
            .map(({ row }) => row),
        }))
        .filter((section) => section.rows.length > 0),
      completed: rows
        .filter(({ job }) => job.status === "closed")
        .sort(
          (a, b) =>
            (b.row.completionDate ?? "").localeCompare(
              a.row.completionDate ?? "",
            ) || a.row.fileNumber.localeCompare(b.row.fileNumber),
        )
        .map(({ row }) => row),
    };
  }
}
