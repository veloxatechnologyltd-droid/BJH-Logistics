import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { parseContract, requestDetailsSchema } from "@bjh/contracts";
import type { RequestDetails } from "@bjh/contracts";
import { serviceLinesForRoles } from "../auth/auth.guards";
import { DatabasePort } from "../database/database.port";
import type {
  QuoteRequestRecord,
  StaffRoleKey,
} from "../database/database.port";
import {
  DOCUMENT_STORAGE,
  SIGNED_URL_SECONDS,
} from "../documents/document-storage.port";
import type { DocumentStorage } from "../documents/document-storage.port";
import { sanitizeFilename } from "../documents/file-signature";
import { EMAIL_EXTRACTOR, ExtractionError } from "./email-extractor";
import type { EmailExtractor, EmailForExtraction } from "./email-extractor";

export interface ReceivedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** Office and image files a customer would attach to a request; the type is decided by the name, never the sender's claim. */
const attachmentTypes: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 5000;
const MAX_BODY_CHARS = 200_000;

const clip = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const EMAIL_ADDRESS = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** An HTML-only email is read as plain text: tags dropped, the usual entities decoded. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Who may check an email request's details, correct them and have the email
 * read again: the super admin, and the representative in charge of the
 * request's service (the sea import rep for sea import, and so on; road and
 * warehousing work is shared by every rep). While the service is unknown only
 * the super admin can, so someone must first say what it is.
 */
export function inChargeOf(
  details: RequestDetails,
  roles: StaffRoleKey[],
): boolean {
  if (roles.includes("super_admin")) return true;
  return (
    details.service !== null &&
    serviceLinesForRoles(roles).includes(details.service)
  );
}

