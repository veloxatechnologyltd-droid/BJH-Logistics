import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ParsedMail } from "mailparser";
import { DatabasePort } from "../database/database.port";
import type { RequestMailbox } from "../database/database.port";
import { EmailAssistantService } from "./email-assistant.service";
import { InboundEmailService } from "./inbound-email.service";
import type { ReceivedFile } from "./inbound-email.service";

export interface MailboxSetup {
  /** The inbox its emails go to. */
  name: RequestMailbox;
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  /** Emails that arrived before this are left alone, so switching on never imports an old inbox. */
  since: Date;
}

/** The mailbox to read, from `INBOUND_IMAP_*`; null (reading off) unless host, user, password and a valid start time are all set. */
export function mailboxFromEnvironment(
  environment: NodeJS.ProcessEnv,
): MailboxSetup | null {
  const host = environment.INBOUND_IMAP_HOST?.trim();
  const user = environment.INBOUND_IMAP_USER?.trim();
  const password = environment.INBOUND_IMAP_PASSWORD;
  const since = new Date(environment.INBOUND_IMAP_SINCE?.trim() ?? "");
  if (!host || !user || !password || Number.isNaN(since.getTime())) {
    return null;
  }
  return {
    name: "quotes",
    host,
    port: Number(environment.INBOUND_IMAP_PORT ?? 993),
    user,
    password,
    mailbox: environment.INBOUND_IMAP_MAILBOX?.trim() || "INBOX",
    since,
  };
}

/**
 * The inquiries mailbox, from `INBOUND_INQUIRY_IMAP_USER` and `_PASSWORD`. It is
 * on the same server as the quote mailbox, so host, port, folder and start time
 * are shared; null unless the quote mailbox is set up too.
 */
export function inquiryMailboxFromEnvironment(
  environment: NodeJS.ProcessEnv,
): MailboxSetup | null {
  const quotes = mailboxFromEnvironment(environment);
  const user = environment.INBOUND_INQUIRY_IMAP_USER?.trim();
  const password = environment.INBOUND_INQUIRY_IMAP_PASSWORD;
  if (!quotes || !user || !password) return null;
  return { ...quotes, name: "inquiries", user, password };
}

/** Every mailbox that is set up. */
export function mailboxesFromEnvironment(
  environment: NodeJS.ProcessEnv,
): MailboxSetup[] {
  return [
    mailboxFromEnvironment(environment),
    inquiryMailboxFromEnvironment(environment),
  ].filter((setup): setup is MailboxSetup => setup !== null);
}

/** One email from the mailbox in the shape the inbound-email webhook takes, so both paths share every rule. */
export function inboundFromMail(
  mail: ParsedMail,
  receivedAt: Date,
  mailbox: RequestMailbox = "quotes",
): { fields: Record<string, unknown>; files: ReceivedFile[] } {
  const from = mail.from?.value[0];
  return {
    fields: {
      from_email: from?.address ?? "",
      from_name: from?.name ?? "",
      to: Array.isArray(mail.to)
        ? mail.to.map((to) => to.text).join(", ")
        : (mail.to?.text ?? ""),
      subject: mail.subject ?? "",
      text: mail.text ?? "",
      html: typeof mail.html === "string" ? mail.html : "",
      message_id: mail.messageId ?? "",
      received_at: receivedAt.toISOString(),
      mailbox,
    },
    // Pictures embedded in the body (signature logos) are not attachments.
    files: mail.attachments
      .filter((file) => !file.related)
      .map((file) => ({
        originalname: file.filename ?? "attachment",
        buffer: file.content,
        size: file.size,
      })),
  };
}

export interface PollResult {
  checked: number;
  received: number;
  skipped: number;
  failed: number;
}

/**
 * Reads BJH's own request mailbox (`INBOUND_IMAP_*`) over IMAP and passes every
 * new email through the same intake as the webhook: kept with its attachments,
 * read by AI, then the assistant links the customer and drafts the quote and
 * reply. It runs inside the API on a timer, like the notification dispatcher;
 * `POST /api/v1/inbound-email/poll` runs it on demand, which also wakes a
 * sleeping API. Nothing in the mailbox is changed or marked read. An email seen
 * twice is one request (its Message-ID is checked before it is downloaded).
 */
