import { Logger } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
/** Sends replies to inquiries, from the inquiries mailbox. */
export const INQUIRY_EMAIL_PROVIDER = Symbol("INQUIRY_EMAIL_PROVIDER");
/** Sends replies to customers' emails from Henry's mailbox, when it is set up. */
export const REPLY_EMAIL_PROVIDER = Symbol("REPLY_EMAIL_PROVIDER");
/** Sends staff sales outreach through the dedicated sales mailbox. */
export const OUTREACH_EMAIL_PROVIDER = Symbol("OUTREACH_EMAIL_PROVIDER");
export const SMS_PROVIDER = Symbol("SMS_PROVIDER");

export interface SendResult {
  providerMessageId: string | null;
}

export interface EmailProvider {
  /** "smtp", or "stub" when no real mail server is configured. */
  readonly name: string;
  send(message: {
    to: string;
    subject: string;
    text: string;
    /** An HTML version of the same text (customer replies use a template). */
    html?: string;
    /** Where the customer's answer should go, when not the sender address. */
    replyTo?: string;
    /** The customer's Message-ID, so their mail app shows the reply in the same thread. */
    inReplyTo?: string;
    references?: string[];
    listUnsubscribeUrl?: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
  }): Promise<SendResult>;
}

export interface SmsProvider {
  /** "arkesel", or "stub" when no real SMS account is configured. */
  readonly name: string;
  send(message: { to: string; text: string }): Promise<SendResult>;
}

export function smtpTransportSecurity(port: number) {
  return { secure: port === 465, requireTLS: port !== 465 };
}

/**
 * Local and test provider: nothing leaves the machine. Messages are kept in
 * memory so a test (or a person trying the system) can see what would be sent.
 */
export class RecordingEmailProvider implements EmailProvider {
  readonly name = "stub";
  readonly sent: Array<{
    to: string;
    subject: string;
    text: string;
    /** An HTML version of the same text (customer replies use a template). */
    html?: string;
    /** Where the customer's answer should go, when not the sender address. */
    replyTo?: string;
    /** The customer's Message-ID, so their mail app shows the reply in the same thread. */
    inReplyTo?: string;
    references?: string[];
    listUnsubscribeUrl?: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
  }> = [];
  /** Recipients whose send should fail, for testing retries. */
  failFor = new Set<string>();
  private readonly logger = new Logger("StubEmail");

  async send(message: {
    to: string;
    subject: string;
    text: string;
    /** An HTML version of the same text (customer replies use a template). */
    html?: string;
    /** Where the customer's answer should go, when not the sender address. */
    replyTo?: string;
    /** The customer's Message-ID, so their mail app shows the reply in the same thread. */
    inReplyTo?: string;
    references?: string[];
    listUnsubscribeUrl?: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
  }) {
    if (this.failFor.has(message.to)) throw new Error("Stub email failure");
    this.sent.push(message);
    this.logger.log(`(not sent) email to ${message.to}: ${message.subject}`);
    return { providerMessageId: `stub-email-${this.sent.length}` };
  }
}

export class RecordingSmsProvider implements SmsProvider {
  readonly name = "stub";
  readonly sent: Array<{ to: string; text: string }> = [];
  failFor = new Set<string>();
  private readonly logger = new Logger("StubSms");

  async send(message: { to: string; text: string }) {
    if (this.failFor.has(message.to)) throw new Error("Stub SMS failure");
    this.sent.push(message);
    this.logger.log(`(not sent) SMS to ${message.to}: ${message.text}`);
    return { providerMessageId: `stub-sms-${this.sent.length}` };
  }
}

