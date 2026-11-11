import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabasePort } from "../database/database.port";
import { normalizePhoneKey } from "./business-normalize";
import { BUSINESS_SEARCH_PROVIDER } from "./business-search";
import type {
  BusinessSearchProvider,
  BusinessSearchQuery,
} from "./business-search";
import { checkDuplicates } from "./duplicate-check";
import type {
  ClaimedLeadRun,
  NewProspect,
  ProspectEnrichment,
  ProspectToEnrich,
  ProspectToScore,
} from "./lead-run";
import { PROSPECT_SCORER, scoreByRules } from "./prospect-scoring";
import type { ProspectScorer } from "./prospect-scoring";
import { WEBSITE_CONTACT_FINDER } from "./website-contacts";
import type { WebsiteContactFinder, WebsiteContacts } from "./website-contacts";

/** How long a worker holds a run. If it dies, the run is claimable again after this. */
export const LEASE_SECONDS = 600;
/** Failed attempts in a row after which a run is given up. */
export const MAX_ATTEMPTS = 5;
/** Waits before attempts 2 to 5 after a retryable failure: 30 s, 1, 2 and 4 minutes. */
export const retryDelaySeconds = (failures: number) =>
  Math.min(30 * 2 ** (failures - 1), 300);
/** How long to wait before asking the search provider again while it is still searching. */
export const SEARCH_POLL_SECONDS = 20;
/** Websites read at the same time, and prospects scored at the same time, per step. */
export const ENRICH_BATCH = 8;
export const SCORE_BATCH = 10;
/** One timer tick keeps working through due steps for at most this long. */
const TICK_BUDGET_MS = 4 * 60_000;

/** The run cannot go on, and the message tells staff why (safe: no secrets, no raw content). */
class RunFailure extends Error {}

/**
 * Moves campaign runs along (plan item 1.6): searching, enriching, scoring, ready. It
 * runs inside the API process on a timer, like the notification dispatcher (no
 * separate service or queue). One run is claimed at a time, oldest first, with a lease
 * kept in the database, and each step does one bounded piece of work and gives the
 * run back, so a restart or a dead worker loses at most that piece. Tests call
 * `advance` directly.
 */