@Injectable()
export class MailboxReaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailboxReaderService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<PollResult> | null = null;
  /** The last UID handled in this process for each mailbox (by user), so a poll only asks for newer mail. */
  private readonly lastSeen = new Map<
    string,
    { uidValidity: bigint; uid: number }
  >();

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(InboundEmailService)
    private readonly inbound: InboundEmailService,
    @Inject(EmailAssistantService)
    private readonly assistant: EmailAssistantService,
  ) {}

  onModuleInit(): void {
    if (
      !mailboxFromEnvironment(process.env) ||
      process.env.NODE_TEST_CONTEXT !== undefined
    ) {
      return;
    }
    const interval = Number(process.env.INBOUND_IMAP_INTERVAL_MS ?? 60_000);
    this.timer = setInterval(
      () => void this.poll().catch(() => undefined),
      interval,
    );
    this.timer.unref();
    void this.poll().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get enabled(): boolean {
    return mailboxFromEnvironment(process.env) !== null;
  }

  /** Reads the new emails; a poll already running is joined, not repeated. */
  poll(): Promise<PollResult> {
    if (!this.running) {
      this.running = this.read().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /** Reads every mailbox in turn; one that cannot be read does not stop the others. */
  private async read(): Promise<PollResult> {
    const setups = mailboxesFromEnvironment(process.env);
    const own = setups.map((setup) => setup.user.toLowerCase());
    const result: PollResult = {
      checked: 0,
      received: 0,
      skipped: 0,
      failed: 0,
    };
    let failure: unknown = null;
    for (const setup of setups) {
      try {
        const read = await this.readOne(setup, own);
        result.checked += read.checked;
        result.received += read.received;
        result.skipped += read.skipped;
        result.failed += read.failed;
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    return result;
  }

  private async readOne(
    setup: MailboxSetup,
    own: string[],
  ): Promise<PollResult> {
    const result: PollResult = {
      checked: 0,
      received: 0,
      skipped: 0,
      failed: 0,
    };
    const client = new ImapFlow({
      host: setup.host,
      port: setup.port,
      secure: setup.port === 993,
      auth: { user: setup.user, pass: setup.password },
      logger: false,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock(setup.mailbox, {
        readOnly: true,
      });
      try {
        const opened = client.mailbox;
        if (!opened) return result;
        let last = this.lastSeen.get(setup.user);
        if (last && last.uidValidity !== opened.uidValidity) {
          last = undefined;
        }
        const uids = last
          ? await client.search({ uid: `${last.uid + 1}:*` }, { uid: true })
          : await client.search({ since: setup.since }, { uid: true });
        const newer = (uids || [])
          .filter((uid) => !last || uid > last.uid)
          .sort((a, b) => a - b);
        for (const uid of newer) {
          result.checked += 1;
          const outcome = await this.handle(client, uid, setup, own);
          if (outcome === "failed") {
            // Stop here so the next poll tries this email again.
            result.failed += 1;
            break;
          }
          result[outcome] += 1;
          this.lastSeen.set(setup.user, {
            uidValidity: opened.uidValidity,
            uid,
          });
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      client.close();
      // imapflow says only "Command failed"; the server's answer says why (a wrong password, for one).
      const reason =
        (error as { responseText?: string }).responseText ??
        (error instanceof Error ? error.message : String(error));
      this.logger.error(`Reading ${setup.user} failed: ${reason}`);
      throw new BadGatewayException(`Reading ${setup.user} failed: ${reason}`);
    }
    if (result.checked) {
      this.logger.log(
        `${setup.user}: ${result.received} new, ${result.skipped} skipped, ${result.failed} failed`,
      );
    }
    return result;
  }

  private async handle(
    client: ImapFlow,
    uid: number,
    setup: MailboxSetup,
    own: string[],
  ): Promise<"received" | "skipped" | "failed"> {
    try {
      const header = await client.fetchOne(
        String(uid),
        { envelope: true, internalDate: true },
        { uid: true },
      );
      if (!header) return "skipped";
      const receivedAt = new Date(header.internalDate ?? Date.now());
      const sender = header.envelope?.from?.[0]?.address?.toLowerCase();
      // BJH's own mailboxes writing to each other are never taken in (no reply loops).
      if (receivedAt < setup.since || (sender && own.includes(sender))) {
        return "skipped";
      }
      const messageId = header.envelope?.messageId;
      if (
        messageId &&
        (await this.database.findQuoteRequestByMessageId(messageId))
      ) {
        return "skipped";
      }
      const message = await client.fetchOne(
        String(uid),
        { source: true },
        { uid: true },
      );
      if (!message || !message.source) return "skipped";
      const { fields, files } = inboundFromMail(
        await simpleParser(message.source),
        receivedAt,
        setup.name,
      );
      const received = await this.inbound.receive(fields, files);
      if (received.duplicate) return "skipped";
      if (received.reading === "done") {
        await this.assistant.afterReading(received.requestId);
      }
      return "received";
    } catch (error) {
      // An email the intake refuses (no sender address) would fail forever.
      if (error instanceof BadRequestException) {
        this.logger.warn(`Mailbox email ${uid} skipped: ${error.message}`);
        return "skipped";
      }
      this.logger.error(
        `Mailbox email ${uid} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return "failed";
    }
  }
}
