import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { isUuid } from "@bjh/contracts";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
  SuperAdminGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { DatabasePort } from "../database/database.port";
import type { NotificationDeliveryRecord } from "../database/database.port";
import { JobsService } from "../jobs/jobs.service";
import { MessageDraftsService } from "./message-drafts.service";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { NotificationsService } from "./notifications.service";
import {
  EMAIL_PROVIDER,
  SMS_PROVIDER,
  type EmailProvider,
  type SmsProvider,
} from "./providers";

const statuses = ["pending", "sent", "failed", "skipped"] as const;

/** For the super admin: how messages are configured and what happened to them. */
@Controller("api/v1/admin/notifications")
@UseGuards(SupabaseIdentityGuard, SuperAdminGuard)
export class AdminNotificationsController {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(NotificationDispatcher)
    private readonly dispatcher: NotificationDispatcher,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  @Get()
  async list(
    @Query("status") status: string | undefined,
    @Query("limit") limit: string | undefined,
  ) {
    if (
      status !== undefined &&
      !(statuses as readonly string[]).includes(status)
    ) {
      throw new BadRequestException(
        `status must be one of ${statuses.join(", ")}`,
      );
    }
    const count = limit === undefined ? 100 : Number(limit);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new BadRequestException("limit must be 1 to 500");
    }
    return {
      channels: await this.notifications.channelMode(),
      // "stub" means nothing really leaves the machine: no account is configured.
      providers: { email: this.email.name, sms: this.sms.name },
      deliveries: await this.database.listNotificationLog({
        status: (status as NotificationDeliveryRecord["status"]) ?? null,
        limit: count,
      }),
    };
  }

  /** Sends everything that is due now, instead of waiting for the timer. */
  @Post("dispatch")
  async dispatch() {
    return { attempted: await this.dispatcher.dispatchDue() };
  }

  @Post("deliveries/:id/retry")
  async retry(@Param("id") id: string) {
    const result = isUuid(id)
      ? await this.database.retryNotificationDelivery(id)
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Delivery was not found");
    }
    if (result === "not_failed") {
      throw new BadRequestException("Only a failed delivery can be retried");
    }
    return result;
  }
}

const feedEvents = [
  "message",
  "broadcast",
  "quote_issued",
  "quote_sent",
  "milestone",
  "eta",
  "eta_reminder",
  "invoice_issued",
  "payment_received",
  "receipt_sent",
  "chat_message",
  "delivery_dispatched",
  "delivery_delivered",
  "email_reply",
  "inquiry_reply",
] as const;

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

/** Messages to the customer on one job: staff read what was sent and send more. */
@Controller("api/v1/jobs/:id")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class JobMessagesController {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(MessageDraftsService)
    private readonly drafts: MessageDraftsService,
  ) {}

  @Get("notifications")
  async list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    const job = await this.jobs.get(id, scopeOf(request));
    return this.database.listJobNotifications(job.id);
  }

  @Post("messages")
  async send(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const job = await this.jobs.get(id, scopeOf(request));
    return this.notifications.sendJobMessage(
      job,
      body,
      request.authUser!.userId,
    );
  }

  /** The AI drafts a message about this job; nothing is sent. */
  @Post("messages/draft")
  async draft(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const job = await this.jobs.get(id, scopeOf(request));
    return this.drafts.draftJobMessage(job, body);
  }
}

/** Client communication across every job: read what was sent, and write to clients. */
@Controller("api/v1/messages")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class ClientMessagesController {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(MessageDraftsService)
    private readonly drafts: MessageDraftsService,
  ) {}

  @Get()
  async feed(
    @Query("companyId") companyId: string | undefined,
    @Query("event") event: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (companyId !== undefined && !isUuid(companyId)) {
      throw new BadRequestException("companyId must be a valid ID");
    }
    if (
      event !== undefined &&
      !(feedEvents as readonly string[]).includes(event)
    ) {
      throw new BadRequestException(
        `event must be one of ${feedEvents.join(", ")}`,
      );
    }
    const count = limit === undefined ? 100 : Number(limit);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new BadRequestException("limit must be 1 to 500");
    }
    return {
      channels: await this.notifications.channelMode(),
      aiDrafting: this.drafts.available,
      messages: await this.database.listNotificationFeed({
        companyId: companyId ?? null,
        event: event ?? null,
        serviceLines: request.allowedServiceLines ?? null,
        limit: count,
      }),
    };
  }

  @Post()
  send(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.notifications.sendClientMessage(body, request.authUser!.userId);
  }

  /** The AI drafts a message to clients, using no customer's data; nothing is sent. */
  @Post("draft")
  draft(@Body() body: unknown) {
    return this.drafts.draftClientMessage(body);
  }
}
