import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { AddressObject, ParsedMail } from "mailparser";
import { isUuid } from "@bjh/contracts";
import { emailAuthentication } from "../intake/email-authentication";
import { DatabasePort } from "../database/database.port";
import {
  DOCUMENT_STORAGE,
  SIGNED_URL_SECONDS,
} from "../documents/document-storage.port";
import type { DocumentStorage } from "../documents/document-storage.port";
import { sanitizeFilename } from "../documents/file-signature";
import { crmRoles } from "../auth/auth.guards";
import { OUTREACH_EMAIL_PROVIDER } from "../notifications/providers";
import type { EmailProvider } from "../notifications/providers";
import { MAILBOX_ALERTS } from "../notifications/mailbox-alerts";
import type { MailboxAlerts } from "../notifications/mailbox-alerts";
import type { SalesEmailFilter, SalesEmailMessage } from "./sales";
import type { OutreachDraftRecord } from "./sales";
import {
  salesUnsubscribeSetup,
  salesUnsubscribeToken,
} from "./sales-unsubscribe";

const MAX_SALES_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_SALES_MESSAGE_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export interface SalesMailboxSetup {
  host: string;
  port: number;
  user: string;
  password: string;
}

export function salesMailboxFromEnvironment(
  environment: NodeJS.ProcessEnv,
): SalesMailboxSetup | null {
  const host = environment.INBOUND_OUTREACH_IMAP_HOST?.trim();
  const user = environment.INBOUND_OUTREACH_IMAP_USER?.trim();
  const password = environment.INBOUND_OUTREACH_IMAP_PASSWORD;
  if (!host || !user || !password) return null;
  const port = Number(environment.INBOUND_OUTREACH_IMAP_PORT ?? 993);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return {
    host,
    port,
    user,
    password,
  };
}

function safeMailboxErrorCode(error: unknown) {
  const code =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && /^[A-Z0-9_-]{1,50}$/.test(code)
    ? code
    : "IMAP_ERROR";
}

/** PostgreSQL refuses NUL characters in text and JSON; one such message must not stop the sync. */
function clean(value: string) {
  return value.split("\u0000").join("");
}

function addresses(value: AddressObject | AddressObject[] | undefined) {
  const groups = value ? (Array.isArray(value) ? value : [value]) : [];
  return groups.flatMap((group) =>
    group.value.flatMap((address) =>
      address.address
        ? [
            {
              name: address.name ? clean(address.name) : null,
              email: clean(address.address),
            },
          ]
        : [],
    ),
  );
}

export function salesEmailFromParsed(
  mail: ParsedMail,
  folder: string,
  uidValidity: string,
  uid: number,
  mailboxUser: string,
  receivedAt: Date,
) {
  const from = addresses(mail.from)[0];
  const referencesHeader = mail.headers.get("references");
  const referencesText = Array.isArray(referencesHeader)
    ? referencesHeader.join(" ")
    : String(referencesHeader ?? "");
  const direction =
    from?.email.toLowerCase() === mailboxUser.toLowerCase()
      ? "outgoing"
      : "incoming";
  // The table limits a sender address to 3-254 characters and a subject to
  // 1000; mail from the open internet can break either, so fit it here.
  const fromEmail = from?.email ?? mailboxUser;
  return {
    folder,
    uidValidity,
    uid,
    messageId: mail.messageId ? clean(mail.messageId) : null,
    inReplyTo: mail.inReplyTo ? clean(mail.inReplyTo) : null,
    references: clean(referencesText).match(/<[^>]+>/g) ?? [],
    direction: direction as "incoming" | "outgoing",
    fromName: from?.name ?? null,
    fromEmail:
      fromEmail.length >= 3 && fromEmail.length <= 254
        ? fromEmail
        : "unknown@invalid",
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: clean(mail.subject ?? "").slice(0, 1000),
    body: clean(mail.text ?? "").slice(0, 500_000),
    receivedAt: receivedAt.toISOString(),
  };
}

export interface SalesMailboxSyncResult {
  folders: number;
  checked: number;
  imported: number;
}

