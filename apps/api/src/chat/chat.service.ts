import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { chatMessageInputSchema, isUuid, parseContract } from "@bjh/contracts";
import {
  ChatMessageRecord,
  ChatThreadRecord,
  CustomerCompanyRecord,
  DatabasePort,
} from "../database/database.port";
import { chatMessage } from "../notifications/notification-messages";
import { NotificationsService } from "../notifications/notifications.service";

/** `[Chat CUS-0012]` in a subject: which client conversation an email belongs to. */
const TAG_PATTERN = /\[Chat (CUS-\d+)\]/i;

export const chatTag = (customerNumber: string | null) =>
  customerNumber ? `[Chat ${customerNumber}]` : null;

/**
 * The client's own words from an emailed reply: everything above the quoted
 * earlier message ("On ... wrote:", "-----Original Message-----", "> ...").
 */
export function replyText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (
      /^On .+wrote:\s*$/.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      /^From: .+/.test(line.trim()) ||
      line.startsWith(">")
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/**
 * One conversation per client company (client meeting, 2026-11-01). Customer
 * service writes; the client writes in the portal or answers by email. A
 * staff message shows in the portal and is emailed (and texted, per the
 * channel setting) to the client's contacts.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  threads(): Promise<ChatThreadRecord[]> {
    return this.database.listChatThreads();
  }

  /** Opening a conversation marks the client's messages read. */
  async thread(companyId: string) {
    const company = await this.company(companyId);
    const messages = await this.database.listChatMessages(company.id);
    await this.database.markChatRead(company.id, "from_client");
    return { company: this.companySummary(company), messages };
  }

  async reply(
    companyId: string,
    input: unknown,
    author: { userId: string; email: string | null },
  ): Promise<ChatMessageRecord> {
    const company = await this.company(companyId);
    const { body, jobId } = this.parse(input);
    await this.checkJob(jobId, company.id);
    const message = await this.database.addChatMessage({
      companyId: company.id,
      direction: "to_client",
      channel: "portal",
      body,
      authorUserId: author.userId,
      authorName: author.email,
      emailFrom: null,
      jobId,
    });
    await this.notifications.notify({
      companyId: company.id,
      jobId,
      event: "chat_message",
      dedupeKey: `chat:${message.id}`,
      message: (sender) =>
        chatMessage(sender, chatTag(company.customerNumber ?? null), body),
      linkPath: "/portal/messages",
      createdBy: author.userId,
    });
    return message;
  }

  /** A customer's conversation; with several companies they name one. */
  async mine(companyIds: string[] | undefined, companyId: unknown) {
    const company = await this.ownCompany(companyIds, companyId);
    const messages = await this.database.listChatMessages(company.id);
    await this.database.markChatRead(company.id, "to_client");
    return { company: this.companySummary(company), messages };
  }

  async sendMine(
    input: unknown,
    user: { userId: string; email: string | null },
    companyIds: string[] | undefined,
  ): Promise<ChatMessageRecord> {
    const { body, jobId, companyId } = this.parse(input);
    const company = await this.ownCompany(companyIds, companyId ?? undefined);
    await this.checkJob(jobId, company.id);
    return this.database.addChatMessage({
      companyId: company.id,
      direction: "from_client",
      channel: "portal",
      body,
      authorUserId: user.userId,
      authorName: user.email,
      emailFrom: null,
      jobId,
    });
  }

  /**
   * Adds an emailed reply to its conversation when the subject carries a chat
   * tag and the sender is one of that company's contacts. Returns false
   * otherwise, so the email goes through the normal intake.
   */
  async receiveEmail(email: {
    subject: string;
    fromEmail: string;
    fromName: string;
    text: string;
  }): Promise<boolean> {
    const customerNumber = TAG_PATTERN.exec(email.subject)?.[1];
    if (!customerNumber) return false;
    const companyId =
      await this.database.findCompanyByCustomerNumber(customerNumber);
    const company = companyId
      ? await this.database.findCustomer(companyId)
      : null;
    if (!company) return false;
    const sender = email.fromEmail.trim().toLowerCase();
    const known = [
      ...company.contacts.map((contact) => contact.email),
      company.companyEmail ?? "",
    ].some((address) => address.trim().toLowerCase() === sender);
    if (!known) return false;
    const body = (replyText(email.text) || "(The email had no text)").slice(
      0,
      5000,
    );
    await this.database.addChatMessage({
      companyId: company.id,
      direction: "from_client",
      channel: "email",
      body,
      authorUserId: null,
      authorName: email.fromName || null,
      emailFrom: sender,
      jobId: null,
    });
    return true;
  }

  private parse(input: unknown) {
    const parsed = parseContract(chatMessageInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    return parsed.data;
  }

  private async company(companyId: string): Promise<CustomerCompanyRecord> {
    const company = isUuid(companyId)
      ? await this.database.findCustomer(companyId)
      : null;
    if (!company) throw new NotFoundException("Customer company was not found");
    return company;
  }

  private async ownCompany(
    companyIds: string[] | undefined,
    companyId: unknown,
  ): Promise<CustomerCompanyRecord> {
    if (!companyIds) {
      throw new ForbiddenException(
        "Only a customer account has its own messages",
      );
    }
    const chosen =
      typeof companyId === "string" && companyId
        ? companyId
        : companyIds.length === 1
          ? companyIds[0]
          : null;
    if (!chosen) {
      throw new BadRequestException(
        "companyId is required: this account belongs to several companies",
      );
    }
    if (!companyIds.includes(chosen)) {
      throw new NotFoundException("Customer company was not found");
    }
    return this.company(chosen);
  }

  private async checkJob(jobId: string | null, companyId: string) {
    if (!jobId) return;
    const job = await this.database.findJob(jobId, { companyIds: [companyId] });
    if (!job) throw new NotFoundException("Job was not found for this client");
  }

  private companySummary(company: CustomerCompanyRecord) {
    return {
      id: company.id,
      companyName: company.companyName,
      customerNumber: company.customerNumber ?? null,
    };
  }
}
