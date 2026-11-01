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
  parseContract,
  quoteCreateInputSchema,
  quoteDecisionInputSchema,
  quoteVersionInputSchema,
} from "@bjh/contracts";
import { serviceLinesForRoles } from "../auth/auth.guards";
import { randomUUID } from "node:crypto";
import { quoteIssuedMessage } from "../notifications/notification-messages";
import { NotificationsService } from "../notifications/notifications.service";
import { renderQuotePdf } from "./quote-pdf";
import {
  DatabasePort,
  JobRecord,
  JobScope,
  QuoteDecisionRecord,
  QuoteRecord,
  QuoteSummaryRecord,
  StaffRoleKey,
} from "../database/database.port";

/**
 * Structured quotes. A rep for the quote's service line (or the super admin)
 * prepares and issues versions directly; there is no approval step. Customers
 * only ever see issued versions of their own company's quotes.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    input: unknown,
    createdBy: string,
    roles: StaffRoleKey[],
  ): Promise<QuoteRecord> {
    const parsed = parseContract(quoteCreateInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { customerCompanyId, serviceLine, quoteRequestId } = parsed.data;

    if (
      !roles.includes("super_admin") &&
      !serviceLinesForRoles(roles).includes(serviceLine)
    ) {
      throw new ForbiddenException(
        "You can only prepare quotes for your own service line",
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

    await this.requireConfiguredCurrency(parsed.data.version.currency);
    const id = await this.database.createQuote(parsed.data, createdBy);
    return this.get(id, {});
  }

  list(scope: JobScope): Promise<QuoteSummaryRecord[]> {
    return this.database.listQuotes(scope);
  }

  async get(id: string, scope: JobScope): Promise<QuoteRecord> {
    const quote = isUuid(id) ? await this.database.findQuote(id, scope) : null;
    if (!quote) throw new NotFoundException("Quote was not found");
    return quote;
  }

  /** Replaces the content of the quote's current draft version. */
  async saveDraft(
    id: string,
    input: unknown,
    scope: JobScope,
  ): Promise<QuoteRecord> {
    const quote = await this.get(id, scope);
    this.requireNotAccepted(quote);
    const parsed = parseContract(quoteVersionInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    await this.requireConfiguredCurrency(parsed.data.currency);
    const result = await this.database.saveQuoteVersionDraft(
      quote.id,
      parsed.data,
    );
    if (result === "no_draft") {
      throw new ConflictException(
        "Issued versions cannot be edited; start a new version first",
      );
    }
    return this.get(quote.id, scope);
  }

  /** Starts a new draft as a copy of the latest version. */
  async startVersion(
    id: string,
    createdBy: string,
    scope: JobScope,
  ): Promise<QuoteRecord> {
    const quote = await this.get(id, scope);
    this.requireNotAccepted(quote);
    const result = await this.database.startQuoteVersion(quote.id, createdBy);
    if (result === "draft_exists") {
      throw new ConflictException("This quote already has a draft version");
    }
    return this.get(quote.id, scope);
  }

  /** Freezes the draft and makes it visible to the customer. */
  async issue(
    id: string,
    issuedBy: string,
    scope: JobScope,
  ): Promise<QuoteRecord> {
    const quote = await this.get(id, scope);
    this.requireNotAccepted(quote);
    const result = await this.database.issueQuoteVersion(
      quote.id,
      issuedBy,
      new Date().getUTCFullYear(),
    );
    if (result === "no_draft") {
      throw new ConflictException("There is no draft version to issue");
    }
    if (result === "no_lines") {
      throw new BadRequestException(
        "Add at least one charge line before issuing",
      );
    }
    const issued = await this.get(quote.id, scope);
    const version = issued.versions
      .filter((item) => item.status === "issued")
      .at(-1);
    if (issued.quoteNumber && version) {
      const quoteNumber = issued.quoteNumber;
      await this.notifications.notify({
        companyId: issued.customerCompanyId,
        event: "quote_issued",
        dedupeKey: `quote-issued:${version.id}`,
        message: (sender) => quoteIssuedMessage(sender, quoteNumber),
        linkPath: `/quotes/${issued.id}`,
        createdBy: issuedBy,
      });
    }
    return issued;
  }

  /**
   * Sends the client the link to an issued quote again, by the configured
   * channels. The automatic message at issue time stays; this is a new one.
   */
  async send(id: string, sentBy: string, scope: JobScope) {
    const quote = await this.get(id, scope);
    const version = quote.versions
      .filter((item) => item.status === "issued")
      .at(-1);
    if (!quote.quoteNumber || !version) {
      throw new ConflictException("Only an issued quote can be sent");
    }
    if (
      (await this.notifications.notifiableContactCount(
        quote.customerCompanyId,
      )) === 0
    ) {
      throw new ConflictException(
        "This company has no contact to notify; add or switch on a contact first",
      );
    }
    const quoteNumber = quote.quoteNumber;
    const result = await this.notifications.queue({
      companyId: quote.customerCompanyId,
      event: "quote_sent",
      dedupeKey: `quote-sent:${version.id}:${randomUUID()}`,
      message: (sender) => quoteIssuedMessage(sender, quoteNumber),
      linkPath: `/quotes/${quote.id}`,
      createdBy: sentBy,
    });
    if (result === "duplicate") {
      throw new ConflictException("The message was already queued");
    }
    return result;
  }

  /**
   * Staff record the client's decision on the latest issued version. Accepting
   * opens the job; repeating the same decision returns the same result.
   */
  async decide(
    id: string,
    input: unknown,
    recordedBy: string,
    scope: JobScope,
  ): Promise<{ decision: QuoteDecisionRecord; job: JobRecord | null }> {
    const quote = await this.get(id, scope);
    const parsed = parseContract(quoteDecisionInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const now = Date.now();
    const decidedAt = parsed.data.decidedAt ?? new Date(now).toISOString();
    if (Date.parse(decidedAt) > now + 5 * 60_000) {
      throw new BadRequestException("decidedAt cannot be in the future");
    }

    const result = await this.database.decideQuote({
      quoteId: quote.id,
      versionNumber: parsed.data.versionNumber,
      decision: parsed.data.decision,
      clientSignatory: parsed.data.clientSignatory,
      decidedAt,
      note: parsed.data.note,
      recordedBy,
      year: new Date(now).getUTCFullYear(),
    });
    if (result === "version_not_found") {
      throw new NotFoundException("That version was not found on this quote");
    }
    if (result === "not_issued") {
      throw new ConflictException("Only an issued version can be decided");
    }
    if (result === "not_latest") {
      throw new ConflictException(
        "Only the latest issued version can be accepted or rejected",
      );
    }
    if (result === "already_decided") {
      throw new ConflictException(
        "That version already has a different recorded decision",
      );
    }
    // Accepting a quote is what converts a client: their open leads are won.
    if (result.decision.decision === "accepted") {
      await this.database.winLeadsForAcceptedQuote(
        quote.customerCompanyId,
        quote.quoteRequestId,
      );
    }
    return result;
  }

  /**
   * A customer accepts or declines the latest issued version of their own
   * company's quote from the portal. It is the same recorded decision as one
   * entered by staff, made by the customer's account and stamped with the time
   * it happens (they cannot backdate it); accepting opens the job.
   */
  async respond(
    id: string,
    input: unknown,
    userId: string,
    scope: JobScope,
  ): Promise<{ decision: QuoteDecisionRecord; job: JobRecord | null }> {
    if (scope.companyIds === undefined) {
      throw new ForbiddenException(
        "Staff record a client's decision on the quote's decision endpoint",
      );
    }
    const body =
      input && typeof input === "object" && !Array.isArray(input)
        ? { ...input, decidedAt: null }
        : input;
    return this.decide(id, body, userId, scope);
  }

  private requireNotAccepted(quote: QuoteRecord): void {
    if (quote.decisions.some((item) => item.decision === "accepted")) {
      throw new ConflictException(
        "This quote was accepted and can no longer be revised",
      );
    }
  }

  /** Once Settings exist, quotes may only use its configured currencies. */
  private async requireConfiguredCurrency(currency: string): Promise<void> {
    const current = await this.database.getBusinessSettings();
    if (current && !current.settings.currencies.includes(currency)) {
      throw new BadRequestException(
        `currency must be one of the configured currencies: ${current.settings.currencies.join(", ")}`,
      );
    }
  }

  /**
   * The quote as a PDF. Customers only reach issued versions (their view of the
   * quote hides drafts); a copy is marked DRAFT until it is issued and the
   * business settings are configured.
   */
  async pdf(
    id: string,
    versionNumber: unknown,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    const quote = await this.get(id, scope);
    if (versionNumber !== undefined && typeof versionNumber !== "string") {
      throw new BadRequestException("version must be a number");
    }
    const wanted =
      versionNumber === undefined ? undefined : Number(versionNumber);
    if (wanted !== undefined && !Number.isInteger(wanted)) {
      throw new BadRequestException("version must be a number");
    }
    const version =
      wanted === undefined
        ? quote.versions[quote.versions.length - 1]
        : quote.versions.find((item) => item.versionNumber === wanted);
    if (!version) throw new NotFoundException("Quote version was not found");

    const current = await this.database.getBusinessSettings();
    const file = await renderQuotePdf({
      quote,
      version,
      settings: current?.settings ?? null,
    });
    const base = (quote.quoteNumber ?? "quote-draft").replace(
      /[^A-Za-z0-9-]+/g,
      "-",
    );
    return { file, filename: `${base}-v${version.versionNumber}.pdf` };
  }
}
