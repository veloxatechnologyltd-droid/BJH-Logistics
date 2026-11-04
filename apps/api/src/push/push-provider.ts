import { Logger } from "@nestjs/common";
import * as webpush from "web-push";

export const PUSH_PROVIDER = Symbol("PUSH_PROVIDER");

/** What a notification says. It is encrypted for the one browser it is sent to. */
export interface PushMessage {
  title: string;
  body: string;
  /** A path in the web app that a click opens, e.g. `/team-chat?c=<id>`. */
  url: string;
  /** One notification per tag: a newer message with the same tag replaces it and raises its count. */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushProvider {
  /** "web-push", or "stub" when no VAPID keys are configured. */
  readonly name: string;
  /** The public VAPID key browsers subscribe with; null when push is not set up. */
  readonly publicKey: string | null;
  /** "gone" when the push service says the browser unsubscribed; throws on any other failure. */
  send(target: PushTarget, message: PushMessage): Promise<"sent" | "gone">;
}

/**
 * Local and test provider: nothing leaves the machine. Used whenever the VAPID
 * keys are not configured; with `publicKey` null, browsers are not offered
 * notifications, so there is nothing to send.
 */
export class RecordingPushProvider implements PushProvider {
  readonly name = "stub";
  readonly sent: Array<{ target: PushTarget; message: PushMessage }> = [];
  /** Endpoints the push service should report as gone, for tests. */
  goneEndpoints = new Set<string>();
  /** Endpoints whose send should fail, for tests. */
  failEndpoints = new Set<string>();

  constructor(public publicKey: string | null = null) {}

  async send(
    target: PushTarget,
    message: PushMessage,
  ): Promise<"sent" | "gone"> {
    if (this.goneEndpoints.has(target.endpoint)) return "gone";
    if (this.failEndpoints.has(target.endpoint)) {
      throw new Error("push service unavailable");
    }
    this.sent.push({ target, message });
    return "sent";
  }
}

/** Web Push (RFC 8030) with VAPID (RFC 8292), through the `web-push` library. */
export class WebPushProvider implements PushProvider {
  readonly name = "web-push";

  constructor(
    readonly publicKey: string,
    privateKey: string,
    subject: string,
  ) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(
    target: PushTarget,
    message: PushMessage,
  ): Promise<"sent" | "gone"> {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(message),
        // A browser that was off for a few hours still hears about it; a
        // message older than a day is not worth delivering late.
        { TTL: 24 * 60 * 60, urgency: "normal", timeout: 10_000 },
      );
      return "sent";
    } catch (error) {
      if (
        error instanceof webpush.WebPushError &&
        (error.statusCode === 404 || error.statusCode === 410)
      ) {
        return "gone";
      }
      throw error;
    }
  }
}

/**
 * Needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (made once with
 * `npx web-push generate-vapid-keys`) and `VAPID_SUBJECT`, a `mailto:` or
 * `https:` contact the push services can reach if the keys misbehave. Without
 * all three, push is off: nothing is offered to browsers and nothing is sent.
 */
export function createPushProvider(
  environment: NodeJS.ProcessEnv,
): PushProvider {
  const publicKey = environment.VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.VAPID_PRIVATE_KEY?.trim();
  const subject = environment.VAPID_SUBJECT?.trim();
  if (publicKey && privateKey && subject) {
    return new WebPushProvider(publicKey, privateKey, subject);
  }
  if (publicKey || privateKey || subject) {
    new Logger("PushProvider").warn(
      "Push notifications are off: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must all be set",
    );
  }
  return new RecordingPushProvider(null);
}
