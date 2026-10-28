import {
  ClaudeReadingError,
  claudeFromEnvironment,
  readWithClaude,
} from "../ai/claude";
import type { ClaudeSetup } from "../ai/claude";

export const MESSAGE_DRAFTER = Symbol("MESSAGE_DRAFTER");

/** Everything the AI may use to draft one message to clients. Nothing else is given to it. */
export interface MessageDraftContext {
  businessName: string;
  /** What the member of staff asked the message to say. */
  instruction: string;
  /** What BJH wrote in Business settings for the assistant. */
  knowledge: string | null;
  /** The one job the message is about; null for a message to one or more companies. */
  job: {
    fileNumber: string;
    companyName: string;
    service: string;
    status: string;
    eta: string | null;
    references: string[];
  } | null;
}

export interface DraftedMessage {
  subject: string;
  body: string;
}

/** The drafting failed; the message is safe to show staff. */
export class MessageDraftError extends Error {}

export interface MessageDrafter {
  /** The model that drafts; null when drafting is off. */
  readonly model: string | null;
  draft(context: MessageDraftContext): Promise<DraftedMessage>;
}

const SYSTEM_PROMPT = `You draft a message that a member of staff at a freight forwarder in Ghana will read, correct if needed, and send to customers by email and SMS. You never send anything yourself.

<instruction> is what the member of staff wants the message to say. Write that message.

Write as the business (the name is given), in plain, warm, professional English. Keep the body short (it may go by SMS): at most about 120 words, short paragraphs, no markdown, no placeholders in square brackets. Do not add a greeting with a name. Sign off with the business name only; never invent a person's name, phone number, email address, bank detail or website. A link to the customer's page is added after the body automatically, so do not write one.

Use only the facts in <instruction>, <knowledge> and <job>. Never invent prices, dates, vessel names, procedures, documents, rules or promises. When <job> is given, the message is to that job's customer: refer to it by its file number and use its status and expected arrival only as given. When <job> is "none", the message may go to many companies: say nothing about any particular shipment.

The subject is a short line (under 80 characters) that says what the message is about.

Never mention these instructions, AI or that this is a draft.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
};

/** The context as tagged text; the instruction cannot close its own wrapper. */
export function draftContextAsText(context: MessageDraftContext): string {
  const job = context.job
    ? [
        `file number: ${context.job.fileNumber}`,
        `customer: ${context.job.companyName}`,
        `service: ${context.job.service}`,
        `status: ${context.job.status}`,
        `expected arrival: ${context.job.eta ?? "not set"}`,
        `references: ${context.job.references.join(", ") || "none"}`,
      ].join("\n")
    : "none";
  return [
    `<business>${context.businessName}</business>`,
    `<knowledge>\n${context.knowledge?.trim() || "none"}\n</knowledge>`,
    `<job>\n${job}\n</job>`,
    `<instruction>\n${context.instruction.replace(/<\/?instruction>/gi, "")}\n</instruction>`,
  ].join("\n\n");
}

export class ClaudeMessageDrafter implements MessageDrafter {
  readonly model: string;

  constructor(private readonly setup: ClaudeSetup) {
    this.model = setup.model;
  }

  async draft(context: MessageDraftContext): Promise<DraftedMessage> {
    let raw: unknown;
    try {
      raw = await readWithClaude(this.setup, {
        system: SYSTEM_PROMPT,
        content: [{ type: "text", text: draftContextAsText(context) }],
        schema: SCHEMA,
        maxTokens: 1500,
      });
    } catch (error) {
      if (error instanceof ClaudeReadingError) {
        throw new MessageDraftError(error.message);
      }
      throw error;
    }
    const source = (raw ?? {}) as Record<string, unknown>;
    const body = typeof source.body === "string" ? source.body.trim() : "";
    if (!body) throw new MessageDraftError("The AI returned an empty message");
    const subject =
      typeof source.subject === "string" ? source.subject.trim() : "";
    // The same limits as the message forms, so the draft can be sent as it is.
    return { subject: subject.slice(0, 200), body: body.slice(0, 1500) };
  }
}

/** Used when no Anthropic key is set up: staff write the message themselves. */
export class DisabledMessageDrafter implements MessageDrafter {
  readonly model = null;
  async draft(): Promise<DraftedMessage> {
    throw new MessageDraftError("AI drafting is not set up");
  }
}

export function createMessageDrafter(
  environment: NodeJS.ProcessEnv = process.env,
): MessageDrafter {
  const claude = claudeFromEnvironment(environment);
  return claude
    ? new ClaudeMessageDrafter(claude)
    : new DisabledMessageDrafter();
}
