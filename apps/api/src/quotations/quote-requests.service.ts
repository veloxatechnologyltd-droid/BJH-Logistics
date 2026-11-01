import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isUuid,
  parseContract,
  portalQuoteRequestInputSchema,
  quoteRequestInputSchema,
  requestDetailsSchema,
  type QuoteRequestInput,
} from "@bjh/contracts";
import { randomUUID } from "node:crypto";
import {
  DatabasePort,
  JobScope,
  QuoteRequestRecord,
  StaffRoleKey,
} from "../database/database.port";
import { inChargeOf } from "../intake/inbound-email.service";
import { suggestQuote } from "./quote-suggestion";
import type { PastQuote, QuoteSuggestion } from "./quote-suggestion";

/** How many recent quotes of the service are compared with a request. */
const SUGGESTION_CANDIDATES = 40;

/**
 * A customer sees their own request as they wrote it: what was read from an
 * email, and the email itself, are for staff. The request's quote is also
 * staff-only until it is issued, so a draft is not revealed.
 */
function forCustomer(request: QuoteRequestRecord): QuoteRequestRecord {
  const issued = request.quoteStatus === "issued";
  return {
    ...request,
    // How a request reached BJH is for staff, like the rest of what intake read.
    source: null,
    details: requestDetailsSchema.parse({}),
    intake: null,
    quoteId: issued ? request.quoteId : null,
    quoteNumber: issued ? request.quoteNumber : null,
    quoteStatus: issued ? request.quoteStatus : null,
  };
}

@Injectable()
export class QuoteRequestsService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  async create(input: unknown): Promise<QuoteRequestRecord> {
    const details = this.validate(input);

