import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isUuid,
  leadActivityInputSchema,
  leadCreateInputSchema,
  leadUpdateInputSchema,
  parseContract,
  type LeadStage,
} from "@bjh/contracts";
import { randomUUID } from "node:crypto";
import { DatabasePort, LeadRecord } from "../database/database.port";

const openStages: LeadStage[] = ["new", "contacted", "quoted"];

@Injectable()
export class LeadsService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  /** A follow-up date in the past on a lead that is still open. */
  private withOverdue(lead: LeadRecord) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...lead,
      followUpOverdue:
        openStages.includes(lead.stage) &&
        lead.nextFollowUp !== null &&
        lead.nextFollowUp < today,
    };
  }

  async list() {
    return (await this.database.listLeads()).map((lead) =>
      this.withOverdue(lead),
    );
  }

  async create(input: unknown, userId: string) {
    const parsed = parseContract(leadCreateInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const created = await this.database.createLead({
      id: randomUUID(),
      companyName: parsed.data.companyName,
      contactName: parsed.data.contactName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      source: parsed.data.source,
      stage: "new",
      ownerId: userId,
      nextFollowUp: parsed.data.nextFollowUp,
      notes: parsed.data.notes,
      lostReason: null,
      quoteRequestId: parsed.data.quoteRequestId,
      customerCompanyId: null,
      createdBy: userId,
    });
    if (created === "duplicate_request") {
      throw new ConflictException("This request is already tracked as a lead");
    }
    if (created === "unknown_reference") {
      throw new BadRequestException("The quote request was not found");
    }
    return this.withOverdue(created);
  }

  async update(id: string, input: unknown, userId: string) {
    const parsed = parseContract(leadUpdateInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const change = parsed.data;
    const current = isUuid(id) ? await this.database.findLead(id) : null;
    if (!current) throw new NotFoundException("Lead was not found");

    const next: LeadRecord = {
      ...current,
      companyName: change.companyName ?? current.companyName,
      contactName:
        change.contactName !== undefined
          ? change.contactName
          : current.contactName,
      email: change.email !== undefined ? change.email : current.email,
      phone: change.phone !== undefined ? change.phone : current.phone,
      notes: change.notes !== undefined ? change.notes : current.notes,
      nextFollowUp:
        change.nextFollowUp !== undefined
          ? change.nextFollowUp
          : current.nextFollowUp,
      stage: change.stage ?? current.stage,
      customerCompanyId: change.customerCompanyId ?? current.customerCompanyId,
      ownerId:
        change.owner === undefined
          ? current.ownerId
          : change.owner === "me"
            ? userId
            : change.owner,
    };
    // A lead may be handed to another staff member, such as a sales rep.
    if (
      change.owner &&
      change.owner !== "me" &&
      (await this.database.getActiveStaffRoles(change.owner)).length === 0
    ) {
      throw new BadRequestException("owner must be an active staff member");
    }

    if (next.stage === "lost") {
      const reason = change.lostReason ?? current.lostReason;
      if (!reason) throw new BadRequestException("A lost lead needs a reason");
      next.lostReason = reason;
    } else {
      if (change.lostReason) {
        throw new BadRequestException(
          "Only a lost lead can have a lost reason",
        );
      }
      next.lostReason = null;
    }
    if (next.stage === "won" && !next.customerCompanyId) {
      throw new BadRequestException(
        "A won lead must be linked to a customer company",
      );
    }

    const saved = await this.database.saveLead(next);
    if (saved === "unknown_reference") {
      throw new BadRequestException("The customer company was not found");
    }
    if (!saved) throw new NotFoundException("Lead was not found");
    return this.withOverdue(saved);
  }

  async activities(id: string) {
    await this.find(id);
    return this.database.listLeadActivities(id);
  }

  async addActivity(id: string, input: unknown, userId: string) {
    const parsed = parseContract(leadActivityInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    if (
      parsed.data.occurredAt &&
      Date.parse(parsed.data.occurredAt) > Date.now() + 5 * 60_000
    ) {
      throw new BadRequestException("occurredAt cannot be in the future");
    }
    const added = isUuid(id)
      ? await this.database.addLeadActivity({
          leadId: id,
          kind: parsed.data.kind,
          note: parsed.data.note,
          occurredAt: parsed.data.occurredAt ?? new Date().toISOString(),
          createdBy: userId,
        })
      : "not_found";
    if (added === "not_found")
      throw new NotFoundException("Lead was not found");
    return added;
  }

  /**
   * The sales picture: leads logged and clients converted this week (from
   * Monday) and this month, and open leads whose follow-up is due. Days are
   * Ghana days (UTC).
   */
  async summary() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const monday = new Date(
      now.getTime() - ((now.getUTCDay() + 6) % 7) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const [thisWeek, thisMonth, leads] = await Promise.all([
      this.database.salesPeriod(monday, tomorrow),
      this.database.salesPeriod(monthStart, tomorrow),
      this.database.listLeads(),
    ]);
    const open = leads.filter((lead) => openStages.includes(lead.stage));
    return {
      thisWeek,
      thisMonth,
      openLeads: open.length,
      followUpsDue: open.filter(
        (lead) => lead.nextFollowUp !== null && lead.nextFollowUp <= today,
      ).length,
    };
  }

  private async find(id: string) {
    const lead = isUuid(id) ? await this.database.findLead(id) : null;
    if (!lead) throw new NotFoundException("Lead was not found");
    return lead;
  }
}
