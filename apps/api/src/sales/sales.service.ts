import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isUuid,
  outreachDraftBatchInputSchema,
  outreachDraftCreateInputSchema,
  outreachDraftEditInputSchema,
  outreachDraftRejectInputSchema,
  parseContract,
  poolDismissInputSchema,
} from "@bjh/contracts";
import { randomUUID } from "node:crypto";
import { DatabasePort } from "../database/database.port";
import { OUTREACH_DRAFTER } from "./outreach-drafting";
import type { OutreachDrafter } from "./outreach-drafting";
import type {
  OutreachDraftFilter,
  OutreachDraftRecord,
  OutreachDraftStatus,
  PoolFilter,
  PoolSort,
  PoolStatus,
} from "./sales";

const POOL_STATUSES: PoolStatus[] = ["new", "added", "dismissed", "all"];
const POOL_SORTS: PoolSort[] = ["score", "newest", "name"];
const DRAFT_STATUSES: OutreachDraftStatus[] = [
  "pending",
  "approved",
  "rejected",
];

/** Reads a query string strictly: a bad value is a 400, not ignored. */
function reader(query: Record<string, unknown>) {
  const text = (name: string) => {
    const value = query[name];
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string") {
      throw new BadRequestException(`${name} must be a single value`);
    }
    return value;
  };
  const flag = (name: string) => {
    const value = text(name);
    if (value === undefined) return undefined;
    if (value !== "true" && value !== "false") {
      throw new BadRequestException(`${name} must be true or false`);
    }
    return value === "true";
  };
  const whole = (name: string, min: number, max: number) => {
    const value = text(name);
    if (value === undefined) return undefined;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new BadRequestException(
        `${name} must be a whole number from ${min} to ${max}`,
      );
    }
    return number;
  };
  const choice = <T extends string>(name: string, allowed: T[]) => {
    const value = text(name);
    if (value === undefined) return undefined;
    if (!allowed.includes(value as T)) {
      throw new BadRequestException(
        `${name} must be one of ${allowed.join(", ")}`,
      );
    }
    return value as T;
  };
  return { text, flag, whole, choice };
}

function poolFilter(query: Record<string, unknown>): PoolFilter {
  const read = reader(query);
  const campaignId = read.text("campaignId");
  if (campaignId !== undefined && !isUuid(campaignId)) {
    throw new BadRequestException("campaignId must be a valid ID");
  }
  const search = read.text("search")?.trim();
  if (search && search.length > 100) {
    throw new BadRequestException("search must be at most 100 characters");
  }
  return {
    campaignId,
    status: read.choice("status", POOL_STATUSES) ?? "new",
    minScore: read.whole("minScore", 0, 100),
    hasEmail: read.flag("hasEmail"),
    duplicate: read.flag("duplicate"),
    search: search || undefined,
    sort: read.choice("sort", POOL_SORTS) ?? "score",
    limit: read.whole("limit", 1, 200) ?? 50,
    offset: read.whole("offset", 0, 1_000_000) ?? 0,
  };
}

function draftFilter(query: Record<string, unknown>): OutreachDraftFilter {
  const read = reader(query);
  return {
    status: read.choice("status", DRAFT_STATUSES),
    limit: read.whole("limit", 1, 100) ?? 50,
    offset: read.whole("offset", 0, 1_000_000) ?? 0,
  };
}

export type DraftSkipReason =
  "not_found" | "dismissed" | "no_email" | "already_drafted";

