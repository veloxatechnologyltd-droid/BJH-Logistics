import { Logger } from "@nestjs/common";
import type { EmailProvider } from "./providers";

export const MAILBOX_ALERTS = Symbol("MAILBOX_ALERTS");

export type AlertMailbox = "quotes" | "inquiries" | "replies" | "sales";
export type MailboxAction = "sending" | "reading";

const labels: Record<AlertMailbox, string> = {
  quotes: "Quotes",
  inquiries: "Inquiries",
  replies: "Replies (Henry)",
  sales: "Sales",
};

/**
 * True when the mail server refused one recipient (a bad or full address),
 * which says nothing about the mailbox itself. A 5.7.x answer is the server
 * refusing us (policy, authentication), so that one does count.
 */
export function isRecipientProblem(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const smtp = error as {
    code?: unknown;
    command?: unknown;
    response?: unknown;
  };
  if (
    typeof smtp.response === "string" &&
    /\b5\.7\.\d{1,3}\b/.test(smtp.response)
  ) {
    return false;
  }
  return (
    smtp.code === "EENVELOPE" ||
    (typeof smtp.command === "string" && /^RCPT TO\b/i.test(smtp.command))
  );
}

/**
 * Tells the owner (`ALERT_EMAIL`) when one of BJH's mailboxes cannot send or
 * read mail, through a different mailbox from the broken one: sales reports a
 * broken quotes, inquiries or replies mailbox; quotes reports a broken sales
 * mailbox. One alert per problem, and one more when the mailbox works again.
 * The state is kept in memory, so a restart while still broken alerts again.
 */
export class MailboxAlerts {
  private readonly logger = new Logger("MailboxAlerts");
  /** Problems already reported (or being reported), by "mailbox:action". */
  private readonly open = new Set<string>();

  constructor(
    private readonly alertTo: string | null,
    private readonly senders: { quotes: EmailProvider; sales: EmailProvider },
  ) {}

  async failed(
    mailbox: AlertMailbox,
    action: MailboxAction,
    reason: string,
  ): Promise<void> {
    const key = `${mailbox}:${action}`;
    if (this.open.has(key)) return;
    this.open.add(key);
    const sent = await this.notify(
      mailbox,
      `[BJH alert] ${labels[mailbox]} mailbox cannot ${action === "sending" ? "send" : "read"} email`,
      [
        `The ${labels[mailbox]} mailbox stopped ${action} email.`,
        "",
        `Error: ${reason}`,
        `Time: ${new Date().toISOString()}`,
        "",
        action === "sending"
          ? "Customer emails from this mailbox are failing until this is fixed."
          : "New emails to this mailbox are not reaching the platform until this is fixed.",
        "A wrong or changed password is the most common cause (error 535): check the mailbox password and update it in the API settings on Render.",
        "",
        "You will get one more email when it works again.",
      ].join("\n"),
    );
    // Not reported: try again on the next failure.
    if (!sent) this.open.delete(key);
  }

  async recovered(mailbox: AlertMailbox, action: MailboxAction): Promise<void> {
    const key = `${mailbox}:${action}`;
    if (!this.open.delete(key)) return;
    await this.notify(
      mailbox,
      `[BJH alert] ${labels[mailbox]} mailbox is ${action} email again`,
      `The ${labels[mailbox]} mailbox is ${action} email again (${new Date().toISOString()}).\n\nMessages that failed while it was broken stay failed: retry the ones that still matter from Messages.`,
    );
  }

  private async notify(
    broken: AlertMailbox,
    subject: string,
    text: string,
  ): Promise<boolean> {
    this.logger.error(`${subject}`);
    if (!this.alertTo) {
      this.logger.error("ALERT_EMAIL is not set; nobody was emailed");
      return false;
    }
    const sender =
      broken === "sales" ? this.senders.quotes : this.senders.sales;
    if (sender.name === "stub") {
      this.logger.error(
        `No ${broken === "sales" ? "quotes" : "sales"} mailbox is set up to send this alert`,
      );
      return false;
    }
    try {
      await sender.send({ to: this.alertTo, subject, text });
      return true;
    } catch (error) {
      this.logger.error(
        `The alert could not be sent either: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

export function createMailboxAlerts(
  environment: NodeJS.ProcessEnv,
  senders: { quotes: EmailProvider; sales: EmailProvider },
): MailboxAlerts {
  return new MailboxAlerts(environment.ALERT_EMAIL?.trim() || null, senders);
}

/**
 * Reports a real mailbox's send failures (not a single bad recipient) and its
 * recovery. Stub providers are returned unchanged: nothing real can break.
 */
export function watchSending(
  provider: EmailProvider,
  mailbox: AlertMailbox,
  alerts: MailboxAlerts,
): EmailProvider {
  if (provider.name === "stub") return provider;
  return {
    name: provider.name,
    async send(message) {
      try {
        const result = await provider.send(message);
        void alerts.recovered(mailbox, "sending");
        return result;
      } catch (error) {
        if (!isRecipientProblem(error)) {
          void alerts.failed(
            mailbox,
            "sending",
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }
    },
  };
}
