import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  isUuid,
  parseContract,
  supportRequestInputSchema,
  supportRequestStatusSchema,
} from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type { SupportRequestRecord } from "../database/database.port";
import { EMAIL_PROVIDER } from "../notifications/providers";
import type { EmailProvider } from "../notifications/providers";

const kindLabels: Record<SupportRequestRecord["kind"], string> = {
  problem: "Problem",
  feature: "Feature request",
  question: "Question",
};

/** Who is sending: a staff member, or a customer with their companies. */
export interface SupportReporter {
  userId: string;
  email: string | null;
  /** Undefined for staff; the customer's companies otherwise. */
  companyIds: string[] | undefined;
}

/**
 * Support requests (Evans, 2026-11-03). Anyone signed in may send one; it is
 * saved, then emailed to `SUPPORT_EMAIL_TO` (the developer) after the reply,
 * so a mail failure never loses the request. The super admin sees them all and
 * sets the status; everyone else sees only their own.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  async create(
    reporter: SupportReporter,
    body: unknown,
  ): Promise<SupportRequestRecord> {
    const input = parseContract(supportRequestInputSchema, body);
    if (!input.success) throw new BadRequestException(input.message);
    const companyIds = reporter.companyIds;
    const saved = await this.database.createSupportRequest({
      reporterUserId: reporter.userId,
      reporterEmail: reporter.email,
      reporterKind: companyIds ? "customer" : "staff",
      companyId: companyIds?.length === 1 ? companyIds[0] : null,
      ...input.data,
    });
    void this.notify(saved).catch((error: unknown) => {
      this.logger.error(
        `Support request ${saved.id} could not be emailed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    });
    return saved;
  }

  mine(userId: string): Promise<SupportRequestRecord[]> {
    return this.database.listSupportRequests(userId);
  }

  all(): Promise<SupportRequestRecord[]> {
    return this.database.listSupportRequests();
  }

  async setStatus(id: string, body: unknown): Promise<SupportRequestRecord> {
    if (!isUuid(id)) throw new NotFoundException("Support request not found");
    const input = parseContract(supportRequestStatusSchema, body);
    if (!input.success) throw new BadRequestException(input.message);
    const updated = await this.database.setSupportRequestStatus(
      id,
      input.data.status,
    );
    if (!updated) throw new NotFoundException("Support request not found");
    return updated;
  }

  private async notify(request: SupportRequestRecord) {
    const to = process.env.SUPPORT_EMAIL_TO?.trim();
    if (!to) {
      this.logger.warn(
        `Support request ${request.id} saved; SUPPORT_EMAIL_TO is not set, so nobody was emailed`,
      );
      return;
    }
    const from =
      request.reporterKind === "customer"
        ? `Customer${request.companyName ? ` (${request.companyName})` : ""}`
        : "Staff";
    await this.email.send({
      to,
      subject: `[BJH support] ${kindLabels[request.kind]} from ${
        request.reporterEmail ?? "a user"
      }`,
      text: [
        `${kindLabels[request.kind]} sent from the BJH Logistics app.`,
        "",
        `From: ${request.reporterEmail ?? "unknown"} — ${from}`,
        `Page: ${request.pagePath ?? "not given"}`,
        `Time: ${request.createdAt}`,
        `Browser: ${request.userAgent ?? "not given"}`,
        `Last error shown: ${request.lastError ?? "none"}`,
        `Request ID: ${request.id}`,
        "",
        request.description,
      ].join("\n"),
    });
  }
}
