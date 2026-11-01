import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isUuid,
  jobAssignmentInputSchema,
  legacyStaffRoleKeys,
  parseContract,
  serviceLinesForRoles,
} from "@bjh/contracts";
import {
  DatabasePort,
  JobAssignmentRecord,
  JobRecord,
  JobScope,
  StaffRoleKey,
} from "../database/database.port";
import { STAFF_AUTH_DIRECTORY } from "../auth/staff-admin.port";
import type { StaffAuthDirectory } from "../auth/staff-admin.port";
import { JobsService } from "./jobs.service";

/** Customer service assigns who works a job; the super admin may too. */
const assigningRoles: StaffRoleKey[] = ["super_admin", "customer_service_rep"];

/** Roles that work jobs hands-on; customer service, sales and finance do not lead one. */
const operationalRoles: StaffRoleKey[] = [
  "import_rep",
  "export_rep",
  ...legacyStaffRoleKeys,
];

export interface JobAssignmentView extends JobAssignmentRecord {
  email: string | null;
}

export interface JobTeamView {
  /** Current lead and assistants. */
  team: JobAssignmentView[];
  /** Everyone who worked the job, including those since removed. */
  history: JobAssignmentView[];
  /** True once the client has accepted an issued invoice on the job. */
  invoiceAccepted: boolean;
  /** Staff who may be assigned: the reps whose roles cover the job's line. */
  candidates: Array<{ userId: string; email: string | null }>;
}

/**
 * Who works a job (client meeting, 2026-11-01). One lead rep at a time, plus
 * any assistants. Customer service assigns only after the client has accepted
 * the job's invoice; the super admin may assign earlier with a written reason.
 * Assigning does not change who can see the job: every rep on the line still can.
 */
@Injectable()
export class JobAssignmentsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(STAFF_AUTH_DIRECTORY) private readonly auth: StaffAuthDirectory,
  ) {}

  async team(id: string, scope: JobScope): Promise<JobTeamView> {
    const job = await this.jobs.get(id, scope);
    const [assignments, invoiceAccepted, candidateIds] = await Promise.all([
      this.database.listJobAssignments(job.id),
      this.invoiceAccepted(job.id),
      this.candidateIds(job),
    ]);
    const emails = await this.emails([
      ...assignments.map((item) => item.userId),
      ...candidateIds,
    ]);
    const withEmail = (item: JobAssignmentRecord) => ({
      ...item,
      email: emails.get(item.userId) ?? null,
    });
    return {
      team: assignments.filter((item) => !item.removedAt).map(withEmail),
      history: assignments.map(withEmail),
      invoiceAccepted,
      candidates: candidateIds.map((userId) => ({
        userId,
        email: emails.get(userId) ?? null,
      })),
    };
  }

  async assign(
    id: string,
    input: unknown,
    actorId: string,
    roles: StaffRoleKey[],
    scope: JobScope,
  ): Promise<JobAssignmentView> {
    this.requireAssigner(roles);
    const parsed = parseContract(jobAssignmentInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { userId, kind, overrideReason } = parsed.data;
    const job = await this.openJob(id, scope);

    if (!(await this.candidateIds(job)).includes(userId)) {
      throw new BadRequestException(
        "Only an import or export rep for this job's service can be assigned",
      );
    }
    if (kind === "assistant") {
      const team = await this.database.listJobAssignments(job.id);
      if (!team.some((item) => item.kind === "lead" && !item.removedAt)) {
        throw new ConflictException("Assign a lead before adding assistants");
      }
    }

    let reason: string | null = null;
    if (!(await this.invoiceAccepted(job.id))) {
      if (!roles.includes("super_admin")) {
        throw new ConflictException(
          "The client has not accepted an invoice on this job yet",
        );
      }
      if (!overrideReason) {
        throw new ConflictException(
          "The client has not accepted an invoice yet: give a reason to assign anyway",
        );
      }
      reason = overrideReason;
    }

    const result = await this.database.assignJob(job.id, {
      userId,
      kind,
      assignedBy: actorId,
      overrideReason: reason,
    });
    if (result === "already_on_job") {
      throw new ConflictException("This person is already on the job");
    }
    return {
      ...result,
      email: (await this.auth.getUser(userId))?.email ?? null,
    };
  }

  async remove(
    id: string,
    assignmentId: string,
    actorId: string,
    roles: StaffRoleKey[],
    scope: JobScope,
  ): Promise<JobAssignmentRecord> {
    this.requireAssigner(roles);
    const job = await this.openJob(id, scope);
    const result = isUuid(assignmentId)
      ? await this.database.removeJobAssignment(job.id, assignmentId, actorId)
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("This person is not on the job");
    }
    return result;
  }

  private requireAssigner(roles: StaffRoleKey[]) {
    if (!roles.some((role) => assigningRoles.includes(role))) {
      throw new ForbiddenException(
        "Only customer service or the super admin assigns who works a job",
      );
    }
  }

  private async openJob(id: string, scope: JobScope): Promise<JobRecord> {
    const job = await this.jobs.get(id, scope);
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before changing it");
    }
    return job;
  }

  private async invoiceAccepted(jobId: string): Promise<boolean> {
    const [invoices, acceptances] = await Promise.all([
      this.database.listInvoices(jobId),
      this.database.listInvoiceAcceptances(jobId),
    ]);
    const accepted = new Set(acceptances.map((item) => item.invoiceId));
    // A voided invoice no longer counts, even if the client had accepted it.
    return invoices.some(
      (invoice) => invoice.status === "issued" && accepted.has(invoice.id),
    );
  }

  private async candidateIds(job: JobRecord): Promise<string[]> {
    const rolesByUser = new Map<string, StaffRoleKey[]>();
    for (const assignment of await this.database.listStaffRoleAssignments()) {
      if (
        assignment.revokedAt ||
        !operationalRoles.includes(assignment.roleKey)
      )
        continue;
      const held = rolesByUser.get(assignment.userId) ?? [];
      held.push(assignment.roleKey);
      rolesByUser.set(assignment.userId, held);
    }
    return [...rolesByUser]
      .filter(([, held]) =>
        serviceLinesForRoles(held).includes(job.serviceLine),
      )
      .map(([userId]) => userId);
  }

  private async emails(userIds: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIds)];
    const users = await Promise.all(unique.map((id) => this.auth.getUser(id)));
    return new Map(
      unique.map((id, index) => [id, users[index]?.email ?? null]),
    );
  }
}
