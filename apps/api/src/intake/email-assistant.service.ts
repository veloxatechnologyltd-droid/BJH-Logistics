import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  customerInputSchema,
  parseContract,
  quoteCreateInputSchema,
  requestReplyInputSchema,
} from "@bjh/contracts";
import type { ServiceLine } from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type {
  QuoteRequestRecord,
  StaffRoleKey,
} from "../database/database.port";
import { formatQuoteAmount } from "../quotations/quote-pdf";
import { QuoteRequestsService } from "../quotations/quote-requests.service";
import type { QuoteSuggestion } from "../quotations/quote-suggestion";
import { inChargeOf } from "./inbound-email.service";
import { REPLY_DRAFTER, ReplyDraftError } from "./reply-drafter";
import type { ReplyContext, ReplyDrafter } from "./reply-drafter";

const serviceLineLabels: Record<ServiceLine, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};

/** How many of the sender's company's jobs the reply may draw on. */
const MAX_JOBS = 10;

/** ASSISTANT_AUTO_REPLY=on: the assistant sends its reply itself, without prices. */
export function autoReplyOn(environment: NodeJS.ProcessEnv = process.env) {
  return environment.ASSISTANT_AUTO_REPLY?.trim().toLowerCase() === "on";
}

/**
 * A machine's address, or BJH's own mailbox. These are never answered
 * automatically, so two systems cannot keep replying to each other.
 */
export function automatedSender(
  address: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const lower = address.trim().toLowerCase();
  const own = [
    environment.INBOUND_IMAP_USER,
    environment.EMAIL_SMTP_USER,
    environment.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? environment.EMAIL_FROM,
  ].map((value) => value?.trim().toLowerCase());
  return (
    own.includes(lower) ||
    /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([+._-]|@)/.test(
      lower,
    )
  );
}

/** The figures of a past quote, as an indicative price; the customer it was for is left out. */
export function priceGuideFrom(
  suggestion: QuoteSuggestion,
): ReplyContext["priceGuide"] {
  if (!suggestion.basedOn || !suggestion.version.currency) return null;
  const { currency, sizeLabels, lines } = suggestion.version;
  const amount = (minor: number | null) =>
    minor === null ? "at cost" : formatQuoteAmount(minor, currency);
  return {
    match: suggestion.basedOn.match,
    currency,
    lines: lines.map((line) => ({
      description: line.description,
      amount: line.sizeAmountsMinor
        ? line.sizeAmountsMinor
            .map(
              (minor, index) =>
                `${sizeLabels[index] ?? `size ${index + 1}`} ${amount(minor)}`,
            )
            .join(" / ")
        : amount(line.amountMinor),
    })),
  };
}

/**
 * What happens to an emailed request once AI has read it: the assistant links
 * the sender's customer (or creates one), drafts a quote from the most similar
 * past quote, and drafts a reply. Staff check and issue the quote. The reply
 * waits for a person to press Send, unless ASSISTANT_AUTO_REPLY is on: then the
 * assistant sends it itself, with no prices in it. Each step that cannot be
 * done is noted on the request and never loses it.
 */
