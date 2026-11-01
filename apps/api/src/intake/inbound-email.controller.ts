import {
  CanActivate,
  Controller,
  ExecutionContext,
  HttpCode,
  Inject,
  Injectable,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Body,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { createHash, timingSafeEqual } from "node:crypto";
import { EmailAssistantService } from "./email-assistant.service";
import { InboundEmailService } from "./inbound-email.service";
import { MailboxReaderService } from "./mailbox-reader.service";
import { RequestCopyService } from "./request-copy.service";
import type { ReceivedFile } from "./inbound-email.service";

/** The secret an email service sends: as a Bearer token, as the password of Basic auth (how most services call a webhook URL), or in `x-inbound-secret`. */
export function suppliedSecret(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const header = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const authorization = header("authorization")?.trim() ?? "";
  if (/^bearer\s+/i.test(authorization)) {
    return authorization.replace(/^bearer\s+/i, "").trim() || null;
  }
  if (/^basic\s+/i.test(authorization)) {
    const decoded = Buffer.from(
      authorization.replace(/^basic\s+/i, ""),
      "base64",
    ).toString("utf8");
    return decoded.slice(decoded.indexOf(":") + 1) || null;
  }
  return header("x-inbound-secret")?.trim() || null;
}

export function matchesSecret(supplied: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

/** Only the email service that knows `INBOUND_EMAIL_SECRET` may post an email; with no secret set, intake is off. */
@Injectable()
export class InboundEmailSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INBOUND_EMAIL_SECRET?.trim();
    if (!expected) {
      throw new ServiceUnavailableException("Email intake is not set up");
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const supplied = suppliedSecret(request.headers);
    if (!supplied || !matchesSecret(supplied, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/**
 * Where the email service posts each customer email (multipart form): `from_email`,
 * optional `from_name`, `to`, `subject`, `text`, `html`, `message_id`, `received_at`,
 * and the attachments as files. Any 2xx means the email was kept.
 */
@Controller("api/v1/inbound-email")
@UseGuards(InboundEmailSecretGuard)
export class InboundEmailController {
  constructor(
    @Inject(InboundEmailService)
    private readonly inbound: InboundEmailService,
    @Inject(EmailAssistantService)
    private readonly assistant: EmailAssistantService,
    @Inject(MailboxReaderService)
    private readonly mailbox: MailboxReaderService,
    @Inject(RequestCopyService) private readonly copies: RequestCopyService,
  ) {}

  @Post()
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 30 * 1024 * 1024,
        files: 50,
        fields: 60,
        fieldSize: 2 * 1024 * 1024,
      },
    }),
  )
  async receive(
    @Body() fields: Record<string, unknown>,
    @UploadedFiles() files: ReceivedFile[] | undefined,
  ) {
    const received = await this.inbound.receive(fields ?? {}, files ?? []);
    // A website request is also copied to the quote mailbox, where staff look.
    if (!received.duplicate && fields?.source === "website") {
      const text = (key: string) =>
        typeof fields[key] === "string" ? (fields[key] as string) : "";
      await this.copies.send({
        id: received.requestId,
        channel: "website",
        from: text("from_name") || text("from_email"),
        email: text("from_email"),
        message: text("text"),
      });
    }
    // Once read, the assistant links the customer and drafts the quote and the reply.
    if (!received.duplicate && received.reading === "done") {
      await this.assistant.afterReading(received.requestId);
    }
    return received;
  }

  /** Reads BJH's request mailbox now (a scheduler can call this to wake the API); 503 when no mailbox is set up. */
  @Post("poll")
  @HttpCode(200)
  poll() {
    if (!this.mailbox.enabled) {
      throw new ServiceUnavailableException("No mailbox is set up");
    }
    return this.mailbox.poll();
  }
}