export function salesSendFailure(error: unknown, providerName: string) {
  if (providerName === "stub") {
    return { status: "failed" as const, bounce: false };
  }
  if (!error || typeof error !== "object") {
    return { status: "unknown" as const, bounce: false };
  }
  const smtpError = error as {
    command?: unknown;
    permanent?: unknown;
    responseCode?: unknown;
    response?: unknown;
  };
  const hasResponse = Number.isInteger(smtpError.responseCode);
  // An enhanced status 5.7.x means the server refused us (sender reputation,
  // policy, authentication), not that the address is bad, so the recipient
  // must not be suppressed for it.
  const refusedForPolicy =
    typeof smtpError.response === "string" &&
    /\b5\.7\.\d{1,3}\b/.test(smtpError.response);
  const permanentRecipientRejection =
    smtpError.permanent === true &&
    !refusedForPolicy &&
    typeof smtpError.command === "string" &&
    /^RCPT TO\b/i.test(smtpError.command);
  return {
    status: hasResponse ? ("failed" as const) : ("unknown" as const),
    bounce: permanentRecipientRejection,
  };
}

export function salesMessageBodyWithUnsubscribe(
  body: string,
  baseUrl: string,
  unsubscribeUrl: string,
) {
  const footer = "\n\nTo stop sales emails: ";
  const footerIndex = body.lastIndexOf(footer);
  if (footerIndex >= 0) {
    const previousUrl = body.slice(footerIndex + footer.length);
    const prefix = `${baseUrl}/v1/sales/unsubscribe/`;
    if (
      previousUrl.startsWith(prefix) &&
      /^[A-Za-z0-9_-]{38,700}$/.test(previousUrl.slice(prefix.length))
    ) {
      body = body.slice(0, footerIndex);
    }
  }
  return `${body}${footer}${unsubscribeUrl}`;
}

export async function parseSalesMailboxSource(source: Buffer | undefined) {
  if (!source) {
    throw new Error("A fetched sales mailbox message had no source");
  }
  return simpleParser(source);
}

/** Only a verified sender can suppress an address by replying STOP. */
export function salesUnsubscribeReply(
  mail: ParsedMail,
  mailboxUser: string,
): string | null {
  const from = addresses(mail.from)[0]?.email;
  if (!from || from.toLowerCase() === mailboxUser.toLowerCase()) return null;
  if (!/^(stop|unsubscribe|remove me)[.!]?$/i.test((mail.text ?? "").trim())) {
    return null;
  }
  const result = mail.headers.get("authentication-results") as
    string | string[] | undefined;
  return emailAuthentication(result, from) === "pass" ? from : null;
}

export async function storeSalesEmailAttachments(
  emailId: string,
  attachments: ParsedMail["attachments"],
  database: Pick<
    DatabasePort,
    "hasSalesEmailAttachment" | "saveSalesEmailAttachment"
  >,
  storage: DocumentStorage,
) {
  let totalBytes = 0;
  for (const [partIndex, attachment] of attachments.entries()) {
    const bytes = attachment.content;
    const sizeBytes = bytes.length;
    totalBytes += sizeBytes;
    if (await database.hasSalesEmailAttachment(emailId, partIndex)) continue;
    const canStore =
      sizeBytes <= MAX_SALES_ATTACHMENT_BYTES &&
      totalBytes <= MAX_SALES_MESSAGE_ATTACHMENT_BYTES;
    const objectKey = canStore
      ? `sales-email/${emailId}/${randomUUID()}`
      : null;
    if (objectKey)
      await storage.put(objectKey, bytes, "application/octet-stream");
    await database.saveSalesEmailAttachment({
      id: randomUUID(),
      emailId,
      partIndex,
      filename: sanitizeFilename(
        attachment.filename || `attachment-${partIndex + 1}`,
      ),
      sizeBytes,
      objectKey,
    });
  }
}