@Injectable()
export class LeadRunPipeline implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadRunPipeline.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(BUSINESS_SEARCH_PROVIDER)
    private readonly search: BusinessSearchProvider,
    @Inject(WEBSITE_CONTACT_FINDER)
    private readonly finder: WebsiteContactFinder,
    @Inject(PROSPECT_SCORER) private readonly scorer: ProspectScorer,
  ) {}

  onModuleInit(): void {
    const off =
      process.env.LEAD_RUNS_WORKER === "off" ||
      process.env.NODE_TEST_CONTEXT !== undefined;
    if (off) return;
    const interval = Number(process.env.LEAD_RUNS_INTERVAL_MS ?? 5_000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const deadline = Date.now() + TICK_BUDGET_MS;
    try {
      while (!this.stopped && Date.now() < deadline && (await this.advance())) {
        // Keep going while there is a step that is due.
      }
    } catch (error) {
      this.logger.error(
        `Lead run pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Claims the next due run and does one step of it. False when no run was due. */
  async advance(): Promise<boolean> {
    const run = await this.database.claimLeadRun(randomUUID(), LEASE_SECONDS);
    if (!run) return false;
    try {
      if (run.attemptCount >= MAX_ATTEMPTS) {
        throw new RunFailure(
          "The run stopped before it could finish too many times and was given up",
        );
      }
      if (run.step === "searching") await this.searchStep(run);
      else if (run.step === "enriching") await this.enrichStep(run);
      else await this.scoreStep(run);
    } catch (error) {
      await this.handleFailure(run, error);
    }
    return true;
  }

  // ── searching ──────────────────────────────────────────────────────────────

  /** One call to the search provider per tick: start, then poll, then fetch and store. */
  private async searchStep(run: ClaimedLeadRun): Promise<void> {
    const query = searchQuery(run);
    if (!run.providerRunId) {
      const { providerRunId } = await this.search.start(query);
      await this.release(run, { providerRunId, nextInSeconds: 5 });
      return;
    }
    if (!run.providerDatasetId) {
      const progress = await this.search.poll(run.providerRunId);
      if (progress.state === "failed") {
        throw new RunFailure(progress.message);
      }
      if (progress.state === "running") {
        await this.release(run, { nextInSeconds: SEARCH_POLL_SECONDS });
        return;
      }
      await this.release(run, {
        providerDatasetId: progress.datasetId,
        nextInSeconds: 0,
      });
      return;
    }

    const results = await this.search.fetchResults(
      run.providerDatasetId,
      query,
    );
    const batch = results.businesses.map((business) => ({
      id: randomUUID(),
      business,
    }));
    const verdicts = checkDuplicates(
      batch,
      await this.database.listKnownBusinesses(run.campaign.campaignId),
    );
    const prospects: NewProspect[] = [];
    let duplicates = 0;
    for (const { id, business } of batch) {
      const verdict = verdicts.get(id);
      if (verdict?.outcome === "already_found") {
        // The same place is already stored for this campaign: not stored again.
        duplicates += 1;
        continue;
      }
      if (verdict?.outcome === "flagged") duplicates += 1;
      prospects.push({
        prospectId: id,
        business,
        duplicate:
          verdict?.outcome === "flagged"
            ? {
                kind: verdict.kind,
                ref: verdict.ref,
                reason: verdict.reason,
              }
            : null,
      });
    }
    const stored = await this.database.storeFoundProspects(
      {
        runId: run.runId,
        campaignId: run.campaign.campaignId,
        claimId: run.claimId,
      },
      prospects,
      { found: results.businesses.length, duplicates },
    );
    if (!stored)
      this.logger.warn(`Run ${run.runId} was taken over; not stored`);
  }

  // ── enriching ──────────────────────────────────────────────────────────────

  private async enrichStep(run: ClaimedLeadRun): Promise<void> {
    const batch = await this.database.listProspectsToEnrich(
      run.runId,
      ENRICH_BATCH,
    );
    await Promise.all(
      batch.map(async (prospect) =>
        this.database.saveProspectEnrichment(
          prospect.prospectId,
          await this.enrichment(prospect),
        ),
      ),
    );
    await this.release(run, {
      ...(batch.length === 0 ? { step: "scoring" as const } : {}),
      nextInSeconds: 0,
    });
  }

  /** What reading the prospect's website adds to what the search already gave. */
  private async enrichment(
    prospect: ProspectToEnrich,
  ): Promise<ProspectEnrichment> {
    if (!prospect.website) {
      return {
        status: prospect.emails.length > 0 ? "email_found" : "email_missing",
        error: null,
        emails: prospect.emails,
        phones: prospect.phones,
        excerpt: null,
      };
    }
    let contacts: WebsiteContacts;
    try {
      contacts = await this.finder.find(prospect.website);
    } catch {
      // The finder reports its own problems; this is only a bug's safety net.
      contacts = {
        status: "failed",
        emails: [],
        phones: [],
        pagesChecked: 0,
        excerpt: null,
        error: "The website could not be read",
      };
    }
    const emails = unique(
      [...prospect.emails, ...contacts.emails.map((found) => found.address)],
      (address) => address.toLowerCase(),
    ).slice(0, 10);
    const phones = unique(
      [...prospect.phones, ...contacts.phones],
      (phone) => normalizePhoneKey(phone) ?? phone,
    ).slice(0, 10);
    return {
      status:
        contacts.status === "failed"
          ? "failed"
          : emails.length > 0
            ? "email_found"
            : "email_missing",
      error: contacts.status === "failed" ? contacts.error : null,
      emails,
      phones,
      excerpt: contacts.excerpt,
    };
  }

  // ── scoring ────────────────────────────────────────────────────────────────

  private async scoreStep(run: ClaimedLeadRun): Promise<void> {
    const batch = await this.database.listProspectsToScore(
      run.runId,
      SCORE_BATCH,
    );
    if (batch.length === 0) {
      const done = await this.database.finishLeadRun(
        run,
        run.campaign.qualificationThreshold,
      );
      if (!done) this.logger.warn(`Run ${run.runId} was taken over; not ended`);
      return;
    }
    await Promise.all(
      batch.map(async (item) =>
        this.database.saveProspectScore(
          item.prospectId,
          await this.fit(item, run),
        ),
      ),
    );
    await this.release(run, { nextInSeconds: 0 });
  }

  /** The scorer falls back to the rules by itself; a bug in it must still not stop the run. */
  private async fit(item: ProspectToScore, run: ClaimedLeadRun) {
    try {
      return await this.scorer.score(item.prospect, run.campaign);
    } catch {
      return scoreByRules(item.prospect, run.campaign);
    }
  }

  // ── giving the run back ────────────────────────────────────────────────────

  /** Progress: the failed-attempts count starts again from zero. */
  private async release(
    run: ClaimedLeadRun,
    update: {
      step?: "enriching" | "scoring";
      providerRunId?: string;
      providerDatasetId?: string;
      nextInSeconds: number;
    },
  ): Promise<void> {
    const kept = await this.database.releaseLeadRun(run, {
      ...update,
      attemptCount: 0,
    });
    if (!kept) this.logger.warn(`Run ${run.runId} was taken over; left as is`);
  }

  private async handleFailure(
    run: ClaimedLeadRun,
    error: unknown,
  ): Promise<void> {
    const retryable = (error as { retryable?: unknown } | null)?.retryable;
    // Only errors that vouch for their own message are shown to staff as they are.
    const safe =
      error instanceof RunFailure || typeof retryable === "boolean"
        ? (error as Error).message
        : "The run hit an unexpected problem";
    if (!(error instanceof RunFailure) && typeof retryable !== "boolean") {
      this.logger.error(
        `Run ${run.runId} step ${run.step} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const failures = run.attemptCount + 1;
    if (retryable === false || error instanceof RunFailure) {
      await this.database.failLeadRun(run, safe);
    } else if (failures >= MAX_ATTEMPTS) {
      await this.database.failLeadRun(
        run,
        `${safe} (gave up after ${MAX_ATTEMPTS} attempts)`,
      );
    } else {
      await this.database.releaseLeadRun(run, {
        attemptCount: failures,
        nextInSeconds: retryDelaySeconds(failures),
      });
    }
  }
}

function searchQuery(run: ClaimedLeadRun): BusinessSearchQuery {
  const { campaign } = run;
  return {
    industry: campaign.targetIndustry,
    location: campaign.targetLocation,
    keywords: campaign.searchKeywords,
    excludedKeywords: campaign.excludedKeywords,
    minRating: campaign.minRating,
    requireWebsite: campaign.requireWebsite,
    maxResults: run.targetCount,
  };
}

function unique(values: string[], key: (value: string) => string): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
