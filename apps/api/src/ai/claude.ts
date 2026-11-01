import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";
import { OpenAiError, openAiFromEnvironment, readWithOpenAi } from "./openai";
import type { OpenAiSetup } from "./openai";

/** File types Claude reads directly: PDFs (text or scanned) and photos or scans as images. */
export const CLAUDE_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"];

/** A PDF as a document block, a PNG or JPEG as an image block. */
export function fileBlock(
  contentType: string,
  bytes: Buffer,
): Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam {
  const data = bytes.toString("base64");
  return contentType === "application/pdf"
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: contentType as "image/png" | "image/jpeg",
          data,
        },
      };
}

/** The reading failed; the message is safe to keep and to show staff (no content, no secrets). */
export class ClaudeReadingError extends Error {}

export interface ClaudeSetup {
  client: Anthropic;
  model: string;
  /** OpenAI, tried when a Claude call fails; null when not set up. */
  fallback?: OpenAiSetup | null;
}

/**
 * Null unless both `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` are set: no model is
 * built in. OpenAI is attached as the fallback when it is set up too.
 */
export function claudeFromEnvironment(
  environment: NodeJS.ProcessEnv,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): ClaudeSetup | null {
  const apiKey = environment.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model = environment.CLAUDE_MODEL?.trim();
  if (!model) {
    new Logger("AI").warn(
      "ANTHROPIC_API_KEY is set but CLAUDE_MODEL is not; Claude stays off",
    );
    return null;
  }
  return {
    client: new Anthropic({
      apiKey,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: 1,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    model,
    fallback: openAiFromEnvironment(environment, options),
  };
}

function problem(error: unknown): string {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return "The AI service did not accept the key that was set up";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "The AI service is busy or over its limit";
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "The AI service took too long to answer";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "The AI service could not be reached";
  }
  if (error instanceof Anthropic.APIError) {
    return error.status !== undefined && error.status >= 500
      ? "The AI service had a problem"
      : `The AI service refused the request (HTTP ${error.status ?? "?"})`;
  }
  return "The AI service could not be reached";
}

type ReadRequest = {
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  maxTokens: number;
};

/**
 * One request whose answer is forced into `schema` (structured outputs) and
 * returned parsed. When Claude fails and OpenAI is set up, OpenAI answers the
 * same request instead.
 */
export async function readWithClaude(
  setup: ClaudeSetup,
  request: ReadRequest,
): Promise<unknown> {
  try {
    return await readWithClaudeOnly(setup, request);
  } catch (error) {
    if (!(error instanceof ClaudeReadingError) || !setup.fallback) throw error;
    new Logger("AI").warn(`Claude failed (${error.message}); trying OpenAI`);
    try {
      return await readWithOpenAi(setup.fallback, request);
    } catch (fallbackError) {
      if (!(fallbackError instanceof OpenAiError)) throw fallbackError;
      throw new ClaudeReadingError(
        `${error.message}; the OpenAI fallback also failed: ${fallbackError.message}`,
      );
    }
  }
}

/** Low effort: the work is reading, not reasoning. */
async function readWithClaudeOnly(
  setup: ClaudeSetup,
  request: ReadRequest,
): Promise<unknown> {
  let response: Anthropic.Message;
  try {
    response = await setup.client.messages.create({
      model: setup.model,
      max_tokens: request.maxTokens,
      system: request.system,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: request.schema },
      },
      messages: [{ role: "user", content: request.content }],
    });
  } catch (error) {
    throw new ClaudeReadingError(problem(error));
  }
  if (response.stop_reason === "refusal") {
    throw new ClaudeReadingError("The AI declined to read this");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ClaudeReadingError("The AI stopped before it finished reading");
  }
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text" || !text.text.trim()) {
    throw new ClaudeReadingError("The AI returned no answer");
  }
  try {
    return JSON.parse(text.text);
  } catch {
    throw new ClaudeReadingError(
      "The AI's answer was not in the expected form",
    );
  }
}