/**
 * Customer requests that arrive by email. An email service posts each message
 * in (nothing here reads a mailbox); the email is kept with its attachments, a
 * request is created from it, and AI reads it to fill in the request details
 * for a person to check. A reading that fails never loses the email.
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(EMAIL_EXTRACTOR) private readonly extractor: EmailExtractor,
  ) {}

  async receive(
    fields: Record<string, unknown>,
    files: ReceivedFile[],
  ): Promise<{
    requestId: string;
    duplicate: boolean;
    reading: "pending" | "done" | "failed";
  }> {
    const email = this.normalize(fields);
    // An email delivered twice is one request; the second delivery stores nothing.
    const existing = await this.database.findQuoteRequestByMessageId(
      email.messageId,
    );
    if (existing) {
      return {
        requestId: existing.id,
        duplicate: true,
        reading: existing.intake?.extractionStatus ?? "pending",
      };
    }
    const kept = await this.keepAttachments(files);
    const created = await this.database.createEmailQuoteRequest({
      email: {
        messageId: email.messageId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        toAddress: email.toAddress,
        subject: email.subject,
        bodyText: email.bodyText,
        receivedAt: email.receivedAt,
      },
      request: {
        id: randomUUID(),
        companyName: email.fromName ?? email.fromEmail,
        contactName: email.fromName ?? email.fromEmail.split("@")[0],
        message: email.message,
      },
      attachments: kept.stored,
      skipped: kept.skipped,
    });
    if (created.duplicate) {
      return {
        requestId: created.request.id,
        duplicate: true,
        reading: created.request.intake?.extractionStatus ?? "pending",
      };
    }
    const reading = await this.read(created.request.id, {
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      subject: email.subject,
      bodyText: email.bodyText || email.subject,
    });
    return { requestId: created.request.id, duplicate: false, reading };
  }

  /** Reads the saved email again, for a request whose reading failed or never finished. */
  async readAgain(
    requestId: string,
    roles: StaffRoleKey[],
  ): Promise<QuoteRequestRecord & { canCheck: boolean }> {
    await this.requireInCharge(requestId, roles);
    const begun = await this.database.beginEmailReading(requestId);
    if (begun === "not_found") {
      throw new NotFoundException("Quote request was not found");
    }
    if (begun === "not_email") {
      throw new ConflictException("This request did not come from an email");
    }
    if (begun === "reviewed") {
      throw new ConflictException(
        "The details of this request were already checked, so the email is not read again",
      );
    }
    await this.read(begun.requestId, {
      fromName: begun.fromName,
      fromEmail: begun.fromEmail,
      subject: begun.subject,
      bodyText: begun.bodyText || begun.subject,
    });
    const request = await this.database.findQuoteRequest(requestId);
    if (!request) throw new NotFoundException("Quote request was not found");
    return { ...request, canCheck: inChargeOf(request.details, roles) };
  }

  /**
   * A person's corrected details; saving them records that the request was
   * checked. Changing the service hands the request to that service's rep.
   */
  async saveDetails(
    requestId: string,
    input: unknown,
    reviewedBy: string,
    roles: StaffRoleKey[],
  ): Promise<QuoteRequestRecord & { canCheck: boolean }> {
    await this.requireInCharge(requestId, roles);
    const parsed = parseContract(requestDetailsSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const saved = await this.database.saveRequestDetails(
      requestId,
      parsed.data,
      reviewedBy,
    );
    if (saved === "not_found") {
      throw new NotFoundException("Quote request was not found");
    }
    if (saved === "not_email") {
      throw new ConflictException("This request did not come from an email");
    }
    return { ...saved, canCheck: inChargeOf(saved.details, roles) };
  }

  private async requireInCharge(
    requestId: string,
    roles: StaffRoleKey[],
  ): Promise<void> {
    const request = await this.database.findQuoteRequest(requestId);
    if (!request) throw new NotFoundException("Quote request was not found");
    if (!request.intake) {
      throw new ConflictException("This request did not come from an email");
    }
    if (!inChargeOf(request.details, roles)) {
      throw new ForbiddenException(
        "Only the super admin or the representative in charge of this request's service can check it",
      );
    }
  }

  /** A short-lived link to one attachment of an email request. */
  async attachmentLink(
    requestId: string,
    attachmentId: string,
  ): Promise<{ url: string; filename: string }> {
    const attachment = await this.database.findRequestAttachment(
      requestId,
      attachmentId,
    );
    if (!attachment) throw new NotFoundException("Attachment was not found");
    return {
      url: await this.storage.createSignedUrl(
        attachment.objectKey,
        SIGNED_URL_SECONDS,
      ),
      filename: attachment.filename,
    };
  }

  private async read(
    requestId: string,
    email: EmailForExtraction,
  ): Promise<"done" | "failed"> {
    try {
      const extracted = await this.extractor.extract(email);
      await this.database.completeEmailReading(requestId, {
        status: "done",
        model: this.extractor.model ?? this.extractor.name,
        companyName: extracted.companyName,
        contactName: extracted.contactName,
        details: extracted.details,
      });
      return "done";
    } catch (error) {
      const known = error instanceof ExtractionError;
      if (!known) {
        this.logger.error(
          `Reading email request ${requestId} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.database.completeEmailReading(requestId, {
        status: "failed",
        model: this.extractor.model,
        error: known ? error.message : "The email could not be read",
      });
      return "failed";
    }
  }

  /** Stores the attachments worth keeping; one that is not kept is listed with its reason, and never costs the email. */
  private async keepAttachments(files: ReceivedFile[]) {
    const stored: Array<{
      filename: string;
      contentType: string;
      sizeBytes: number;
      sha256: string;
      objectKey: string;
    }> = [];
    const skipped: Array<{ filename: string; reason: string }> = [];
    let total = 0;
    for (const file of files) {
      const filename = sanitizeFilename(file.originalname || "attachment");
      const extension = filename.split(".").pop()?.toLowerCase() ?? "";
      const contentType = attachmentTypes[extension];
      const refuse = (reason: string) => skipped.push({ filename, reason });
      if (!contentType) refuse("This type of file is not kept");
      else if (file.size === 0) refuse("The file was empty");
      else if (file.size > MAX_ATTACHMENT_BYTES) {
        refuse("The file is larger than 10 MB");
      } else if (stored.length >= MAX_ATTACHMENTS) {
        refuse("Only the first 10 attachments are kept");
      } else if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        refuse("The attachments together are larger than 25 MB");
      } else {
        const objectKey = `inbound-email/${randomUUID()}`;
        try {
          await this.storage.put(objectKey, file.buffer, contentType);
        } catch {
          refuse("The file could not be stored");
          continue;
        }
        total += file.size;
        stored.push({
          filename,
          contentType,
          sizeBytes: file.size,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
          objectKey,
        });
      }
    }
    return { stored, skipped };
  }

  /** What the email service sent, tidied. Only a sender is required: a strange email must still arrive. */
  private normalize(fields: Record<string, unknown>) {
    const from = clip(fields.from_email, 500) || clip(fields.from, 500);
    const fromEmail = from.match(EMAIL_ADDRESS)?.[0].toLowerCase();
    if (!fromEmail) {
      throw new BadRequestException("from_email is required");
    }
    const displayName =
      clip(fields.from_name, 200) ||
      from
        .replace(EMAIL_ADDRESS, "")
        .replace(/[<>"']/g, "")
        .trim();
    const fromName = displayName.slice(0, 200) || null;
    const subject = clip(fields.subject, 500);
    const html = clip(fields.html, MAX_BODY_CHARS * 2);
    const bodyText = (clip(fields.text, MAX_BODY_CHARS) || htmlToText(html))
      .slice(0, MAX_BODY_CHARS)
      .trim();
    const receivedAt = Date.parse(clip(fields.received_at, 100));
    const received = new Date(
      Number.isNaN(receivedAt) ? Date.now() : receivedAt,
    ).toISOString();
    const messageId =
      clip(fields.message_id, 500) ||
      `generated:${createHash("sha256")
        .update([fromEmail, subject, bodyText, received].join("\n"))
        .digest("hex")}`;
    const text = bodyText || subject || "(The email had no text)";
    return {
      messageId,
      fromEmail,
      fromName,
      toAddress: clip(fields.to, 500) || null,
      subject,
      bodyText,
      receivedAt: received,
      message:
        text.length > MAX_MESSAGE_CHARS
          ? `${text.slice(0, MAX_MESSAGE_CHARS)}…\n\n(Shortened here; the full email is kept.)`
          : text,
    };
  }
}
