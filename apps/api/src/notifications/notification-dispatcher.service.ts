import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { DatabasePort, DueDelivery } from "../database/database.port";
import {
  EMAIL_PROVIDER,
  SMS_PROVIDER,
  type EmailProvider,
  type SmsProvider,
} from "./providers";
import { etaReminderMessage } from "./notification-messages";
import { NotificationsService } from "./notifications.service";
import { renderQuotePdf } from "../quotations/quote-pdf";

/** A delivery is tried this many times before it is left as failed for a person to retry. */
export const MAX_ATTEMPTS = 5;
/** Waits before attempts 2, 3, 4 and 5: 1, 4, 9 and 16 minutes. */
export const retryDelaySeconds = (attemptsSoFar: number) =>
  attemptsSoFar * attemptsSoFar * 60;
/** How long before the expected arrival a reminder goes out. */
export const REMINDER_HOURS = 24;

/**
 * Sends the queued deliveries and raises the ETA reminders. It runs inside the
 * API process on a timer (no separate service or queue is needed at this
 * scale); tests call `dispatchDue` directly. Several instances are safe:
 * deliveries are claimed with a lock.
 */
@Injectable()
export class NotificationDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastReminderRun = 0;

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    const off =
      process.env.NOTIFICATIONS_WORKER === "off" ||
      process.env.NODE_TEST_CONTEXT !== undefined;
    if (off) return;
    const interval = Number(process.env.NOTIFICATIONS_INTERVAL_MS ?? 10_000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Reminders are looked for at most once a minute.
      if (Date.now() - this.lastReminderRun >= 60_000) {
        this.lastReminderRun = Date.now();
        await this.raiseEtaReminders();
      }
      await this.dispatchDue();
    } catch (error) {
      this.logger.error(
        `Dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Sends every delivery that is due. Returns how many were attempted. */
  async dispatchDue(limit = 50): Promise<number> {
    const due = await this.database.claimDueDeliveries(limit);
    for (const delivery of due) await this.send(delivery);
    return due.length;
  }

  private async send(delivery: DueDelivery): Promise<void> {
    try {
      const result =
        delivery.channel === "email"
          ? await this.email.send({
              to: delivery.recipient,
              subject: delivery.subject,
              text: delivery.body,
              attachments: await this.quoteAttachment(delivery),
            })
          : await this.sms.send({
              to: delivery.recipient,
              text: delivery.smsText,
            });
      await this.database.markDeliverySent(
        delivery.id,
        delivery.channel === "email" ? this.email.name : this.sms.name,
        result.providerMessageId,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.database.markDeliveryFailed(
        delivery.id,
        reason,
        delivery.attempts >= MAX_ATTEMPTS
          ? null
          : retryDelaySeconds(delivery.attempts),
      );
      this.logger.warn(
        `${delivery.channel} delivery ${delivery.id} failed (attempt ${delivery.attempts}): ${reason}`,
      );
    }
  }

  private async quoteAttachment(delivery: DueDelivery) {
    if (delivery.event !== "quote_issued" && delivery.event !== "quote_sent") {
      return undefined;
    }
    const versionId = /^quote-(?:issued|sent):([0-9a-f-]{36})(?::|$)/.exec(
      delivery.dedupeKey,
    )?.[1];
    const quoteId = delivery.linkUrl
      ? /^\/quotes\/([0-9a-f-]{36})$/.exec(
          new URL(delivery.linkUrl).pathname,
        )?.[1]
      : undefined;
    if (!quoteId || !versionId)
      throw new Error("Quote PDF reference is missing");
    const quote = await this.database.findQuote(quoteId, {});
    if (!quote || quote.customerCompanyId !== delivery.companyId) {
      throw new Error("Quote PDF was not found for this customer");
    }
    const version = quote.versions.find(
      (item) => item.id === versionId && item.status === "issued",
    );
    if (!version) throw new Error("Issued quote version was not found");
    const settings = await this.database.getBusinessSettings();
    const content = await renderQuotePdf({
      quote,
      version,
      settings: settings?.settings ?? null,
    });
    const filename = `${(quote.quoteNumber ?? "quotation").replace(/[^A-Za-z0-9-]+/g, "-")}-v${version.versionNumber}.pdf`;
    return [{ filename, content }];
  }

  /**
   * One reminder per job and expected time, a day ahead. A new ETA is a new
   * expected time, so it gets its own reminder; the same one is never sent twice.
   */
  async raiseEtaReminders(): Promise<number> {
    const candidates =
      await this.database.listEtaReminderCandidates(REMINDER_HOURS);
    let queued = 0;
    for (const candidate of candidates) {
      const result = await this.notifications.notify({
        companyId: candidate.companyId,
        jobId: candidate.jobId,
        event: "eta_reminder",
        dedupeKey: `eta-reminder:${candidate.jobId}:${candidate.etaAt}`,
        message: (sender) =>
          etaReminderMessage(sender, candidate.fileNumber, candidate.etaAt),
        linkPath: `/jobs/${candidate.jobId}`,
      });
      if (result && result !== "duplicate") queued += 1;
    }
    return queued;
  }
}
