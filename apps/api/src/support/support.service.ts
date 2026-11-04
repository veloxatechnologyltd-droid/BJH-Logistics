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
  supportReplyInputSchema,
  supportRequestInputSchema,
  supportRequestStatusSchema,
} from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type { SupportRequestRecord } from "../database/database.port";
import { publicWebUrl } from "../notifications/notifications.service";
import { EMAIL_PROVIDER } from "../notifications/providers";
import type { EmailProvider } from "../notifications/providers";
import { PushService } from "../push/push.service";

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
 * so a mail failure never loses the request. The super admin sees them all,
 * sets the status and replies; everyone else sees only their own and may write
 * back (Evans, 2026-11-04: a request is a ticket with a conversation). A reply
 * is saved first and emailed after, so a mail failure never loses it.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(PushService) private readonly push: PushService,
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
    void this.tellSupport(
      saved,
      `New ${kindLabels[saved.kind].toLowerCase()}`,
      saved.description,
      reporter.userId,
    );
    return saved;
  }

  /** The super admin hears of a new ticket or a reply, with BJH closed (Evans, 2026-11-04). */
  private tellSupport(
    request: SupportRequestRecord,
    title: string,
    text: string,
    writerUserId: string,
  ) {
    const preview = text.replace(/\s+/g, " ").trim();
    return this.push.notify(
      { roles: ["super_admin"], exceptUserId: writerUserId },
      {
        title,
        body: preview.length > 100 ? `${preview.slice(0, 99)}…` : preview,
        url: "/settings/support",
        tag: `support:${request.id}`,
      },
    );
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

  /** The super admin answers a ticket; the person who sent it is emailed. */
  async replyAsSupport(
    adminUserId: string,
    id: string,
    body: unknown,
  ): Promise<SupportRequestRecord> {
    const updated = await this.saveReply(id, adminUserId, "support", body);
    // Staff who sent it are told on their device too; a customer has no
    // subscription, so only the email reaches them.
    void this.push.notify(
      { userIds: [updated.reporterUserId], exceptUserId: adminUserId },
      {
        title: "BJH support replied",
        body: updated.messages[updated.messages.length - 1].body.slice(0, 100),
        url: "/",
        tag: `support:${updated.id}`,
      },
    );
    void this.notifyReporter(updated).catch((error: unknown) => {
      this.logger.error(
        `Reply on support request ${id} could not be emailed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    });
    return updated;
  }

  /**
   * The person who sent a ticket writes again. Only their own: anyone else's
   * ticket answers "not found", so its existence is not revealed.
   */
  async replyAsReporter(
    userId: string,
    id: string,
    body: unknown,
  ): Promise<SupportRequestRecord> {
    if (!isUuid(id)) throw new NotFoundException("Support request not found");
    const existing = await this.database.findSupportRequest(id);
    if (!existing || existing.reporterUserId !== userId) {
      throw new NotFoundException("Support request not found");
    }
    const updated = await this.saveReply(id, userId, "reporter", body);
    const latest = updated.messages[updated.messages.length - 1];
    void this.tellSupport(
      updated,
      "Reply on a support request",
      latest.body,
      userId,
    );
    void this.emailDeveloper(
      updated,
      `[BJH support] Reply from ${updated.reporterEmail ?? "a user"}`,
      [
        `${updated.reporterEmail ?? "A user"} replied on their ${kindLabels[updated.kind].toLowerCase()}.`,
        `Request ID: ${updated.id}`,
        "",
        latest.body,
      ].join("\n"),
    ).catch((error: unknown) => {
      this.logger.error(
        `Reply on support request ${id} could not be emailed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    });
    return updated;
  }

  private async saveReply(
    id: string,
    authorUserId: string,
    authorRole: "support" | "reporter",
    body: unknown,
  ): Promise<SupportRequestRecord> {
    if (!isUuid(id)) throw new NotFoundException("Support request not found");
    const input = parseContract(supportReplyInputSchema, body);
    if (!input.success) throw new BadRequestException(input.message);
    const updated = await this.database.addSupportMessage(id, {
      authorUserId,
      authorRole,
      body: input.data.body,
    });
    if (!updated) throw new NotFoundException("Support request not found");
    return updated;
  }

  private async notifyReporter(request: SupportRequestRecord) {
    if (!request.reporterEmail) return;
    const latest = request.messages[request.messages.length - 1];
    await this.email.send({
      to: request.reporterEmail,
      subject: `BJH Logistics support replied to your ${kindLabels[request.kind].toLowerCase()}`,
      text: [
        `BJH Logistics support has replied to your ${kindLabels[request.kind].toLowerCase()}.`,
        "",
        latest.body,
        "",
        `Your message: ${request.description.slice(0, 300)}${request.description.length > 300 ? "…" : ""}`,
        "",
        `To answer, sign in and choose Get help: ${publicWebUrl()}`,
      ].join("\n"),
    });
  }

  /** Emails the developer, if `SUPPORT_EMAIL_TO` is set; the ticket is saved either way. */
  private async emailDeveloper(
    request: SupportRequestRecord,
    subject: string,
    text: string,
  ) {
    const to = process.env.SUPPORT_EMAIL_TO?.trim();
    if (!to) {
      this.logger.warn(
        `Support request ${request.id} saved; SUPPORT_EMAIL_TO is not set, so nobody was emailed`,
      );
      return;
    }
    await this.email.send({ to, subject, text });
  }

  private async notify(request: SupportRequestRecord) {
    const from =
      request.reporterKind === "customer"
        ? `Customer${request.companyName ? ` (${request.companyName})` : ""}`
        : "Staff";
    await this.emailDeveloper(
      request,
      `[BJH support] ${kindLabels[request.kind]} from ${
        request.reporterEmail ?? "a user"
      }`,
      [
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
    );
  }
}