@Injectable()
export class EmailAssistantService {
  private readonly logger = new Logger(EmailAssistantService.name);

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(QuoteRequestsService)
    private readonly requests: QuoteRequestsService,
    @Inject(REPLY_DRAFTER) private readonly drafter: ReplyDrafter,
  ) {}

  /** Runs after a successful reading. Never throws: the email is already safe. */
  async afterReading(requestId: string): Promise<void> {
    try {
      await this.handle(requestId);
    } catch (error) {
      this.logger.error(
        `The assistant stopped on request ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.database
        .addAssistantNotes(requestId, [
          "The assistant stopped before it finished; carry on by hand.",
        ])
        .catch(() => undefined);
    }
  }

  private async handle(requestId: string): Promise<void> {
    let request = await this.database.findQuoteRequest(requestId);
    if (!request?.intake || request.intake.extractionStatus !== "done") return;
    const kind = request.intake.kind;
    // When AI could not tell what the email is, a person decides.
    if (kind === null) return;
    if (kind === "other") {
      await this.database.addAssistantNotes(requestId, [
        "No reply drafted: the email does not ask for anything.",
      ]);
      return;
    }

    const notes: string[] = [];
    if (!request.customerCompanyId) {
      request = await this.linkCustomer(request, notes);
    }
    let quoteDrafted = false;
    if (kind === "quote") {
      quoteDrafted = await this.draftQuote(request, notes);
    }
    await this.database.addAssistantNotes(requestId, notes);
    const automatic = autoReplyOn();
    if (await this.draftReply(requestId, quoteDrafted, automatic)) {
      if (automatic) await this.sendByItself(requestId);
    }
  }

  /** The customer whose contact wrote the email, or a new customer made from the email. */
  private async linkCustomer(
    request: QuoteRequestRecord,
    notes: string[],
  ): Promise<QuoteRequestRecord> {
    const known = await this.database.findCustomerByContactEmail(request.email);
    if (known) {
      notes.push(
        `Linked to ${known.companyName}: the sender is one of its contacts.`,
      );
      return (
        (await this.database.linkQuoteRequestToCustomer(
          request.id,
          known.id,
        )) ?? request
      );
    }
    const fromEmail = {
      companyName: request.companyName,
      contactName: request.contactName,
      email: request.email,
    };
    let input = parseContract(customerInputSchema, {
      ...fromEmail,
      phone: request.details.contactPhone,
    });
    // A phone number the form would refuse is left out rather than losing the customer.
    if (!input.success) input = parseContract(customerInputSchema, fromEmail);
    if (!input.success) {
      notes.push(
        `No customer created: ${input.message}. Link or create the customer by hand.`,
      );
      return request;
    }
    const createdAt = new Date().toISOString();
    const company = await this.database.createCustomer({
      id: randomUUID(),
      companyName: input.data.companyName,
      createdAt,
      contacts: [
        {
          id: randomUUID(),
          name: input.data.contactName,
          role: null,
          email: input.data.email,
          phone: input.data.phone,
          notify: true,
          isPrimary: true,
          createdAt,
        },
      ],
    });
    notes.push(
      `Created the customer ${company.companyName} with ${input.data.contactName} as contact: the sender is new. Check the name before issuing anything.`,
    );
    return (
      (await this.database.linkQuoteRequestToCustomer(
        request.id,
        company.id,
      )) ?? request
    );
  }

  /** A draft quote from the most similar past issued quote; a person checks and issues it. */
  private async draftQuote(
    request: QuoteRequestRecord,
    notes: string[],
  ): Promise<boolean> {
    const service = request.details.service;
    if (request.quoteId) return true;
    if (!request.customerCompanyId) return false;
    if (!service) {
      notes.push(
        "No quote drafted: the email does not make the service clear. Set it, then create the quote.",
      );
      return false;
    }
    const suggestion = await this.requests.quoteSuggestion(request.id, {});
    const settings = await this.database.getBusinessSettings();
    const currency =
      suggestion.version.currency || settings?.settings.currencies[0] || "";
    const parsed = parseContract(quoteCreateInputSchema, {
      customerCompanyId: request.customerCompanyId,
      serviceLine: service,
      quoteRequestId: request.id,
      version: { ...suggestion.version, currency },
    });
    if (
      !parsed.success ||
      (settings && !settings.settings.currencies.includes(currency))
    ) {
      notes.push(
        "No quote drafted: save the currencies in Business settings first.",
      );
      return false;
    }
    await this.database.createQuote(parsed.data, null);
    const label = serviceLineLabels[service].toLowerCase();
    if (!suggestion.basedOn) {
      notes.push(
        `Drafted the quote with the shipment and BJH's standard wording, but no charges: there is no issued ${label} quote to start from.`,
      );
    } else {
      const source = suggestion.basedOn.quoteNumber ?? "an earlier quote";
      notes.push(
        suggestion.basedOn.match === "same route"
          ? `Drafted the quote from ${source} (same route). Check the prices, then issue it.`
          : `Drafted the quote from ${source} (${suggestion.basedOn.match} only): remove or reprice the route charges, then issue it.`,
      );
    }
    return true;
  }

  /** Drafts (or redrafts) the reply from the email, BJH's knowledge, the sender's jobs and past pricing. */
  /** Returns whether a reply was drafted. `automatic`: it will go out unread, so no prices. */
  private async draftReply(
    requestId: string,
    quoteDrafted: boolean,
    automatic = false,
  ): Promise<boolean> {
    const request = await this.database.findQuoteRequest(requestId);
    const intake = request?.intake;
    if (!request || !intake || intake.reply?.sentAt) return false;
    let context: ReplyContext;
    try {
      context = await this.contextFor(request, quoteDrafted, automatic);
    } catch (error) {
      await this.database.addAssistantNotes(requestId, [
        `No reply drafted: ${error instanceof Error ? error.message : "the context could not be gathered"}.`,
      ]);
      return false;
    }
    try {
      const reply = await this.drafter.draft(context);
      await this.database.saveRequestReply(requestId, {
        ...reply,
        model: this.drafter.model ?? "assistant",
      });
      return true;
    } catch (error) {
      const reason =
        error instanceof ReplyDraftError
          ? error.message
          : "the AI service could not be reached";
      if (!(error instanceof ReplyDraftError)) {
        this.logger.error(
          `Drafting the reply to ${requestId} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.database.addAssistantNotes(requestId, [
        `No reply drafted: ${reason}. Write it by hand, or press Draft reply again.`,
      ]);
      return false;
    }
  }

  /** ASSISTANT_AUTO_REPLY: sends the reply just drafted, unless a person should look first. */
  private async sendByItself(requestId: string): Promise<void> {
    const request = await this.database.findQuoteRequest(requestId);
    const reply = request?.intake?.reply;
    if (!request || !reply || reply.sentAt) return;
    let held: string | null = null;
    if (automatedSender(request.email)) {
      held = "the sender looks like an automatic address or BJH's own";
    } else if (!request.customerCompanyId) {
      held = "the request has no customer";
    }
    if (held) {
      await this.database.addAssistantNotes(requestId, [
        `Reply not sent by itself: ${held}. Read it and send it if needed.`,
      ]);
      return;
    }
    await this.deliverReply(request, reply, null);
    await this.database.addAssistantNotes(requestId, [
      `Sent the reply by itself to ${request.email}.`,
    ]);
  }

  private async contextFor(
    request: QuoteRequestRecord,
    quoteDrafted: boolean,
    automatic: boolean,
  ): Promise<ReplyContext> {
    const intake = request.intake!;
    const email = await this.database.findInboundEmailBody(request.id);
    const settings = (await this.database.getBusinessSettings())?.settings;
    const kind = intake.kind ?? "inquiry";

    // Only the jobs of the company the request is linked to: never another customer's.
    const jobs: ReplyContext["jobs"] = [];
    if (request.customerCompanyId) {
      const listed = (
        await this.database.listJobs("", {
          companyIds: [request.customerCompanyId],
        })
      )
        .filter((job) => job.customerCompanyId === request.customerCompanyId)
        .slice(0, MAX_JOBS);
      for (const job of listed) {
        const [etas, references] = await Promise.all([
          this.database.listEtaEvents(job.id),
          this.database.listShipmentReferences(job.id),
        ]);
        const corrected = new Set(
          etas.map((eta) => eta.correctionOf).filter(Boolean),
        );
        const current = etas
          .filter((eta) => !corrected.has(eta.id))
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
        jobs.push({
          fileNumber: job.fileNumber,
          service: serviceLineLabels[job.serviceLine],
          status: job.status.replace(/_/g, " "),
          eta: current
            ? new Intl.DateTimeFormat("en-GH", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Africa/Accra",
              }).format(new Date(current.etaAt))
            : null,
          references: references.map((reference) => reference.value),
        });
      }
    }

    // Prices leave BJH only in a reply a person sends, or on an issued quote.
    let priceGuide: ReplyContext["priceGuide"] = null;
    if (!automatic && kind === "inquiry" && request.details.service) {
      priceGuide = priceGuideFrom(
        await this.requests.quoteSuggestion(request.id, {}),
      );
    }

    return {
      businessName: settings?.issuer.name ?? "BJH Logistics",
      email: {
        fromName: intake.fromName,
        fromEmail: intake.fromEmail,
        subject: intake.subject,
        bodyText: email ?? request.message,
      },
      kind,
      details: request.details,
      knowledge: settings?.assistant?.knowledge ?? null,
      jobs,
      priceGuide,
      quoteDrafted,
    };
  }

  /** Drafts the reply again, for instance after the details were corrected or the customer linked. */
  async redraft(
    requestId: string,
    roles: StaffRoleKey[],
  ): Promise<QuoteRequestRecord> {
    const request = await this.requireInCharge(requestId, roles);
    if (request.intake!.reply?.sentAt) {
      throw new ConflictException("The reply was already sent");
    }
    if (!this.drafter.model) {
      throw new ConflictException("AI replies are not set up");
    }
    const before = request.intake!.assistantNotes.length;
    await this.draftReply(requestId, request.quoteId !== null);
    const after = await this.database.findQuoteRequest(requestId);
    const failed = after?.intake?.assistantNotes
      .slice(before)
      .find((note) => note.startsWith("No reply drafted"));
    if (failed) throw new ConflictException(failed);
    return after!;
  }

  /** A person's edit of the reply before it is sent. */
  async saveReply(
    requestId: string,
    input: unknown,
    roles: StaffRoleKey[],
  ): Promise<QuoteRequestRecord> {
    await this.requireInCharge(requestId, roles);
    const parsed = parseContract(requestReplyInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const saved = await this.database.saveRequestReply(requestId, {
      ...parsed.data,
      model: null,
    });
    if (saved === "not_found") {
      throw new NotFoundException("Quote request was not found");
    }
    if (saved === "sent") {
      throw new ConflictException("The reply was already sent");
    }
    return saved;
  }

  /**
   * Sends the reply, as the person last wrote it, by email to the sender's
   * address only (whatever the channel setting), through the message outbox.
   * A request's reply is sent once.
   */
  async sendReply(
    requestId: string,
    input: unknown,
    sentBy: string,
    roles: StaffRoleKey[],
  ): Promise<QuoteRequestRecord> {
    const request = await this.requireInCharge(requestId, roles);
    const parsed = parseContract(requestReplyInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    if (request.intake!.reply?.sentAt) {
      throw new ConflictException("The reply was already sent");
    }
    if (!request.customerCompanyId) {
      throw new ConflictException(
        "Link the request to a customer before replying",
      );
    }
    return this.deliverReply(request, parsed.data, sentBy);
  }

  /** Queues the reply by email to the sender only, and records it as sent. `sentBy` null: the assistant. */
  private async deliverReply(
    request: QuoteRequestRecord,
    reply: { subject: string; body: string },
    sentBy: string | null,
  ): Promise<QuoteRequestRecord> {
    const customer = await this.database.findCustomer(
      request.customerCompanyId!,
    );
    const contact = customer?.contacts.find(
      (item) => item.email.toLowerCase() === request.email.toLowerCase(),
    );
    const queued = await this.database.queueNotification({
      companyId: request.customerCompanyId!,
      jobId: null,
      event: "email_reply",
      dedupeKey: `email-reply:${request.id}`,
      subject: reply.subject,
      body: reply.body,
      smsText: reply.subject.slice(0, 700),
      linkUrl: null,
      createdBy: sentBy,
      deliveries: [
        {
          contactId: contact?.id ?? null,
          channel: "email",
          recipient: request.email,
          skipReason: null,
        },
      ],
    });
    if (queued === "duplicate") {
      throw new ConflictException("The reply was already sent");
    }
    const sent = await this.database.markRequestReplySent(request.id, {
      subject: reply.subject,
      body: reply.body,
      sentBy,
      notificationId: queued.id,
    });
    if (sent === "sent") {
      throw new ConflictException("The reply was already sent");
    }
    return sent;
  }

  private async requireInCharge(
    requestId: string,
    roles: StaffRoleKey[],
  ): Promise<QuoteRequestRecord> {
    const request = await this.database.findQuoteRequest(requestId);
    if (!request) throw new NotFoundException("Quote request was not found");
    if (!request.intake) {
      throw new ConflictException("This request did not come from an email");
    }
    if (!inChargeOf(request.details, roles)) {
      throw new ForbiddenException(
        "Only the super admin or the representative in charge of this request's service can reply to it",
      );
    }
    return request;
  }
}
