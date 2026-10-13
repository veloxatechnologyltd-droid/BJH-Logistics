import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  deliveryMilestoneKeys,
  isUuid,
  jobCreateInputSchema,
  jobStatusChangeInputSchema,
  jobStatusReasonRequired,
  jobStatusTransitions,
  milestoneEventInputSchema,
  milestoneTemplates,
  parseContract,
} from "@bjh/contracts";
import type { MilestoneDefinition } from "@bjh/contracts";
import { serviceLinesForRoles } from "../auth/auth.guards";
import { milestoneMessage } from "../notifications/notification-messages";
import { NotificationsService } from "../notifications/notifications.service";
import {
  DatabasePort,
  JobRecord,
  JobScope,
  MilestoneEventRecord,
  StaffRoleKey,
} from "../database/database.port";

@Injectable()
export class JobsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  /** Any active staff role may open a job; reps only for their own service line. */
  async create(
    input: unknown,
    openedBy: string,
    roles: StaffRoleKey[],
  ): Promise<JobRecord> {
    const parsed = parseContract(jobCreateInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { customerCompanyId, serviceLine, quoteRequestId } = parsed.data;

    if (
      !roles.includes("super_admin") &&
      !serviceLinesForRoles(roles).includes(serviceLine)
    ) {
      throw new ForbiddenException(
        "You can only open jobs for your own service line",
      );
    }
    if (!(await this.database.findCustomer(customerCompanyId))) {
      throw new NotFoundException("Customer company was not found");
    }
    if (quoteRequestId) {
      const quoteRequest = await this.database.findQuoteRequest(quoteRequestId);
      if (!quoteRequest) {
        throw new NotFoundException("Quote request was not found");
      }
      if (quoteRequest.customerCompanyId !== customerCompanyId) {
        throw new BadRequestException(
          "quoteRequestId must belong to the same customer company",
        );
      }
    }

    return this.database.createJob(
      { customerCompanyId, serviceLine, quoteRequestId },
      openedBy,
      new Date().getUTCFullYear(),
    );
  }

  list(search: unknown, scope: JobScope): Promise<JobRecord[]> {
    if (search !== undefined && typeof search !== "string") {
      throw new BadRequestException("search must be a string");
    }
    const term = (search ?? "").trim();
    if (term.length > 200) {
      throw new BadRequestException("search must be at most 200 characters");
    }
    return this.database.listJobs(term, scope);
  }

  async get(id: string, scope: JobScope): Promise<JobRecord> {
    const job = isUuid(id) ? await this.database.findJob(id, scope) : null;
    if (!job) throw new NotFoundException("Job was not found");
    return job;
  }

  /** Manual updates plus current invoice and payment facts for the job. */
  async getTimeline(id: string, scope: JobScope) {
    const job = await this.get(id, scope);
    const template = milestoneTemplates[job.serviceLine];
    const events = await this.database.listMilestoneEvents(job.id);
    if (template.some((item) => item.key === "customer_invoice_issued")) {
      const [invoices, payments] = await Promise.all([
        this.database.listInvoices(job.id),
        this.database.listInvoicePayments(job.id),
      ]);
      const issued = invoices.filter(
        (invoice) => invoice.status === "issued" && invoice.issuedAt,
      );
      const invoice = issued.sort((a, b) =>
        (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""),
      )[0];
      if (invoice?.issuedAt) {
        events.push({
          id: `invoice:${invoice.id}`,
          jobId: job.id,
          milestoneKey: "customer_invoice_issued",
          occurredAt: invoice.issuedAt,
          recordedAt: invoice.issuedAt,
          recordedBy: invoice.issuedBy ?? invoice.createdBy,
          source: "system",
          note: invoice.invoiceNumber,
          correctionOf: null,
        });
      }
      if (template.some((item) => item.key === "customer_payment_recorded")) {
        const issuedIds = new Set(issued.map((item) => item.id));
        const payment = payments
          .filter((item) => issuedIds.has(item.invoiceId) && !item.reversal)
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
        if (payment) {
          events.push({
            id: `payment:${payment.id}`,
            jobId: job.id,
            milestoneKey: "customer_payment_recorded",
            occurredAt: payment.recordedAt,
            recordedAt: payment.recordedAt,
            recordedBy: payment.recordedBy,
            source: "system",
            note: null,
            correctionOf: null,
          });
        }
      }
    }
    events.push(...(await this.waybillEvents(job.id, template)));
    return {
      job,
      template,
      events: events.sort(
        (a, b) =>
          a.occurredAt.localeCompare(b.occurredAt) ||
          a.recordedAt.localeCompare(b.recordedAt),
      ),
    };
  }

  /** Steps 'dispatched' and 'delivered' as the job's latest waybill records them. */
  private async waybillEvents(
    jobId: string,
    template: readonly MilestoneDefinition[],
  ): Promise<MilestoneEventRecord[]> {
    const has = (key: string) => template.some((item) => item.key === key);
    const deliveries = await this.database.listDeliveries(jobId);
    const events: MilestoneEventRecord[] = [];
    const dispatched = deliveries
      .slice()
      .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt))[0];
    if (dispatched && has(deliveryMilestoneKeys.dispatched)) {
      events.push({
        id: `waybill:${dispatched.id}`,
        jobId,
        milestoneKey: deliveryMilestoneKeys.dispatched,
        occurredAt: dispatched.dispatchedAt,
        recordedAt: dispatched.dispatchedAt,
        recordedBy: dispatched.dispatchedBy,
        source: "system",
        note: dispatched.waybillNumber,
        correctionOf: null,
      });
    }
    const delivered = deliveries
      .filter((item) => item.deliveredAt && item.podRecordedAt)
      .sort((a, b) =>
        (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""),
      )[0];
    if (delivered?.deliveredAt && has(deliveryMilestoneKeys.delivered)) {
      events.push({
        id: `pod:${delivered.id}`,
        jobId,
        milestoneKey: deliveryMilestoneKeys.delivered,
        occurredAt: delivered.deliveredAt,
        recordedAt: delivered.podRecordedAt ?? delivered.deliveredAt,
        recordedBy: delivered.podRecordedBy ?? delivered.dispatchedBy,
        source: "system",
        note: `${delivered.waybillNumber}, received by ${delivered.receiverName ?? "consignee"}`,
        correctionOf: null,
      });
    }
    return events;
  }

  /** True when the job's waybill already told the customer about this step. */
  private async waybillAnnounced(
    jobId: string,
    milestoneKey: string,
  ): Promise<boolean> {
    if (milestoneKey === deliveryMilestoneKeys.dispatched) {
      return (await this.database.listDeliveries(jobId)).length > 0;
    }
    if (milestoneKey === deliveryMilestoneKeys.delivered) {
      return (await this.database.listDeliveries(jobId)).some(
        (item) => item.deliveredAt !== null,
      );
    }
    return false;
  }

  /** Append-only: corrections are new events pointing at the original. */
  async recordMilestone(
    id: string,
    input: unknown,
    recordedBy: string,
    scope: JobScope,
  ): Promise<MilestoneEventRecord> {
    const job = await this.get(id, scope);
    const parsed = parseContract(milestoneEventInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { milestoneKey, note, correctionOf } = parsed.data;

    const template = milestoneTemplates[job.serviceLine];
    if (!template.some((milestone) => milestone.key === milestoneKey)) {
      throw new BadRequestException(
        "milestoneKey is not part of this service line's milestones",
      );
    }
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before recording milestones");
    }
    const now = Date.now();
    const occurredAt = parsed.data.occurredAt ?? new Date(now).toISOString();
    if (Date.parse(occurredAt) > now + 5 * 60_000) {
      throw new BadRequestException("occurredAt cannot be in the future");
    }

    const event = await this.database.appendMilestoneEvent({
      jobId: job.id,
      milestoneKey,
      occurredAt,
      recordedBy,
      note,
      correctionOf,
    });
    if (event === "correction_target_not_found") {
      throw new NotFoundException(
        "The event being corrected was not found on this job",
      );
    }
    // A correction restates an earlier event, so only a new event is announced.
    // Only key steps message the customer, and a step the waybill already
    // announced (dispatched, delivered) is not announced a second time.
    const customerMessage = template.find(
      (milestone) => milestone.key === milestoneKey,
    )?.customerMessage;
    if (
      !correctionOf &&
      customerMessage &&
      !(await this.waybillAnnounced(job.id, milestoneKey))
    ) {
      await this.notifications.notify({
        companyId: job.customerCompanyId,
        jobId: job.id,
        event: "milestone",
        dedupeKey: `milestone:${event.id}`,
        message: (sender) =>
          milestoneMessage(sender, job.fileNumber, customerMessage),
        linkPath: `/jobs/${job.id}`,
        createdBy: recordedBy,
      });
    }
    return event;
  }

  async getStatusHistory(id: string, scope: JobScope) {
    const job = await this.get(id, scope);
    return {
      job,
      allowedNext: jobStatusTransitions[job.status],
      history: await this.database.listJobStatusHistory(job.id),
    };
  }

  /**
   * Moves a job along the status workflow. Anyone with access to the job's
   * department may do it, including reopening and closure overrides, and
   * those actions need a written reason. Every change is kept in history.
   */
  async changeStatus(
    id: string,
    input: unknown,
    changedBy: string,
    scope: JobScope,
  ): Promise<JobRecord> {
    const job = await this.get(id, scope);
    const parsed = parseContract(jobStatusChangeInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { status, reason } = parsed.data;

    if (!jobStatusTransitions[job.status].includes(status)) {
      throw new ConflictException(
        `A job that is ${job.status} cannot move to ${status}`,
      );
    }
    if (jobStatusReasonRequired(job.status, status) && !reason) {
      throw new BadRequestException(
        "reason is required to cancel, reopen or override closure",
      );
    }
    const result = await this.database.changeJobStatus({
      jobId: job.id,
      from: job.status,
      to: status,
      reason,
      changedBy,
    });
    if (result === "status_changed") {
      throw new ConflictException(
        "The job status changed while you were editing; reload and try again",
      );
    }
    return result;
  }
}
