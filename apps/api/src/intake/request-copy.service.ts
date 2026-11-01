import { Inject, Injectable, Logger } from "@nestjs/common";
import { EMAIL_PROVIDER } from "../notifications/providers";
import type { EmailProvider } from "../notifications/providers";
import { publicWebUrl } from "../notifications/notifications.service";

/** Marks a copy so the mailbox reader never takes it back in as a new request. */
export const REQUEST_COPY_SUBJECT_PREFIX = "[BJH copy]";

/** The address copies go to: `REQUEST_COPY_TO`, else the quote mailbox the API reads. */
export function requestCopyAddress(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    environment.REQUEST_COPY_TO?.trim() ||
    environment.INBOUND_IMAP_USER?.trim() ||
    null
  );
}

/** True for a copy this service sent, read back from the quote mailbox. */
export function isRequestCopy(subject: string | undefined): boolean {
  return Boolean(subject?.startsWith(REQUEST_COPY_SUBJECT_PREFIX));
}

/**
 * Website and portal requests land in the system only, so staff who watch the
 * quote mailbox would miss them (client meeting, 2026-11-01). Each one is also
 * emailed there, with a link to the request. A copy that fails is logged; the
 * request itself is already saved.
 */
@Injectable()
export class RequestCopyService {
  private readonly logger = new Logger(RequestCopyService.name);

  constructor(@Inject(EMAIL_PROVIDER) private readonly email: EmailProvider) {}

  async send(request: {
    id: string;
    channel: "website" | "portal";
    /** Who sent it, as shown in the subject: a person, and their company when known. */
    from: string;
    email: string;
    message: string;
  }): Promise<void> {
    const to = requestCopyAddress();
    if (!to) return;
    const where = request.channel === "website" ? "website" : "client portal";
    try {
      await this.email.send({
        to,
        subject: `${REQUEST_COPY_SUBJECT_PREFIX} New quote request from ${request.from} (${where})`,
        text: [
          `A quote request came in through the ${where}.`,
          "",
          `From: ${request.from} <${request.email}>`,
          "",
          request.message,
          "",
          `Open it in the system: ${publicWebUrl()}/quotations/requests/${request.id}`,
          "",
          "This is a copy for the mailbox; the request is already in the system.",
        ].join("\n"),
      });
    } catch (error) {
      this.logger.warn(
        `Copy of request ${request.id} to ${to} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
