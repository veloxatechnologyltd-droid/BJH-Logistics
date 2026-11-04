import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseContract,
  pushSubscriptionInputSchema,
  pushUnsubscribeInputSchema,
} from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type { StaffRoleKey } from "../database/database.port";
import { PUSH_PROVIDER } from "./push-provider";
import type { PushMessage, PushProvider } from "./push-provider";

/** Who a notification goes to: named people and/or everyone holding one of these roles. */
export interface PushRecipients {
  userIds?: string[];
  roles?: StaffRoleKey[];
  /** Never the person who caused it (their own message, their own action). */
  exceptUserId?: string;
}

/**
 * Notifications to staff browsers and phones that work with BJH closed (Evans,
 * 2026-11-04). People opt in on their own device; a subscription is theirs and
 * only theirs. Sending never fails the action that caused it: a message is
 * saved first, announced after, and any failure is logged.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  /** The key a browser subscribes with; null when push is not set up on this server. */
  publicKey(): { publicKey: string | null } {
    return { publicKey: this.provider.publicKey };
  }

  async subscribe(userId: string, body: unknown, userAgent: string | null) {
    if (!this.provider.publicKey) {
      throw new ServiceUnavailableException(
        "Notifications are not set up on this server",
      );
    }
    const input = parseContract(pushSubscriptionInputSchema, body);
    if (!input.success) throw new BadRequestException(input.message);
    await this.database.savePushSubscription({
      userId,
      endpoint: input.data.endpoint,
      p256dh: input.data.keys.p256dh,
      auth: input.data.keys.auth,
      userAgent,
    });
    return { subscribed: true };
  }

  /** Only the person's own subscription can be removed. */
  async unsubscribe(userId: string, body: unknown) {
    const input = parseContract(pushUnsubscribeInputSchema, body);
    if (!input.success) throw new BadRequestException(input.message);
    await this.database.deletePushSubscription(userId, input.data.endpoint);
    return { subscribed: false };
  }

  /**
   * Tells people. Resolves when every send has been tried and never rejects,
   * so callers can `void` it.
   */
  async notify(
    recipients: PushRecipients,
    message: PushMessage,
  ): Promise<void> {
    if (!this.provider.publicKey) return;
    try {
      if (!recipients.userIds && !recipients.roles) return;
      const subscriptions = (
        await this.database.listPushSubscriptions({
          userIds: recipients.userIds,
          roles: recipients.roles,
        })
      ).filter((item) => item.userId !== recipients.exceptUserId);
      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            const result = await this.provider.send(subscription, message);
            if (result === "gone") {
              await this.database.deleteExpiredPushSubscription(
                subscription.endpoint,
              );
            }
          } catch (error) {
            this.logger.warn(
              `A notification could not be sent: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            );
          }
        }),
      );
    } catch (error) {
      this.logger.error(
        `Notifications were not sent: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
}
