import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  clientMessageInputSchema,
  correspondenceInputSchema,
  jobMessageInputSchema,
  parseContract,
  type JobReportQuery,
  type NotificationChannelMode,
} from "@bjh/contracts";
import { BadRequestException } from "@nestjs/common";
import {
  CustomerContactRecord,
  DatabasePort,
  JobRecord,
  NotificationRecord,
} from "../database/database.port";
import { type Message, staffMessage } from "./notification-messages";
import { normalizePhone } from "./phone";

export interface NotifyInput {
  companyId: string;
  jobId?: string | null;
  event: string;
  /** The same key is never queued twice, so retries and repeats cannot double-send. */
  dedupeKey: string;
  message: (sender: string) => Message;
  /** A path in the web app, added to the message as a link. */
  linkPath?: string | null;
  createdBy?: string | null;
  /** The job report to attach to the email. */
  jobReportQuery?: JobReportQuery | null;
}

/** The base address of the web app, used to build the links in messages. */
export function publicWebUrl(environment: NodeJS.ProcessEnv = process.env) {
  const configured =
    environment.PUBLIC_WEB_URL ??
    environment.WEB_ORIGIN?.split(",")[0] ??
    "http://127.0.0.1:3002";
  return configured.trim().replace(/\/$/, "");
}

