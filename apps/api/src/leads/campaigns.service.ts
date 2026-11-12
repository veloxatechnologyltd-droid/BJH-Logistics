import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  campaignCreateInputSchema,
  campaignUpdateInputSchema,
  isUuid,
  parseContract,
  prospectPromoteInputSchema,
} from "@bjh/contracts";
import { randomUUID } from "node:crypto";
import { DatabasePort } from "../database/database.port";
import { BUSINESS_SEARCH_PROVIDER } from "./business-search";
import type { BusinessSearchProvider } from "./business-search";
import type { ProspectFilter, ProspectRecord } from "./campaigns";
import { PROSPECT_SCORER } from "./prospect-scoring";
import type { ProspectScorer } from "./prospect-scoring";

const ENRICHMENT_STATUSES: ProspectRecord["enrichmentStatus"][] = [
  "pending",
  "email_found",
  "email_missing",
  "failed",
];

/** The query string of the prospect list, read strictly: a bad value is a 400, not ignored. */
function prospectFilter(query: Record<string, unknown>): ProspectFilter {
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
  const runId = text("runId");
  if (runId !== undefined && !isUuid(runId)) {
    throw new BadRequestException("runId must be a valid ID");
  }
  const search = text("search")?.trim();
  if (search && search.length > 100) {
    throw new BadRequestException("search must be at most 100 characters");
  }
  const enrichment = text("enrichment");
  if (
    enrichment !== undefined &&
    !ENRICHMENT_STATUSES.includes(enrichment as never)
  ) {
    throw new BadRequestException(
      `enrichment must be one of ${ENRICHMENT_STATUSES.join(", ")}`,
    );
  }
  return {
    runId,
    search: search || undefined,
    minScore: whole("minScore", 0, 100),
    qualified: flag("qualified"),
    duplicate: flag("duplicate"),
    enrichment: enrichment as ProspectFilter["enrichment"],
    promoted: flag("promoted"),
    limit: whole("limit", 1, 200) ?? 50,
    offset: whole("offset", 0, 1_000_000) ?? 0,
  };
}

/**
 * Lead-generation campaigns, their runs and the prospects they find. Staff only:
 * the controller admits sales, customer service and the super admin (decision L3).
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(BUSINESS_SEARCH_PROVIDER)
    private readonly search: BusinessSearchProvider,
    @Inject(PROSPECT_SCORER) private readonly scorer: ProspectScorer,
  ) {}

  /** What finds and scores the businesses, so the screens can say "sample data". */
  config() {
    return {
      searchProvider: this.search.name,
      sampleData: this.search.name === "stub",
      scorer: this.scorer.name,
    };
  }

  list() {
    return this.database.listLeadCampaigns();
  }

  async get(id: string) {
    const campaign = isUuid(id)
      ? await this.database.findLeadCampaign(id)
      : null;
    if (!campaign) throw new NotFoundException("Campaign was not found");
    return campaign;
  }

  async create(input: unknown, userId: string) {
    const parsed = parseContract(campaignCreateInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const data = parsed.data;
    return this.database.createLeadCampaign({
      id: randomUUID(),
      name: data.name,
      targetService: data.targetService,
      targetIndustry: data.targetIndustry,
      targetLocation: data.targetLocation,
      searchKeywords: data.searchKeywords ?? [],
      excludedKeywords: data.excludedKeywords ?? [],
      minRating: data.minRating,
      requireWebsite: data.requireWebsite ?? false,
      idealCustomerProfile: data.idealCustomerProfile,
      disqualifiers: data.disqualifiers,
      qualificationThreshold: data.qualificationThreshold ?? 50,
      maxProspects: data.maxProspects ?? 50,
      createdBy: userId,
    });
  }

  async update(id: string, input: unknown) {
    const parsed = parseContract(campaignUpdateInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const updated = isUuid(id)
      ? await this.database.updateLeadCampaign(id, parsed.data)
      : null;
    if (!updated) throw new NotFoundException("Campaign was not found");
    return updated;
  }

  async remove(id: string) {
    if (!isUuid(id) || !(await this.database.deleteLeadCampaign(id))) {
      throw new NotFoundException("Campaign was not found");
    }
    return { deleted: true };
  }

  async startRun(id: string, userId: string) {
    const started = isUuid(id)
      ? await this.database.startLeadRun(id, userId)
      : "not_found";
    if (started === "not_found") {
      throw new NotFoundException("Campaign was not found");
    }
    if (started === "not_active") {
      throw new ConflictException(
        "Only an active campaign can search. Resume it first.",
      );
    }
    if (started === "already_running") {
      throw new ConflictException(
        "This campaign already has a search waiting or running",
      );
    }
    return started;
  }

  async runs(id: string) {
    await this.get(id);
    return this.database.listLeadRuns(id, 20);
  }

  async run(id: string, runId: string) {
    const run =
      isUuid(id) && isUuid(runId)
        ? await this.database.findLeadRun(id, runId)
        : null;
    if (!run) throw new NotFoundException("Run was not found");
    return run;
  }

  async cancelRun(id: string, runId: string) {
    const cancelled =
      isUuid(id) && isUuid(runId)
        ? await this.database.cancelLeadRun(id, runId)
        : null;
    if (!cancelled) throw new NotFoundException("Run was not found");
    if (cancelled === "over") {
      throw new ConflictException("This search has already ended");
    }
    return cancelled;
  }

  async prospects(id: string, query: Record<string, unknown>) {
    const filter = prospectFilter(query);
    await this.get(id);
    return { ...(await this.database.listProspects(id, filter)), ...filter };
  }

  /** Adds the chosen prospects to the leads board; one already added is reported, not repeated. */
  async promote(id: string, input: unknown, userId: string) {
    const parsed = parseContract(prospectPromoteInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    await this.get(id);
    const results: Array<{
      prospectId: string;
      outcome: "promoted" | "already_promoted" | "not_found";
      leadId: string | null;
    }> = [];
    for (const prospectId of parsed.data.prospectIds) {
      const result = await this.database.promoteProspect(
        id,
        prospectId,
        userId,
      );
      results.push({
        prospectId,
        outcome: result.outcome,
        leadId: result.outcome === "not_found" ? null : result.leadId,
      });
    }
    const count = (outcome: string) =>
      results.filter((result) => result.outcome === outcome).length;
    return {
      promoted: count("promoted"),
      alreadyPromoted: count("already_promoted"),
      notFound: count("not_found"),
      results,
    };
  }
}
