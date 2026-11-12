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
  INQUIRY_EMAIL_PROVIDER,
  REPLY_EMAIL_PROVIDER,
  SMS_PROVIDER,
  type EmailProvider,
  type ReplySender,
  type SmsProvider,
} from "./providers";
import { replyEvents, replyHtml, replyText } from "./reply-template";
import { etaReminderMessage } from "./notification-messages";
import { NotificationsService } from "./notifications.service";
import { InvoicesService, invoiceView } from "../finance/invoices.service";
import {
  renderBatchReceiptPdf,
  renderReceiptPdf,
} from "../finance/receipt-pdf";
import { renderQuotePdf } from "../quotations/quote-pdf";
import { JobReportService } from "../finance/job-report.service";
import {
  OVERDUE_AFTER_HOURS,
  OVERDUE_WITHIN_DAYS,
} from "./staff-notifications.service";

/** A delivery is tried this many times before it is left as failed for a person to retry. */
export const MAX_ATTEMPTS = 5;
/** Waits before attempts 2, 3, 4 and 5: 1, 4, 9 and 16 minutes. */
export const retryDelaySeconds = (attemptsSoFar: number) =>
  attemptsSoFar * attemptsSoFar * 60;
/** How many days before a vehicle's insurance, DVLA or service date the super admin is told. */
export const VEHICLE_NOTICE_DAYS = 14;
/** An ETA that passed longer ago than this raises no notice (so switching it on floods nobody). */
export const ETA_NOTICE_WITHIN_DAYS = 7;
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
    @Inject(INQUIRY_EMAIL_PROVIDER)
    private readonly inquiryEmail: EmailProvider,
    @Inject(REPLY_EMAIL_PROVIDER)
    private readonly replySender: ReplySender | null,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(JobReportService) private readonly jobReports: JobReportService,
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
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
        // Customer service is told about requests and inquiries left waiting.
        await this.database.raiseOverdueRequestNotices(
          OVERDUE_AFTER_HOURS,
          OVERDUE_WITHIN_DAYS,
        );
        // The super admin is told before a vehicle's insurance, DVLA or service falls due.
        await this.database.raiseVehicleNotices(VEHICLE_NOTICE_DAYS);
        // The people on a job are told when its ETA has passed.
        await this.database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS);
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
    // A reply to a customer's email goes out in the reply template, from
    // Henry's mailbox when it is set up, with Reply-To the mailbox the request
    // came in on. Otherwise replies to inquiries go out from the inquiries
    // mailbox, and everything else from the main one.
    const isReply = replyEvents.includes(delivery.event);
    const inquiry = delivery.event === "inquiry_reply";
    const henry = isReply ? this.replySender : null;
    const email = henry?.email ?? (inquiry ? this.inquiryEmail : this.email);
    try {
      const result =
        delivery.channel === "email"
          ? await email.send({
              to: delivery.recipient,
              subject: delivery.subject,
              text: isReply ? replyText(delivery.body) : delivery.body,
              html: isReply ? replyHtml(delivery.body) : undefined,
              replyTo:
                (henry &&
                  (inquiry ? henry.replyTo.inquiries : henry.replyTo.quotes)) ||
                undefined,
              inReplyTo: isReply ? await this.inReplyTo(delivery) : undefined,
              attachments:
                (await this.quoteAttachment(delivery)) ??
                (await this.receiptAttachment(delivery)) ??
                (await this.summaryAttachment(delivery)) ??
                (await this.jobReportAttachment(delivery)),
            })
          : await this.sms.send({
              to: delivery.recipient,
              text: delivery.smsText,
            });
      await this.database.markDeliverySent(
        delivery.id,
        delivery.channel === "email" ? email.name : this.sms.name,
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

  private async inReplyTo(delivery: DueDelivery) {
    const requestId = /^email-reply:([0-9a-f-]{36})(?::|$)/.exec(
      delivery.dedupeKey,
    )?.[1];
    if (!requestId) return undefined;
    return (
      (await this.database.findRequestEmailMessageId(requestId)) ?? undefined
    );
  }

  private async jobReportAttachment(delivery: DueDelivery) {
    if (delivery.event !== "job_report_sent") return undefined;
    const query = delivery.jobReportQuery;
    if (!query || query.companyId !== delivery.companyId) {
      throw new Error("Job report reference is missing");
    }
    const { file, filename } = await this.jobReports.pdfOf(query, {});
    return [{ filename, content: file }];
  }

  /** The invoice or payment summary, made when the email goes out. */
  private async summaryAttachment(delivery: DueDelivery) {
    const invoices = /^invoice-summary-sent:([0-9a-f-]{36}):/.exec(
      delivery.dedupeKey,
    );
    const payments =
      /^payment-summary-sent:([0-9a-f-]{36}):([\d-]*):([\d-]*):(\w*):/.exec(
        delivery.dedupeKey,
      );
    const companyId = invoices?.[1] ?? payments?.[1];
    if (!companyId) return undefined;
    if (companyId !== delivery.companyId) {
      throw new Error("Summary was not found for this customer");
    }
    const { file, filename } = invoices
      ? await this.invoices.invoiceSummaryPdf(
          { companyId, owingOnly: true },
          {},
        )
      : await this.invoices.paymentSummaryPdf(
          {
            companyId,
            from: payments?.[2],
            to: payments?.[3],
            method: payments?.[4],
          },
          {},
        );
    return [{ filename, content: file }];
  }

  private async receiptAttachment(delivery: DueDelivery) {
    if (delivery.event !== "receipt_sent") return undefined;
    const paymentId = /^receipt-sent:([0-9a-f-]{36}):/.exec(
      delivery.dedupeKey,
    )?.[1];
    const jobId = delivery.linkUrl
      ? /^\/jobs\/([0-9a-f-]{36})\/money$/.exec(
          new URL(delivery.linkUrl).pathname,
        )?.[1]
      : undefined;
    if (!paymentId || !jobId) throw new Error("Receipt reference is missing");
    const job = await this.database.findJob(jobId, {});
    if (!job || job.customerCompanyId !== delivery.companyId) {
      throw new Error("Receipt was not found for this customer");
    }
    const [invoices, payments, settings] = await Promise.all([
      this.database.listInvoices(job.id),
      this.database.listInvoicePayments(job.id),
      this.database.getBusinessSettings(),
    ]);
    const payment = payments.find((item) => item.id === paymentId);
    const invoice = invoices.find((item) => item.id === payment?.invoiceId);
    if (!payment?.receiptNumber || !invoice) {
      throw new Error("Receipt was not found");
    }
    const content = payment.batchId
      ? await renderBatchReceiptPdf({
          lines: await this.database.listBatchReceipt(payment.batchId, [
            job.customerCompanyId,
          ]),
          settings: settings?.settings ?? null,
        })
      : await renderReceiptPdf({
          payment,
          invoice: invoiceView(
            invoice,
            payments.filter((item) => item.invoiceId === invoice.id),
            false,
          ),
          job,
          customerCompanyName: job.customerCompanyName,
          settings: settings?.settings ?? null,
        });
    const filename = `${payment.receiptNumber.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
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