/** The IMAP login of the mailbox an email is sent from, so a copy can be filed in its Sent folder. */
export interface SentCopyTarget {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * Plain SMTP servers do not file what they send, so without this a message
 * the system sent is missing from the mailbox's own Sent folder. Set up only
 * when both the IMAP server and the mailbox's login are known.
 */
export function sentCopyTarget(
  host: string | undefined,
  port: string | undefined,
  user: string | null | undefined,
  password: string | null | undefined,
): SentCopyTarget | undefined {
  const imapHost = host?.trim();
  if (!imapHost || !user || !password) return undefined;
  return { host: imapHost, port: Number(port ?? 993), user, password };
}

/** Plain SMTP, so any mailbox provider works (BJH's own mail, Google Workspace, and so on). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: Transporter;
  private readonly logger = new Logger("SmtpEmailProvider");
  private readonly sentCopy?: SentCopyTarget;

  constructor(options: {
    host: string;
    port: number;
    user: string | null;
    password: string | null;
    from: string;
    sentCopy?: SentCopyTarget;
  }) {
    this.from = options.from;
    this.sentCopy = options.sentCopy;
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      ...smtpTransportSecurity(options.port),
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 120_000,
      auth:
        options.user && options.password
          ? { user: options.user, pass: options.password }
          : undefined,
    });
  }

  private readonly from: string;

  async send(message: {
    to: string;
    subject: string;
    text: string;
    /** An HTML version of the same text (customer replies use a template). */
    html?: string;
    /** Where the customer's answer should go, when not the sender address. */
    replyTo?: string;
    /** The customer's Message-ID, so their mail app shows the reply in the same thread. */
    inReplyTo?: string;
    references?: string[];
    listUnsubscribeUrl?: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
  }) {
    const mail = {
      from: this.from,
      to: message.to,
      replyTo: message.replyTo,
      inReplyTo: message.inReplyTo,
      references: message.references ?? message.inReplyTo,
      ...(message.listUnsubscribeUrl
        ? {
            list: { unsubscribe: message.listUnsubscribeUrl },
            headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          }
        : {}),
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
    };
    const info = await this.transport.sendMail(mail);
    // The email is out; a failure filing the copy must never fail (and so
    // retry, and double-send) the delivery.
    if (this.sentCopy) {
      await this.fileSentCopy(this.sentCopy, mail, info.messageId).catch(
        (error) =>
          this.logger.warn(
            `Could not file a copy in the Sent folder: ${error instanceof Error ? error.message : "IMAP error"}`,
          ),
      );
    }
    return { providerMessageId: info.messageId ?? null };
  }

  /** Files the message exactly as sent (same Message-ID, so a mailbox sync recognises it) in the Sent folder. */
  private async fileSentCopy(
    target: SentCopyTarget,
    mail: Parameters<Transporter["sendMail"]>[0],
    messageId: string | undefined,
  ) {
    const date = new Date();
    const { message: raw } = await nodemailer
      .createTransport({ streamTransport: true, buffer: true })
      .sendMail({ ...mail, messageId, date });
    const client = new ImapFlow({
      host: target.host,
      port: target.port,
      secure: target.port === 993,
      ...(target.port === 993 ? {} : { doSTARTTLS: true }),
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 120_000,
      auth: { user: target.user, pass: target.password },
      logger: false,
    });
    client.on("error", () => undefined);
    await client.connect();
    try {
      const folders = await client.list();
      const sent =
        folders.find((folder) => folder.specialUse === "\\Sent")?.path ??
        folders.find((folder) => /^(INBOX[./])?sent$/i.test(folder.path))
          ?.path ??
        "Sent";
      await client.append(sent, raw as Buffer, ["\\Seen"], date);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }
}

/**
 * Arkesel SMS API v2: POST https://sms.arkesel.com/api/v2/sms/send with the
 * key in the `api-key` header and {sender, message, recipients: [...]}.
 * Checked against Arkesel's developer guide on 2026-09-30.
 */
export class ArkeselSmsProvider implements SmsProvider {
  readonly name = "arkesel";

  constructor(
    private readonly options: {
      apiKey: string;
      senderId: string;
      baseUrl?: string;
    },
  ) {}

