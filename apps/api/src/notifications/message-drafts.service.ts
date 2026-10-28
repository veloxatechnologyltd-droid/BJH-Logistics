import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  messageDraftInputSchema,
  parseContract,
  type ServiceLine,
} from "@bjh/contracts";
import { DatabasePort, JobRecord } from "../database/database.port";
import { MESSAGE_DRAFTER, MessageDraftError } from "./message-drafter";
import type {
  DraftedMessage,
  MessageDraftContext,
  MessageDrafter,
} from "./message-drafter";

const serviceLineLabels: Record<ServiceLine, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};

/**
 * The AI drafts a message from what staff ask it to say. Nothing is saved or
 * sent: the draft goes back into the form, and staff edit it and send it the
 * usual way, so a person approves every message.
 */
@Injectable()
export class MessageDraftsService {
  private readonly logger = new Logger(MessageDraftsService.name);

  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(MESSAGE_DRAFTER) private readonly drafter: MessageDrafter,
  ) {}

  /** Whether the AI can draft at all (an Anthropic key is set up). */
  get available(): boolean {
    return this.drafter.model !== null;
  }

  /** A message to one or more companies: the AI is given no customer's data. */
  draftClientMessage(input: unknown): Promise<DraftedMessage> {
    return this.draft(input, null);
  }

  /** A message on one job: the AI is given that job only. The caller has checked access to it. */
  async draftJobMessage(
    job: JobRecord,
    input: unknown,
  ): Promise<DraftedMessage> {
    const [etas, references] = await Promise.all([
      this.database.listEtaEvents(job.id),
      this.database.listShipmentReferences(job.id),
    ]);
    const corrected = new Set(
      etas.map((eta) => eta.correctionOf).filter(Boolean),
    );
    const current = etas
      .filter((eta) => !corrected.has(eta.id))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    return this.draft(input, {
      fileNumber: job.fileNumber,
      companyName: job.customerCompanyName,
      service: serviceLineLabels[job.serviceLine],
      status: job.status.replace(/_/g, " "),
      eta: current
        ? `${new Intl.DateTimeFormat("en-GH", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Africa/Accra",
          }).format(new Date(current.etaAt))} Ghana time`
        : null,
      references: references.map((reference) => reference.value),
    });
  }

  private async draft(
    input: unknown,
    job: MessageDraftContext["job"],
  ): Promise<DraftedMessage> {
    const parsed = parseContract(messageDraftInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    if (!this.available) {
      throw new ServiceUnavailableException("AI drafting is not set up");
    }
    const settings = await this.database.getBusinessSettings();
    try {
      return await this.drafter.draft({
        businessName: settings?.settings.issuer.name ?? "BJH Logistics",
        instruction: parsed.data.instruction,
        knowledge: settings?.settings.assistant?.knowledge ?? null,
        job,
      });
    } catch (error) {
      if (error instanceof MessageDraftError) {
        throw new BadGatewayException(error.message);
      }
      this.logger.error(
        `Drafting a message failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException("The AI service could not be reached");
    }
  }
}
