import { Logger } from "@nestjs/common";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * OpenAI as the fallback when a Claude call fails (outage, limit, refusal,
 * unreadable answer). Calls the Responses API with `store: false`, so nothing
 * is kept on OpenAI's side. The model comes only from `OPENAI_MODEL`.
 */
export interface OpenAiSetup {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  fetch: typeof fetch;
}

/** The OpenAI call failed; the message is safe to show staff (no content, no secrets). */
export class OpenAiError extends Error {}

/** Null unless both `OPENAI_API_KEY` and `OPENAI_MODEL` are set. */
export function openAiFromEnvironment(
  environment: NodeJS.ProcessEnv,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): OpenAiSetup | null {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = environment.OPENAI_MODEL?.trim();
  if (!model) {
    new Logger("AI").warn(
      "OPENAI_API_KEY is set but OPENAI_MODEL is not; OpenAI stays off",
    );
    return null;
  }
  return {
    apiKey,
    model,
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: options.timeoutMs ?? 60_000,
    fetch: options.fetch ?? fetch,
  };
}

/** The newer OpenAI models reason before answering; the older ones reject the setting. */
export const openAiReasons = (model: string) =>
  /^(gpt-5|gpt-6|o\d)/.test(model);

/** One item of a Responses API answer. */
export interface OpenAiOutputItem {
  type?: string;
  content?: Array<{ type?: string; text?: string; refusal?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
}

function httpProblem(status: number): string {
  if (status === 401 || status === 403) {
    return "The AI service did not accept the key that was set up";
  }
  if (status === 429) return "The AI service is busy or over its limit";
  if (status >= 500) return "The AI service had a problem";
  return `The AI service refused the request (HTTP ${status})`;
}

/** Sends one Responses API request and returns its output items. */
export async function callOpenAi(
  setup: OpenAiSetup,
  body: Record<string, unknown>,
): Promise<OpenAiOutputItem[]> {
  let response: Response;
  try {
    response = await setup.fetch(`${setup.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${setup.apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(setup.timeoutMs),
      body: JSON.stringify({
        model: setup.model,
        store: false,
        ...(openAiReasons(setup.model) ? { reasoning: { effort: "low" } } : {}),
        ...body,
      }),
    });
  } catch (error) {
    throw new OpenAiError(
      error instanceof Error && error.name === "TimeoutError"
        ? "The AI service took too long to answer"
        : "The AI service could not be reached",
    );
  }
  if (!response.ok) throw new OpenAiError(httpProblem(response.status));
  let answer: { status?: string; error?: unknown; output?: OpenAiOutputItem[] };
  try {
    answer = (await response.json()) as typeof answer;
  } catch {
    throw new OpenAiError(
      "The AI service sent an answer that was not readable",
    );
  }
  if (answer.error) throw new OpenAiError("The AI service reported an error");
  if (answer.status === "incomplete") {
    throw new OpenAiError("The AI stopped before it finished");
  }
  const output = answer.output ?? [];
  if (
    output.some((item) =>
      (item.content ?? []).some((part) => part.type === "refusal"),
    )
  ) {
    throw new OpenAiError("The AI declined this request");
  }
  return output;
}

/** The answer's text, joined. */
export const openAiText = (output: OpenAiOutputItem[]) =>
  output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();

/** Claude content blocks (text, base64 PDF, base64 image) as Responses API input parts. */
export function openAiContent(
  blocks: Anthropic.ContentBlockParam[],
): Array<Record<string, unknown>> {
  return blocks.map((block) => {
    if (block.type === "text") return { type: "input_text", text: block.text };
    if (block.type === "image" && block.source.type === "base64") {
      return {
        type: "input_image",
        image_url: `data:${block.source.media_type};base64,${block.source.data}`,
      };
    }
    if (block.type === "document" && block.source.type === "base64") {
      return {
        type: "input_file",
        filename: "document.pdf",
        file_data: `data:application/pdf;base64,${block.source.data}`,
      };
    }
    throw new OpenAiError("This content cannot be sent to the fallback AI");
  });
}

/**
 * The same reading request as `readWithClaude`, answered by OpenAI as JSON.
 * The schema is not strict: Claude's schemas allow optional fields, which
 * OpenAI's strict mode does not; each caller validates the answer anyway.
 */
export async function readWithOpenAi(
  setup: OpenAiSetup,
  request: {
    system: string;
    content: Anthropic.ContentBlockParam[];
    schema: Record<string, unknown>;
    maxTokens: number;
  },
): Promise<unknown> {
  const output = await callOpenAi(setup, {
    max_output_tokens: request.maxTokens,
    input: [
      { role: "system", content: request.system },
      { role: "user", content: openAiContent(request.content) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "answer",
        strict: false,
        schema: request.schema,
      },
    },
  });
  const text = openAiText(output);
  if (!text) throw new OpenAiError("The AI returned no answer");
  try {
    return JSON.parse(text);
  } catch {
    throw new OpenAiError("The AI's answer was not in the expected form");
  }
}