  async send(message: { to: string; text: string }) {
    const response = await fetch(
      `${this.options.baseUrl ?? "https://sms.arkesel.com"}/api/v2/sms/send`,
      {
        method: "POST",
        headers: {
          "api-key": this.options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: this.options.senderId,
          message: message.text,
          recipients: [message.to],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      status?: string;
      message?: string;
      data?: { id?: string } | Array<{ id?: string }>;
    } | null;
    if (!response.ok || body?.status !== "success") {
      throw new Error(
        `Arkesel rejected the message (${response.status}${body?.message ? `: ${body.message}` : ""})`,
      );
    }
    const data = Array.isArray(body.data) ? body.data[0] : body.data;
    return { providerMessageId: data?.id ?? null };
  }
}

export function createEmailProvider(
  environment: NodeJS.ProcessEnv,
): EmailProvider {
  const host = environment.EMAIL_SMTP_HOST?.trim();
  const from = environment.EMAIL_FROM?.trim();
  if ((environment.EMAIL_PROVIDER ?? "smtp") === "smtp" && host && from) {
    return new SmtpEmailProvider({
      host,
      port: Number(environment.EMAIL_SMTP_PORT ?? 587),
      user: environment.EMAIL_SMTP_USER?.trim() || null,
      password: environment.EMAIL_SMTP_PASSWORD ?? null,
      from,
      sentCopy: sentCopyTarget(
        environment.INBOUND_IMAP_HOST,
        environment.INBOUND_IMAP_PORT,
        environment.EMAIL_SMTP_USER?.trim(),
        environment.EMAIL_SMTP_PASSWORD,
      ),
    });
  }
  return new RecordingEmailProvider();
}

/** The sales mailbox is intentionally separate from quote and customer mail. */
export function createOutreachEmailProvider(
  environment: NodeJS.ProcessEnv,
): EmailProvider {
  const host = environment.EMAIL_OUTREACH_SMTP_HOST?.trim();
  const user = environment.EMAIL_OUTREACH_SMTP_USER?.trim();
  const password = environment.EMAIL_OUTREACH_SMTP_PASSWORD;
  const from = environment.EMAIL_OUTREACH_FROM?.trim();
  if (!host || !user || !password || !from) {
    return new RecordingEmailProvider();
  }
  return new SmtpEmailProvider({
    host,
    port: Number(environment.EMAIL_OUTREACH_SMTP_PORT ?? 465),
    user,
    password,
    from,
    sentCopy: sentCopyTarget(
      environment.INBOUND_OUTREACH_IMAP_HOST,
      environment.INBOUND_OUTREACH_IMAP_PORT,
      user,
      password,
    ),
  });
}

/** Mail is set up, but not the inquiries sender: refuses rather than send from the wrong address. */
class InquirySenderMissing implements EmailProvider {
  readonly name = "smtp";
  async send(): Promise<SendResult> {
    throw new Error(
      "The inquiries mailbox is not set up for sending (EMAIL_INQUIRY_FROM)",
    );
  }
}

/**
 * The sender for replies to inquiries: the inquiries mailbox, on the same mail
 * server as the quote mailbox (`EMAIL_SMTP_HOST` / `_PORT`), with its own
 * `EMAIL_INQUIRY_FROM`, `EMAIL_INQUIRY_SMTP_USER` and `_PASSWORD`. An inquiry
 * reply never goes out from the quote mailbox: with mail set up but no
 * inquiries sender, the delivery fails and says why.
 */
export function createInquiryEmailProvider(
  environment: NodeJS.ProcessEnv,
): EmailProvider {
  const main = createEmailProvider(environment);
  if (main.name !== "smtp") return new RecordingEmailProvider();
  const from = environment.EMAIL_INQUIRY_FROM?.trim();
  if (!from) return new InquirySenderMissing();
  return new SmtpEmailProvider({
    host: environment.EMAIL_SMTP_HOST!.trim(),
    port: Number(environment.EMAIL_SMTP_PORT ?? 587),
    user: environment.EMAIL_INQUIRY_SMTP_USER?.trim() || null,
    password: environment.EMAIL_INQUIRY_SMTP_PASSWORD ?? null,
    from,
    sentCopy: sentCopyTarget(
      environment.INBOUND_IMAP_HOST,
      environment.INBOUND_IMAP_PORT,
      environment.EMAIL_INQUIRY_SMTP_USER?.trim(),
      environment.EMAIL_INQUIRY_SMTP_PASSWORD,
    ),
  });
}

/** The sender for customer replies, and where each mailbox's answers go back to. */
export interface ReplySender {
  email: EmailProvider;
  /** The mailbox the platform reads, so the customer's answer comes back in. */
  replyTo: { quotes: string | null; inquiries: string | null };
}

/**
 * Replies to customers' emails (the assistant's and staff's) go out from
 * Henry's mailbox: `EMAIL_REPLY_FROM` (for example
 * "Henry Yaw Somuah <henry@bjhlogistics.com>") with its own
 * `EMAIL_REPLY_SMTP_USER` / `_PASSWORD`, on the same mail server. Reply-To is
 * the mailbox the request came in on, which the platform reads. Without
 * `EMAIL_REPLY_FROM` (or without mail) replies keep their old senders: null.
 */
export function createReplySender(
  environment: NodeJS.ProcessEnv,
): ReplySender | null {
  const main = createEmailProvider(environment);
  const from = environment.EMAIL_REPLY_FROM?.trim();
  if (main.name !== "smtp" || !from) return null;
  return {
    email: new SmtpEmailProvider({
      host: environment.EMAIL_SMTP_HOST!.trim(),
      port: Number(environment.EMAIL_SMTP_PORT ?? 587),
      user: environment.EMAIL_REPLY_SMTP_USER?.trim() || null,
      password: environment.EMAIL_REPLY_SMTP_PASSWORD ?? null,
      from,
      sentCopy: sentCopyTarget(
        environment.INBOUND_IMAP_HOST,
        environment.INBOUND_IMAP_PORT,
        environment.EMAIL_REPLY_SMTP_USER?.trim(),
        environment.EMAIL_REPLY_SMTP_PASSWORD,
      ),
    }),
    replyTo: {
      quotes: environment.INBOUND_IMAP_USER?.trim() || null,
      inquiries:
        environment.INBOUND_INQUIRY_IMAP_USER?.trim() ||
        environment.EMAIL_INQUIRY_FROM?.trim() ||
        null,
    },
  };
}

export function createSmsProvider(environment: NodeJS.ProcessEnv): SmsProvider {
  const apiKey = environment.ARKESEL_API_KEY?.trim();
  if ((environment.SMS_PROVIDER ?? "arkesel") === "arkesel" && apiKey) {
    return new ArkeselSmsProvider({
      apiKey,
      senderId: (environment.SMS_SENDER_ID ?? "BJHLogistics").slice(0, 11),
    });
  }
  return new RecordingSmsProvider();
}