    return this.database.createQuoteRequest({
      id: randomUUID(),
      ...details,
      createdAt: new Date().toISOString(),
      source: "staff",
      customerCompanyId: null,
      customerCompanyName: null,
      quoteId: null,
      quoteNumber: null,
      quoteStatus: null,
    });
  }

  /**
   * A customer's own request. The company comes from the customer's linked
   * companies (the account's identity, not a typed name), so it is linked at
   * once; the contact email is the account's email.
   */
  async createForCustomer(
    input: unknown,
    user: { email: string | null },
    allowedCompanyIds: string[] | undefined,
  ): Promise<QuoteRequestRecord> {
    if (!allowedCompanyIds) {
      throw new ForbiddenException(
        "Only a customer account can send its own quote request",
      );
    }
    if (!user.email) {
      throw new BadRequestException("The account has no email address");
    }
    const parsed = parseContract(portalQuoteRequestInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const companyId =
      parsed.data.companyId ??
      (allowedCompanyIds.length === 1 ? allowedCompanyIds[0] : null);
    if (!companyId) {
      throw new BadRequestException(
        "companyId is required: this account belongs to several companies",
      );
    }
    if (!allowedCompanyIds.includes(companyId)) {
      throw new NotFoundException("Customer company was not found");
    }
    const company = await this.database.findCustomer(companyId);
    if (!company) throw new NotFoundException("Customer company was not found");
    const created = await this.database.createQuoteRequest({
      id: randomUUID(),
      companyName: company.companyName,
      contactName: parsed.data.contactName,
      email: user.email,
      message: parsed.data.message,
      createdAt: new Date().toISOString(),
      source: "portal",
      customerCompanyId: null,
      customerCompanyName: null,
      quoteId: null,
      quoteNumber: null,
      quoteStatus: null,
    });
    const linked = await this.database.linkQuoteRequestToCustomer(
      created.id,
      company.id,
    );
    return forCustomer(linked ?? created);
  }

  /** One inbox: quote requests unless staff ask for inquiries. Customers only ever see their quote requests. */
  list(
    customerCompanyId?: unknown,
    allowedCompanyIds?: string[],
    mailbox?: unknown,
  ): Promise<QuoteRequestRecord[]> {
    if (
      customerCompanyId !== undefined &&
      typeof customerCompanyId !== "string"
    ) {
      throw new BadRequestException("customerCompanyId must be a string");
    }
    if (
      mailbox !== undefined &&
      mailbox !== "quotes" &&
      mailbox !== "inquiries"
    ) {
      throw new BadRequestException("mailbox must be quotes or inquiries");
    }

    return this.database
      .listQuoteRequests(
        customerCompanyId,
        allowedCompanyIds,
        allowedCompanyIds ? "quotes" : (mailbox ?? "quotes"),
      )
      .then((requests) =>
        allowedCompanyIds ? requests.map(forCustomer) : requests,
      );
  }

  /**
   * A starting draft for the request's quote: the shipment described from the
   * request, and the charges, prices and wording of the most similar past
   * issued quote the caller may see (same service; same route or destination
   * first). Nothing is saved.
   */
  async quoteSuggestion(id: string, scope: JobScope): Promise<QuoteSuggestion> {
    const request = isUuid(id)
      ? await this.database.findQuoteRequest(id)
      : null;
    if (!request) throw new NotFoundException("Quote request was not found");
    const service = request.details.service;
    if (!service) {
      throw new BadRequestException(
        "Set the request's service before preparing its quote",
      );
    }
    if (scope.serviceLines && !scope.serviceLines.includes(service)) {
      throw new ForbiddenException(
        "Only the representative for this request's service or the super admin can prepare its quote",
      );
    }
    const recent = (await this.database.listQuotes(scope))
      .filter((quote) => quote.serviceLine === service)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, SUGGESTION_CANDIDATES);
    const candidates: PastQuote[] = [];
    for (const summary of recent) {
      const quote = await this.database.findQuote(summary.id, scope);
      const version = quote?.versions
        .filter((item) => item.status === "issued")
        .sort((a, b) => b.versionNumber - a.versionNumber)[0];
      if (!version) continue;
      const answered = summary.quoteRequestId
        ? await this.database.findQuoteRequest(summary.quoteRequestId)
        : null;
      candidates.push({
        quote: summary,
        version,
        requestDetails: answered?.details ?? null,
      });
    }
    const settings = await this.database.getBusinessSettings();
    return suggestQuote(
      request.details,
      service,
      candidates,
      settings?.settings.quoteDefaults ?? null,
    );
  }

  /**
   * For an email request, staff also learn whether they may check its details,
   * and, while it is unlinked, get the customer whose contact has the sender's
   * exact email address, to link in one click.
   */
  async get(
    id: string,
    allowedCompanyIds?: string[],
    roles: StaffRoleKey[] = [],
  ): Promise<
    QuoteRequestRecord & {
      canCheck?: boolean;
      suggestedCustomer?: { id: string; companyName: string } | null;
    }
  > {
    const request = await this.database.findQuoteRequest(id, allowedCompanyIds);
    // Inquiries are staff work; a customer never sees one, even their own.
    if (!request || (allowedCompanyIds && request.mailbox === "inquiries")) {
      throw new NotFoundException("Quote request was not found");
    }
    if (allowedCompanyIds) return forCustomer(request);
    if (!request.intake) return request;
    const canCheck = inChargeOf(request, roles);
    if (request.customerCompanyId) return { ...request, canCheck };
    return {
      ...request,
      canCheck,
      suggestedCustomer: await this.database.findCustomerByContactEmail(
        request.email,
      ),
    };
  }

  async associateCustomer(
    requestId: string,
    input: unknown,
  ): Promise<QuoteRequestRecord> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException("A customer company ID is required");
    }

    const customerCompanyId = (input as Record<string, unknown>)
      .customerCompanyId;
    if (typeof customerCompanyId !== "string" || !customerCompanyId.trim()) {
      throw new BadRequestException("customerCompanyId is required");
    }

    const customer = await this.database.findCustomer(customerCompanyId);
    if (!customer) {
      throw new NotFoundException("Customer company was not found");
    }

    const request = await this.database.linkQuoteRequestToCustomer(
      requestId,
      customer.id,
    );
    if (!request) {
      throw new NotFoundException("Quote request was not found");
    }

    return request;
  }

  private validate(input: unknown): QuoteRequestInput {
    const result = parseContract(quoteRequestInputSchema, input);
    if (!result.success) throw new BadRequestException(result.message);
    return result.data;
  }
}