/**
 * The sales hub: the lead pool, the outreach drafts staff approve, and the overview.
 * Staff only: the controller admits sales, customer service and the super admin (L3).
 * Nothing here sends an email: approving a draft only records that a person agreed to it.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(OUTREACH_DRAFTER) private readonly drafter: OutreachDrafter,
  ) {}

  overview() {
    return this.database.getSalesOverview();
  }

  async pool(query: Record<string, unknown>) {
    const filter = poolFilter(query);
    return { ...(await this.database.listPoolProspects(filter)), ...filter };
  }

  async dismiss(input: unknown, userId: string) {
    const parsed = parseContract(poolDismissInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const changed = await this.database.setProspectsDismissed(
      parsed.data.prospectIds,
      parsed.data.dismissed,
      userId,
    );
    return { changed, unchanged: parsed.data.prospectIds.length - changed };
  }

  /** Drafts one email per prospect that has an address and no open draft; reports the rest. */
  async createDrafts(input: unknown, userId: string) {
    const parsed = parseContract(outreachDraftCreateInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const found = new Map(
      (
        await this.database.findProspectsForDrafting(parsed.data.prospectIds)
      ).map((info) => [info.prospectId, info]),
    );
    const created: OutreachDraftRecord[] = [];
    const skipped: Array<{
      prospectId: string;
      businessName: string | null;
      reason: DraftSkipReason;
    }> = [];
    for (const prospectId of parsed.data.prospectIds) {
      const info = found.get(prospectId);
      const skip = (reason: DraftSkipReason) =>
        skipped.push({
          prospectId,
          businessName: info?.businessName ?? null,
          reason,
        });
      if (!info) {
        skip("not_found");
        continue;
      }
      if (info.dismissed) {
        skip("dismissed");
        continue;
      }
      const recipient = info.emails[0];
      if (!recipient) {
        skip("no_email");
        continue;
      }
      const email = await this.drafter.draft(info, info.campaign);
      const draft = await this.database.createOutreachDraft({
        id: randomUUID(),
        prospectId,
        recipientEmail: recipient,
        subject: email.subject,
        body: email.body,
        method: email.method,
        createdBy: userId,
      });
      if (draft === "open_draft_exists") skip("already_drafted");
      else created.push(draft);
    }
    return { created, skipped };
  }

  async drafts(query: Record<string, unknown>) {
    const filter = draftFilter(query);
    return { ...(await this.database.listOutreachDrafts(filter)), ...filter };
  }

  async editDraft(id: string, input: unknown) {
    const parsed = parseContract(outreachDraftEditInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = isUuid(id)
      ? await this.database.editOutreachDraft(id, parsed.data)
      : "not_found";
    return this.draftOrError(result);
  }

  async approve(id: string, userId: string) {
    const result = isUuid(id)
      ? await this.database.decideOutreachDraft(
          id,
          { status: "approved" },
          userId,
        )
      : "not_found";
    return this.draftOrError(result);
  }

  async reject(id: string, input: unknown, userId: string) {
    const parsed = parseContract(outreachDraftRejectInputSchema, input ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = isUuid(id)
      ? await this.database.decideOutreachDraft(
          id,
          { status: "rejected", reason: parsed.data.reason },
          userId,
        )
      : "not_found";
    return this.draftOrError(result);
  }

  /** Approves each chosen draft that is still pending; the others are reported, not changed. */
  async approveMany(input: unknown, userId: string) {
    const parsed = parseContract(outreachDraftBatchInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const results: Array<{
      draftId: string;
      outcome: "approved" | "not_pending" | "not_found";
    }> = [];
    for (const draftId of parsed.data.draftIds) {
      const result = await this.database.decideOutreachDraft(
        draftId,
        { status: "approved" },
        userId,
      );
      results.push({
        draftId,
        outcome: typeof result === "string" ? result : "approved",
      });
    }
    const count = (outcome: string) =>
      results.filter((result) => result.outcome === outcome).length;
    return {
      approved: count("approved"),
      notPending: count("not_pending"),
      notFound: count("not_found"),
      results,
    };
  }

  private draftOrError(
    result: OutreachDraftRecord | "not_found" | "not_pending",
  ) {
    if (result === "not_found") {
      throw new NotFoundException("Draft was not found");
    }
    if (result === "not_pending") {
      throw new ConflictException(
        "This draft has already been approved or rejected",
      );
    }
    return result;
  }
}
