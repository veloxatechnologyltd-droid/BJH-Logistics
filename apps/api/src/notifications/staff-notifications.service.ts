import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isUuid,
  parseContract,
  reminderInputSchema,
  snoozeInputSchema,
} from "@bjh/contracts";
import {
  DatabasePort,
  StaffNotificationRecord,
} from "../database/database.port";

/** A quote request or inquiry is overdue once it has waited this long (Evans: two days). */
export const OVERDUE_AFTER_HOURS = 48;
/** Older requests are left alone, so switching this on does not flood anyone. */
export const OVERDUE_WITHIN_DAYS = 30;

/**
 * Notices for one staff member: requests and inquiries waiting too long (for
 * customer service) and the reminders they set themselves. Each is theirs to
 * dismiss or put off; nobody else sees it.
 */
@Injectable()
export class StaffNotificationsService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  async list(userId: string): Promise<{
    due: StaffNotificationRecord[];
    upcoming: StaffNotificationRecord[];
  }> {
    const now = new Date().toISOString();
    const open = await this.database.listStaffNotifications(userId);
    return {
      due: open.filter((item) => item.dueAt <= now).reverse(),
      upcoming: open.filter((item) => item.dueAt > now),
    };
  }

  /** "I will attend to this request on <date, time>." */
  async remind(
    requestId: string,
    input: unknown,
    userId: string,
  ): Promise<StaffNotificationRecord> {
    const parsed = parseContract(reminderInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    if (parsed.data.remindAt <= new Date().toISOString()) {
      throw new BadRequestException("remindAt must be in the future");
    }
    const request = isUuid(requestId)
      ? await this.database.findQuoteRequest(requestId)
      : null;
    if (!request) throw new NotFoundException("Quote request was not found");
    const what = request.mailbox === "inquiries" ? "inquiry" : "quote request";
    return this.database.createStaffReminder({
      userId,
      quoteRequestId: request.id,
      title: `Attend to the ${what} from ${request.companyName}`.slice(0, 200),
      note: parsed.data.note,
      dueAt: parsed.data.remindAt,
      createdBy: userId,
    });
  }

  async dismiss(
    notificationId: string,
    userId: string,
  ): Promise<StaffNotificationRecord> {
    return this.found(
      isUuid(notificationId)
        ? await this.database.updateStaffNotification(userId, notificationId, {
            dismiss: true,
          })
        : "not_found",
    );
  }

  async snooze(
    notificationId: string,
    input: unknown,
    userId: string,
  ): Promise<StaffNotificationRecord> {
    const parsed = parseContract(snoozeInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const dueAt = new Date(
      Date.now() + parsed.data.minutes * 60_000,
    ).toISOString();
    return this.found(
      isUuid(notificationId)
        ? await this.database.updateStaffNotification(userId, notificationId, {
            dueAt,
          })
        : "not_found",
    );
  }

  raiseOverdue(): Promise<number> {
    return this.database.raiseOverdueRequestNotices(
      OVERDUE_AFTER_HOURS,
      OVERDUE_WITHIN_DAYS,
    );
  }

  private found(
    result: StaffNotificationRecord | "not_found",
  ): StaffNotificationRecord {
    if (result === "not_found") {
      throw new NotFoundException("Notice was not found");
    }
    return result;
  }
}
