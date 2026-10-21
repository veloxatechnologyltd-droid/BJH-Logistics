import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic's model for high-volume extraction: $0.10 / $0.50 per million
 * input / output tokens for prompts up to 100K tokens (October 2026). Reads
 * PDFs and images directly.
 */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

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
}

/** Null when no Anthropic key is set up. */
export function claudeFromEnvironment(
  environment: NodeJS.ProcessEnv,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): ClaudeSetup | null {
  const apiKey = environment.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    client: new Anthropic({
      apiKey,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: 1,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    model: environment.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL,
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

/**
 * One request whose answer is forced into `schema` (structured outputs) and
 * returned parsed. Low effort: the work is reading, not reasoning.
 */
export async function readWithClaude(
  setup: ClaudeSetup,
  request: {
    system: string;
    content: Anthropic.ContentBlockParam[];
    schema: Record<string, unknown>;
    maxTokens: number;
  },
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
