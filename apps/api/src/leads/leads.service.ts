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
  leadOpenStageKeys,
  leadPipelineKeys,
  leadPipelineOf,
  leadStagesFor,
  leadUpdateInputSchema,
  parseContract,
  type LeadPipeline,
} from "@bjh/contracts";
import { randomUUID } from "node:crypto";
import { DatabasePort, LeadRecord } from "../database/database.port";

const openStages = leadOpenStageKeys;

/** `?pipeline=manual|generated`; absent means every lead (used by reports, never by the boards). */
function parsePipeline(value: unknown): LeadPipeline | undefined {
  if (value === undefined) return undefined;
  if (leadPipelineKeys.includes(value as LeadPipeline)) {
    return value as LeadPipeline;
  }
  throw new BadRequestException("pipeline must be manual or generated");
}

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

  async list(pipeline?: unknown) {
    const only = parsePipeline(pipeline);
    return (await this.database.listLeads())
      .filter((lead) => !only || leadPipelineOf(lead.source) === only)
      .map((lead) => this.withOverdue(lead));
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

    if (!leadStagesFor(leadPipelineOf(current.source)).includes(next.stage)) {
      throw new BadRequestException(
        `A ${leadPipelineOf(current.source)} lead cannot be moved to ${next.stage}`,
      );
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
  async summary(pipeline?: unknown) {
    const only = parsePipeline(pipeline);
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
    const [weekAll, monthAll, allLeads] = await Promise.all([
      this.database.salesPeriod(monday, tomorrow),
      this.database.salesPeriod(monthStart, tomorrow),
      this.database.listLeads(),
    ]);
    const leads = allLeads.filter(
      (lead) => !only || leadPipelineOf(lead.source) === only,
    );
    // For one pipeline, count its own leads: logged in the period, and won in it.
    const period = (from: string, all: typeof weekAll) => {
      if (!only) return all;
      const day = (value: string) => value.slice(0, 10);
      const won = leads.filter(
        (lead) =>
          lead.stage === "won" &&
          day(lead.stageChangedAt) >= from &&
          day(lead.stageChangedAt) < tomorrow,
      );
      return {
        newLeads: leads.filter(
          (lead) =>
            day(lead.createdAt) >= from && day(lead.createdAt) < tomorrow,
        ).length,
        converted: won.length,
        convertedCompanies: won.map(
          (lead) => lead.customerCompanyName ?? lead.companyName,
        ),
      };
    };
    const thisWeek = period(monday, weekAll);
    const thisMonth = period(monthStart, monthAll);
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

  /**
   * Makes the lead a customer company so a quote can be prepared for it. The
   * company and its primary contact come from the lead; the lead stays open and
   * is linked to the company (won only when a quote is accepted). A lead that
   * is already linked returns its company.
   */
  async toCustomer(id: string) {
    const lead = await this.find(id);
    if (lead.customerCompanyId) {
      return { customerCompanyId: lead.customerCompanyId };
    }
    if (!openStages.includes(lead.stage)) {
      throw new ConflictException("Only an open lead can be quoted");
    }
    if (!lead.email) {
      throw new BadRequestException(
        "Add the lead's email first: the quote is sent there",
      );
    }
    const createdAt = new Date().toISOString();
    const customer = await this.database.createCustomer({
      id: randomUUID(),
      companyName: lead.companyName,
      phone: lead.phone,
      createdAt,
      contacts: [
        {
          id: randomUUID(),
          name: lead.contactName ?? lead.companyName,
          role: null,
          email: lead.email,
          phone: lead.phone,
          notify: true,
          isPrimary: true,
          createdAt,
        },
      ],
    });
    const saved = await this.database.saveLead({
      ...lead,
      customerCompanyId: customer.id,
    });
    if (!saved) throw new NotFoundException("Lead was not found");
    return { customerCompanyId: customer.id };
  }

  private async find(id: string) {
    const lead = isUuid(id) ? await this.database.findLead(id) : null;
    if (!lead) throw new NotFoundException("Lead was not found");
    return lead;
  }
}
