import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  etaInputSchema,
  isUuid,
  jobPartyInputSchema,
  jobTaskInputSchema,
  parseContract,
  referenceKindAllowedFor,
  shipmentReferenceInputSchema,
  staffRoleKeys,
  taskCompletionSchema,
} from "@bjh/contracts";
import type { StaffRoleKey } from "@bjh/contracts";
import {
  DatabasePort,
  EtaEventRecord,
  JobPartyRecord,
  JobTaskRecord,
  JobRecord,
  JobScope,
  ShipmentReferenceRecord,
} from "../database/database.port";
import { etaMessage } from "../notifications/notification-messages";
import { NotificationsService } from "../notifications/notifications.service";
import { isValidContainerNumber } from "../documents/document-extraction";
import { JobsService } from "./jobs.service";

/** Parties, shipment references, manual ETA and tasks on a job. */
@Injectable()
export class JobDetailsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  async listParties(id: string, scope: JobScope): Promise<JobPartyRecord[]> {
    const job = await this.jobs.get(id, scope);
    return this.database.listJobParties(job.id);
  }

  async addParty(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<JobPartyRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(jobPartyInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    return this.database.addJobParty({
      jobId: job.id,
      ...parsed.data,
      createdBy,
    });
  }

  async removeParty(
    id: string,
    partyId: string,
    removedBy: string,
    scope: JobScope,
  ): Promise<{ removed: true }> {
    const job = await this.editableJob(id, scope);
    if (
      !isUuid(partyId) ||
      !(await this.database.removeJobParty(job.id, partyId, removedBy))
    ) {
      throw new NotFoundException("Party was not found on this job");
    }
    return { removed: true };
  }

  async listReferences(
    id: string,
    scope: JobScope,
  ): Promise<ShipmentReferenceRecord[]> {
    const job = await this.jobs.get(id, scope);
    return this.database.listShipmentReferences(job.id);
  }

  async addReference(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<ShipmentReferenceRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(shipmentReferenceInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { kind, sealNumber, parentReferenceId } = parsed.data;
    // Container numbers are stored as printed (no spaces, capitals) and must
    // pass the ISO 6346 check digit, which catches nearly every typo.
    const value =
      kind === "container"
        ? parsed.data.value.replace(/\s+/g, "").toUpperCase()
        : parsed.data.value;
    if (kind === "container" && !isValidContainerNumber(value)) {
      throw new BadRequestException(
        `${value} is not a valid container number: check the letters and digits against the bill of lading`,
      );
    }

    if (!referenceKindAllowedFor(job.serviceLine, kind)) {
      throw new BadRequestException(
        `${kind} cannot be recorded on a ${job.serviceLine} job`,
      );
    }
    if (sealNumber && kind !== "container") {
      throw new BadRequestException("Only containers carry a seal number");
    }
    const isHouse = kind === "house_bl" || kind === "house_awb";
    if (isHouse !== (parentReferenceId !== null)) {
      throw new BadRequestException(
        isHouse
          ? "A house document must reference its master"
          : "Only house documents can reference a master",
      );
    }

    const result = await this.database.addShipmentReference({
      jobId: job.id,
      kind,
      value,
      sealNumber,
      parentReferenceId,
      createdBy,
    });
    if (result === "duplicate_reference") {
      throw new ConflictException("This reference is already on the job");
    }
    if (result === "parent_invalid") {
      throw new BadRequestException(
        "parentReferenceId must be an active master of the matching kind on this job",
      );
    }
    return result;
  }

  async removeReference(
    id: string,
    referenceId: string,
    removedBy: string,
    scope: JobScope,
  ): Promise<{ removed: true }> {
    const job = await this.editableJob(id, scope);
    const removed = isUuid(referenceId)
      ? await this.database.removeShipmentReference(
          job.id,
          referenceId,
          removedBy,
        )
      : false;
    if (removed === "has_children") {
      throw new ConflictException(
        "Remove the house documents under this master first",
      );
    }
    if (!removed) {
      throw new NotFoundException("Reference was not found on this job");
    }
    return { removed: true };
  }

  /** Newest entry is the current ETA; earlier entries stay as history. */
  async getEta(
    id: string,
    scope: JobScope,
  ): Promise<{ current: EtaEventRecord | null; history: EtaEventRecord[] }> {
    const job = await this.jobs.get(id, scope);
    const history = await this.database.listEtaEvents(job.id);
    return { current: history.at(-1) ?? null, history };
  }

  async recordEta(
    id: string,
    input: unknown,
    recordedBy: string,
    scope: JobScope,
  ): Promise<EtaEventRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(etaInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const event = await this.database.appendEtaEvent({
      jobId: job.id,
      ...parsed.data,
      recordedBy,
    });
    if (event === "correction_target_not_found") {
      throw new NotFoundException(
        "The ETA being corrected was not found on this job",
      );
    }
    await this.notifications.notify({
      companyId: job.customerCompanyId,
      jobId: job.id,
      event: "eta",
      dedupeKey: `eta:${event.id}`,
      message: (sender) => etaMessage(sender, job.fileNumber, event.etaAt),
      linkPath: `/jobs/${job.id}`,
      createdBy: recordedBy,
    });
    return event;
  }

  async listTasks(id: string, scope: JobScope): Promise<JobTaskRecord[]> {
    const job = await this.jobs.get(id, scope);
    return this.database.listJobTasks({ jobId: job.id }, scope);
  }

  async createTask(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<JobTaskRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(jobTaskInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    return this.database.createJobTask({
      jobId: job.id,
      ...parsed.data,
      createdBy,
    });
  }

  async completeTask(
    id: string,
    taskId: string,
    input: unknown,
    completedBy: string,
    scope: JobScope,
  ): Promise<JobTaskRecord> {
    // Finishing follow-up work (a damage claim, a missing document) is allowed
    // after closure; adding tasks still needs an open job.
    const job = await this.jobs.get(id, scope);
    const parsed = parseContract(taskCompletionSchema, input ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = isUuid(taskId)
      ? await this.database.completeJobTask(
          job.id,
          taskId,
          completedBy,
          parsed.data.note,
        )
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Task was not found on this job");
    }
    if (result === "already_done") {
      throw new ConflictException("Task is already complete");
    }
    return result;
  }

  /** Tasks across the jobs the caller can see, e.g. one department's open work. */
  async listOpenTasks(
    assignedRole: string | undefined,
    status: string | undefined,
    scope: JobScope,
  ): Promise<JobTaskRecord[]> {
    if (
      assignedRole !== undefined &&
      !(staffRoleKeys as readonly string[]).includes(assignedRole)
    ) {
      throw new BadRequestException(
        `assignedRole must be one of ${staffRoleKeys.join(", ")}`,
      );
    }
    if (status !== undefined && status !== "open" && status !== "all") {
      throw new BadRequestException("status must be open or all");
    }
    return this.database.listJobTasks(
      {
        assignedRole: assignedRole as StaffRoleKey | undefined,
        open: status !== "all",
      },
      scope,
    );
  }

  private async editableJob(id: string, scope: JobScope): Promise<JobRecord> {
    const job = await this.jobs.get(id, scope);
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before changing it");
    }
    return job;
  }
}
