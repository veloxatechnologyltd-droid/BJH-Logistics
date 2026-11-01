import { Logger } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
/** Sends replies to inquiries, from the inquiries mailbox. */
export const INQUIRY_EMAIL_PROVIDER = Symbol("INQUIRY_EMAIL_PROVIDER");
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
    attachments?: Array<{ filename: string; content: Buffer }>;
  }): Promise<SendResult>;
}

export interface SmsProvider {
  /** "arkesel", or "stub" when no real SMS account is configured. */
  readonly name: string;
  send(message: { to: string; text: string }): Promise<SendResult>;
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
    attachments?: Array<{ filename: string; content: Buffer }>;
  }> = [];
  /** Recipients whose send should fail, for testing retries. */
  failFor = new Set<string>();
  private readonly logger = new Logger("StubEmail");

  async send(message: {
    to: string;
    subject: string;
    text: string;
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

/** Plain SMTP, so any mailbox provider works (BJH's own mail, Google Workspace, and so on). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: Transporter;

  constructor(options: {
    host: string;
    port: number;
    user: string | null;
    password: string | null;
    from: string;
  }) {
    this.from = options.from;
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
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
    attachments?: Array<{ filename: string; content: Buffer }>;
  }) {
    const info = await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      attachments: message.attachments,
    });
    return { providerMessageId: info.messageId ?? null };
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
    });
  }
  return new RecordingEmailProvider();
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
  });
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