/** Read-only sync for the dedicated sales mailbox; it never marks mail read or changes folders. */
@Injectable()
export class SalesMailboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SalesMailboxService.name);
  private mailboxTimer: NodeJS.Timeout | undefined;
  private sendTimer: NodeJS.Timeout | undefined;
  private running: Promise<SalesMailboxSyncResult> | null = null;
  private sending: Promise<number> | null = null;

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(OUTREACH_EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Optional()
    @Inject(MAILBOX_ALERTS)
    private readonly alerts?: MailboxAlerts,
  ) {}

  onModuleInit() {
    if (process.env.NODE_TEST_CONTEXT !== undefined) return;
    // CRM_ACCESS=off stops the background mail work as well as the pages.
    if (crmRoles().length === 0) return;
    if (
      process.env.OUTREACH_MAILBOX_SYNC === "on" &&
      salesMailboxFromEnvironment(process.env)
    ) {
      const interval = Number(
        process.env.OUTREACH_MAILBOX_SYNC_INTERVAL_MS ?? 60_000,
      );
      this.mailboxTimer = setInterval(
        () => void this.sync().catch(() => undefined),
        interval,
      );
      this.mailboxTimer.unref();
    }
    if (process.env.OUTREACH_SEND_WORKER === "on") {
      const interval = Number(process.env.OUTREACH_SEND_INTERVAL_MS ?? 5_000);
      this.sendTimer = setInterval(
        () => void this.dispatchQueued().catch(() => undefined),
        interval,
      );
      this.sendTimer.unref();
    }
  }

  onModuleDestroy() {
    if (this.mailboxTimer) clearInterval(this.mailboxTimer);
    if (this.sendTimer) clearInterval(this.sendTimer);
  }

  list(filter: SalesEmailFilter): Promise<{
    items: SalesEmailMessage[];
    total: number;
  }> {
    return this.database.listSalesEmailMessages(filter);
  }

  folders(): Promise<string[]> {
    return this.database.listSalesEmailFolders();
  }

  async detail(id: string) {
    if (!isUuid(id)) throw new BadRequestException("Invalid message ID");
    const message = await this.database.findSalesEmailMessage(id);
    if (!message) throw new NotFoundException("Message not found");
    return {
      ...message,
      attachments: await this.database.listSalesEmailAttachments(id),
      senderSuppressed:
        message.direction === "incoming" &&
        (await this.database.listSuppressedSalesEmails([message.fromEmail]))
          .length > 0,
    };
  }

  async suppressSender(id: string) {
    if (!isUuid(id)) throw new BadRequestException("Invalid message ID");
    const message = await this.database.findSalesEmailMessage(id);
    if (!message) throw new NotFoundException("Message not found");
    if (message.direction !== "incoming") {
      throw new BadRequestException("Choose an incoming message");
    }
    await this.database.suppressSalesEmail({
      email: message.fromEmail,
      reason: "unsubscribe",
    });
    return { email: message.fromEmail, suppressed: true };
  }

  async retry(id: string) {
    if (!isUuid(id)) throw new BadRequestException("Invalid message ID");
    const result = await this.database.retrySalesEmailMessage(id);
    if (result === "suppressed") {
      throw new ConflictException("Recipient is suppressed from sales emails");
    }
    if (result === "not_failed") {
      throw new ConflictException("Only a failed message can be retried");
    }
    return { queued: true };
  }

  async attachmentDownload(messageId: string, attachmentId: string) {
    if (!isUuid(messageId) || !isUuid(attachmentId)) {
      throw new BadRequestException("Invalid attachment ID");
    }
    const attachment = await this.database.findSalesEmailAttachment(
      messageId,
      attachmentId,
    );
    if (!attachment || !attachment.objectKey)
      throw new NotFoundException("Attachment not available");
    return {
      url: await this.storage.createSignedUrl(
        attachment.objectKey,
        SIGNED_URL_SECONDS,
      ),
      expiresInSeconds: SIGNED_URL_SECONDS,
      filename: attachment.filename,
    };
  }

  async thread(id: string) {
    if (!isUuid(id)) throw new BadRequestException("Invalid message ID");
    if (!(await this.database.findSalesEmailMessage(id))) {
      throw new NotFoundException("Message not found");
    }
    return this.database.listSalesEmailThread(id);
  }

  listFromQuery(query: Record<string, unknown>) {
    const text = (key: string) => {
      const value = query[key];
      if (value === undefined || value === "") return undefined;
      if (typeof value !== "string") {
        throw new BadRequestException(`${key} must be a single value`);
      }
      return value;
    };
    const whole = (key: string, fallback: number, max: number) => {
      const value = text(key);
      if (value === undefined) return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
        throw new BadRequestException(`${key} is out of range`);
      }
      return parsed;
    };
    const folder = text("folder")?.trim();
    const search = text("search")?.trim();
    if (folder && folder.length > 500) {
      throw new BadRequestException("folder is too long");
    }
    if (search && search.length > 200) {
      throw new BadRequestException("search is too long");
    }
    return this.list({
      folder,
      search: search || undefined,
      limit: whole("limit", 50, 100) || 50,
      offset: whole("offset", 0, 1_000_000),
    });
  }

  async previewComposition(input: unknown) {
    const parsed = this.parseComposition(input);
    if (parsed.replyToMessageId) await this.replyTarget(parsed);
    const campaignEmails = await this.database.listCampaignRecipientEmails(
      parsed.campaignIds,
    );
    const recipients = [
      ...new Set(
        [...parsed.emails, ...campaignEmails].map((email) =>
          email.toLowerCase(),
        ),
      ),
    ];
    if (recipients.length > 500) {
      throw new BadRequestException(
        "A broadcast can include at most 500 recipients",
      );
    }
    const suppressed =
      await this.database.listSuppressedSalesEmails(recipients);
    return {
      subject: parsed.subject,
      recipients: recipients.filter((email) => !suppressed.includes(email)),
      suppressed,
    };
  }

  async queueComposition(input: unknown, userId: string) {
    const parsed = this.parseComposition(input);
    const data = input as Record<string, unknown>;
    const requestId = data.sendRequestId;
    if (typeof requestId !== "string" || !isUuid(requestId)) {
      throw new BadRequestException("Send request ID is required");
    }
    const expectedValue = data.expectedRecipients;
    if (
      !Array.isArray(expectedValue) ||
      expectedValue.some((email) => typeof email !== "string")
    ) {
      throw new BadRequestException("Preview the recipients before sending");
    }
    const expected = [
      ...new Set(expectedValue.map((email) => String(email).toLowerCase())),
    ].sort();
    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ userId, parsed, expected }))
      .digest("hex");
    const prior = await this.database.findSalesEmailSendRequest(requestId);
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        throw new ConflictException(
          "This send request ID was used for another message",
        );
      }
      return { queued: prior.queued, suppressed: prior.suppressed };
    }
    const preview = await this.previewComposition(input);
    const replyTarget = parsed.replyToMessageId
      ? await this.replyTarget(parsed)
      : null;
    if (
      JSON.stringify(expected) !==
      JSON.stringify([...preview.recipients].sort())
    ) {
      throw new ConflictException(
        "The recipient list changed. Preview it again before sending.",
      );
    }
    if (preview.recipients.length === 0) {
      throw new BadRequestException("There are no eligible email recipients");
    }
    const from =
      process.env.EMAIL_OUTREACH_FROM?.match(/<([^>]+)>/)?.[1] ??
      process.env.EMAIL_OUTREACH_SMTP_USER?.trim() ??
      "sales@bjhlogistics.com";
    const sends = preview.recipients.map((recipientEmail) => ({
      id: randomUUID(),
      fromEmail: from,
      recipientEmail,
      subject: parsed.subject,
      body: parsed.body,
      campaignIds: parsed.campaignIds,
      createdBy: userId,
      inReplyTo: replyTarget?.messageId ?? undefined,
      references: replyTarget
        ? [...replyTarget.references, replyTarget.messageId!]
        : undefined,
    }));
    const result = await this.database.queueSalesEmailComposition({
      requestId,
      payloadHash,
      createdBy: userId,
      initialSuppressed: preview.suppressed.length,
      sends,
    });
    if (result.payloadHash !== payloadHash) {
      throw new ConflictException(
        "This send request ID was used for another message",
      );
    }
    return { queued: result.queued, suppressed: result.suppressed };
  }

  async queueApprovedDraft(draft: OutreachDraftRecord, userId: string) {
    if (draft.status !== "approved") {
      throw new ConflictException("Only an approved draft can be queued");
    }
    const from =
      process.env.EMAIL_OUTREACH_FROM?.match(/<([^>]+)>/)?.[1] ??
      process.env.EMAIL_OUTREACH_SMTP_USER?.trim() ??
      "sales@bjhlogistics.com";
    const result = await this.database.queueSalesEmailMessage({
      id: randomUUID(),
      draftId: draft.id,
      fromEmail: from,
      recipientEmail: draft.recipientEmail,
      subject: draft.subject,
      body: draft.body,
      campaignIds: [draft.campaignId],
      createdBy: userId,
    });
    return result === "queued"
      ? "queued"
      : result === "suppressed"
        ? "suppressed"
        : "already_queued";
  }

  private parseComposition(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException("Email details are required");
    }
    const data = input as Record<string, unknown>;
    const subject = typeof data.subject === "string" ? data.subject.trim() : "";
    const rawBody = typeof data.body === "string" ? data.body.trim() : "";
    if (!subject || subject.length > 200) {
      throw new BadRequestException("Subject must be 1 to 200 characters");
    }
    if (!rawBody || rawBody.length > 20_000) {
      throw new BadRequestException("Message must be 1 to 20000 characters");
    }
    const rawEmails = data.emails ?? [];
    const rawCampaignIds = data.campaignIds ?? [];
    const replyToMessageId = data.replyToMessageId;
    if (
      replyToMessageId !== undefined &&
      (typeof replyToMessageId !== "string" || !isUuid(replyToMessageId))
    ) {
      throw new BadRequestException("Invalid reply message ID");
    }
    if (!Array.isArray(rawEmails) || rawEmails.length > 200) {
      throw new BadRequestException("Choose at most 200 email addresses");
    }
    if (!Array.isArray(rawCampaignIds) || rawCampaignIds.length > 20) {
      throw new BadRequestException("Choose at most 20 campaigns");
    }
    const emails = rawEmails.map((value) => {
      if (typeof value !== "string") {
        throw new BadRequestException("Email addresses must be text");
      }
      const email = value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new BadRequestException(
          "One or more email addresses are invalid",
        );
      }
      return email;
    });
    const campaignIds = rawCampaignIds.map((value) => {
      if (typeof value !== "string" || !isUuid(value)) {
        throw new BadRequestException("Campaign IDs must be valid IDs");
      }
      return value;
    });
    if (emails.length === 0 && campaignIds.length === 0) {
      throw new BadRequestException(
        "Choose a campaign or enter email addresses",
      );
    }
    if (replyToMessageId && (emails.length !== 1 || campaignIds.length)) {
      throw new BadRequestException("A reply must have one direct recipient");
    }
    return {
      subject,
      body: rawBody,
      emails,
      campaignIds,
      replyToMessageId: replyToMessageId as string | undefined,
    };
  }

  private async replyTarget(parsed: {
    replyToMessageId?: string;
    emails: string[];
  }) {
    const message = await this.database.findSalesEmailMessage(
      parsed.replyToMessageId!,
    );
    if (
      !message ||
      message.direction !== "incoming" ||
      !message.messageId ||
      message.fromEmail.toLowerCase() !== parsed.emails[0]
    ) {
      throw new BadRequestException(
        "Choose an incoming message and its sender to reply",
      );
    }
    return message;
  }

  dispatchQueued(): Promise<number> {
    if (this.sending) return this.sending;
    this.sending = this.sendBatch().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async sendBatch(): Promise<number> {
    if (process.env.NODE_ENV === "production" && this.email.name === "stub") {
      this.logger.error(
        "Sales send worker needs a configured SMTP provider in production",
      );
      return 0;
    }
    const unsubscribe = salesUnsubscribeSetup(process.env);
    if (!unsubscribe) {
      this.logger.error(
        "Sales send worker needs PUBLIC_API_URL and OUTREACH_UNSUBSCRIBE_KEY",
      );
      return 0;
    }
    const messages = await this.database.claimSalesEmailMessages(1);
    for (const message of messages) {
      let handedToProvider = false;
      try {
        const token = salesUnsubscribeToken(
          message.recipientEmail,
          unsubscribe.key,
        );
        const url = `${unsubscribe.baseUrl}/v1/sales/unsubscribe/${token}`;
        const body = salesMessageBodyWithUnsubscribe(
          message.body,
          unsubscribe.baseUrl,
          url,
        );
        await this.database.setSalesEmailSendingBody(message.id, body);
        if (
          (
            await this.database.listSuppressedSalesEmails([
              message.recipientEmail,
            ])
          ).length
        ) {
          await this.database.finishSalesEmailMessage({
            id: message.id,
            status: "failed",
            error: "Recipient is suppressed",
          });
          continue;
        }
        handedToProvider = true;
        const result = await this.email.send({
          to: message.recipientEmail,
          subject: message.subject,
          text: body,
          listUnsubscribeUrl: url,
          inReplyTo: message.inReplyTo ?? undefined,
          references: message.references,
        });
        await this.database.finishSalesEmailMessage({
          id: message.id,
          status: this.email.name === "stub" ? "stubbed" : "accepted",
          messageId: result.providerMessageId,
        });
      } catch (error) {
        const failure = salesSendFailure(error, this.email.name);
        if (failure.bounce) {
          try {
            await this.database.suppressSalesEmail({
              email: message.recipientEmail,
              reason: "bounce",
            });
          } catch (suppressionError) {
            this.logger.warn(
              `Could not suppress rejected sales recipient: ${suppressionError instanceof Error ? suppressionError.message : "database error"}`,
            );
          }
        }
        await this.database.finishSalesEmailMessage({
          id: message.id,
          status: handedToProvider ? failure.status : "failed",
          error:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : "Send failed",
        });
      }
    }
    return messages.length;
  }

  sync(): Promise<SalesMailboxSyncResult> {
    if (this.running) return this.running;
    this.running = this.readMailboxWithLock().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async readMailboxWithLock() {
    const release = await this.database.acquireSalesEmailSyncLock();
    if (!release) {
      throw new ConflictException("Sales mailbox sync is already running");
    }
    try {
      return await this.readMailbox();
    } finally {
      await release();
    }
  }

  private async readMailbox(): Promise<SalesMailboxSyncResult> {
    const setup = salesMailboxFromEnvironment(process.env);
    if (!setup)
      throw new BadRequestException("Sales IMAP settings are incomplete");
    const client = new ImapFlow({
      host: setup.host,
      port: setup.port,
      secure: setup.port === 993,
      ...(setup.port === 993 ? {} : { doSTARTTLS: true }),
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 120_000,
      auth: { user: setup.user, pass: setup.password },
      logger: false,
    });
    client.on("error", (error) => {
      this.logger.warn(
        `Sales mailbox connection error (${safeMailboxErrorCode(error)})`,
      );
    });
    const result = { folders: 0, checked: 0, imported: 0 };
    try {
      await client.connect();
      const folders = await client.list();
      for (const folder of folders) {
        const flags = new Set(
          [...(folder.flags ?? [])].map((flag) => String(flag).toLowerCase()),
        );
        if (flags.has("\\drafts")) {
          continue;
        }
        result.folders += 1;
        const lock = await client.getMailboxLock(folder.path, {
          readOnly: true,
        });
        try {
          const mailbox = client.mailbox;
          if (!mailbox) continue;
          const uidValidity = String(mailbox.uidValidity);
          const saved = await this.database.getSalesEmailSyncCursor(
            folder.path,
          );
          const startUid =
            saved?.uidValidity === uidValidity ? saved.lastUid + 1 : 1;
          const lastUid = Math.max(0, Number(mailbox.uidNext) - 1);
          for (let start = startUid; start <= lastUid; start += 250) {
            const end = Math.min(start + 249, lastUid);
            const messages = client.fetch(
              `${start}:${end}`,
              { uid: true, source: true, internalDate: true },
              { uid: true },
            );
            let checkedThrough = start - 1;
            for await (const item of messages) {
              const parsed = await parseSalesMailboxSource(item.source);
              result.checked += 1;
              const mapped = salesEmailFromParsed(
                parsed,
                folder.path,
                uidValidity,
                item.uid,
                setup.user,
                new Date(item.internalDate ?? parsed.date ?? new Date()),
              );
              const stored = await this.database.storeSyncedSalesEmail(mapped);
              if (stored.inserted) {
                result.imported += 1;
              }
              await storeSalesEmailAttachments(
                stored.id,
                parsed.attachments,
                this.database,
                this.storage,
              );
              const unsubscribeEmail = salesUnsubscribeReply(
                parsed,
                setup.user,
              );
              if (unsubscribeEmail) {
                await this.database.suppressSalesEmail({
                  email: unsubscribeEmail,
                  reason: "unsubscribe",
                });
              }
              checkedThrough = item.uid;
            }
            if (checkedThrough < end) checkedThrough = end;
            await this.database.saveSalesEmailSyncCursor({
              folder: folder.path,
              uidValidity,
              lastUid: checkedThrough,
            });
          }
        } finally {
          lock.release();
        }
      }
      await client.logout();
      void this.alerts?.recovered("sales", "reading");
    } catch (error) {
      client.close();
      const code = safeMailboxErrorCode(error);
      this.logger.error(`Sales mailbox sync failed (${code})`);
      void this.alerts?.failed(
        "sales",
        "reading",
        (error as { responseText?: string }).responseText ?? code,
      );
      throw new BadGatewayException("Sales mailbox sync failed");
    }
    return result;
  }
}