/**
 * Every message to a customer goes through here: it decides the channels (the
 * super admin's choice of email, SMS or both), finds the company's contacts,
 * adds the link, and queues one delivery per contact and channel. Sending
 * itself happens later, in the dispatcher.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  /** The chosen channel mode; both until the super admin says otherwise. */
  async channelMode(): Promise<NotificationChannelMode> {
    const current = await this.database.getBusinessSettings();
    return current?.settings.notifications?.channels ?? "both";
  }

  async senderName(): Promise<string> {
    const current = await this.database.getBusinessSettings();
    return current?.settings.issuer.name ?? "BJH Logistics";
  }

  /**
   * Queues a customer message. Never throws: a failure to notify must not
   * undo the action that caused it, so problems are logged instead.
   */
  async notify(
    input: NotifyInput,
  ): Promise<NotificationRecord | "duplicate" | null> {
    try {
      return await this.queue(input);
    } catch (error) {
      this.logger.error(
        `Could not queue ${input.event} (${input.dedupeKey}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async queue(input: NotifyInput): Promise<NotificationRecord | "duplicate"> {
    const [mode, sender, customer] = await Promise.all([
      this.channelMode(),
      this.senderName(),
      this.database.findCustomer(input.companyId),
    ]);
    const message = input.message(sender);
    const linkUrl = input.linkPath
      ? `${publicWebUrl()}${input.linkPath}`
      : null;
    const contacts = (customer?.contacts ?? []).filter(
      (contact) => contact.notify !== false,
    );
    const deliveries = contacts.flatMap((contact) =>
      this.deliveriesFor(contact, mode),
    );
    return this.database.queueNotification({
      companyId: input.companyId,
      jobId: input.jobId ?? null,
      event: input.event,
      dedupeKey: input.dedupeKey,
      subject: message.subject,
      body: linkUrl
        ? `${message.body}\n\nView it here: ${linkUrl}`
        : message.body,
      smsText: linkUrl ? `${message.smsText} ${linkUrl}` : message.smsText,
      linkUrl,
      createdBy: input.createdBy ?? null,
      jobReportQuery: input.jobReportQuery ?? null,
      deliveries,
    });
  }

  private deliveriesFor(
    contact: CustomerContactRecord,
    mode: NotificationChannelMode,
  ) {
    const rows: Array<{
      contactId: string;
      channel: "email" | "sms";
      recipient: string | null;
      skipReason: string | null;
    }> = [];
    if (mode !== "sms") {
      rows.push({
        contactId: contact.id,
        channel: "email",
        recipient: contact.email,
        skipReason: null,
      });
    }
    if (mode !== "email") {
      const phone = contact.phone ? normalizePhone(contact.phone) : null;
      rows.push({
        contactId: contact.id,
        channel: "sms",
        recipient: phone,
        skipReason: contact.phone
          ? phone
            ? null
            : "The phone number is not valid"
          : "No phone number for this contact",
      });
    }
    return rows;
  }

  /** A message typed by staff, sent by the configured channels and logged as correspondence. */
  async sendJobMessage(
    job: JobRecord,
    input: unknown,
    sentBy: string,
  ): Promise<NotificationRecord> {
    const parsed = parseContract(jobMessageInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = await this.queue({
      companyId: job.customerCompanyId,
      jobId: job.id,
      event: "message",
      dedupeKey: `message:${randomUUID()}`,
      message: (sender) =>
        staffMessage(sender, parsed.data.subject, parsed.data.body),
      linkPath: `/jobs/${job.id}`,
      createdBy: sentBy,
    });
    if (result === "duplicate") {
      throw new BadRequestException("The message was already queued");
    }
    const mode = await this.channelMode();
    const logged = correspondenceInputSchema.safeParse({
      channel: mode === "sms" ? "sms" : "email",
      direction: "sent",
      counterparty: job.customerCompanyName,
      subject: parsed.data.subject ?? undefined,
      body: `${parsed.data.body}${mode === "both" ? "\n\n(Sent by email and SMS.)" : ""}`,
    });
    if (logged.success) {
      await this.database.addJobCorrespondence({
        jobId: job.id,
        channel: logged.data.channel,
        direction: "sent",
        occurredAt: new Date().toISOString(),
        counterparty: logged.data.counterparty,
        subject: logged.data.subject,
        body: logged.data.body,
        documentId: null,
        recordedBy: sentBy,
      });
    }
    return result;
  }

  /** How many of a company's contacts would receive a message (those not switched off). */
  async notifiableContactCount(companyId: string): Promise<number> {
    const customer = await this.database.findCustomer(companyId);
    return (customer?.contacts ?? []).filter(
      (contact) => contact.notify !== false,
    ).length;
  }

  /**
   * A message typed by staff to one company, several, or all of them, that is
   * not about a particular job. Each company gets its own notification, and a
   * company with no contact to notify is reported instead of silently dropped.
   */
  async sendClientMessage(input: unknown, sentBy: string) {
    const parsed = parseContract(clientMessageInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { audience, subject, body } = parsed.data;

    const everyone = await this.database.listCustomers("");
    const chosen =
      audience === "all"
        ? everyone
        : everyone.filter((company) => audience.includes(company.id));
    if (audience !== "all" && chosen.length !== new Set(audience).size) {
      throw new BadRequestException("One or more companies were not found");
    }
    if (chosen.length === 0) {
      throw new BadRequestException("There are no companies to message");
    }

    const event =
      audience === "all" || audience.length > 1 ? "broadcast" : "message";
    const batch = randomUUID();
    const sent: Array<{
      companyId: string;
      companyName: string;
      notificationId: string;
    }> = [];
    const skipped: Array<{
      companyId: string;
      companyName: string;
      reason: string;
    }> = [];
    for (const company of chosen) {
      if (!company.contacts.some((contact) => contact.notify !== false)) {
        skipped.push({
          companyId: company.id,
          companyName: company.companyName,
          reason: "No contact to notify",
        });
        continue;
      }
      const result = await this.queue({
        companyId: company.id,
        event,
        dedupeKey: `${event}:${batch}:${company.id}`,
        message: (sender) => staffMessage(sender, subject, body),
        linkPath: "/portal",
        createdBy: sentBy,
      });
      if (result !== "duplicate") {
        sent.push({
          companyId: company.id,
          companyName: company.companyName,
          notificationId: result.id,
        });
      }
    }
    return { event, sent, skipped };
  }
}
