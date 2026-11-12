import { Logger } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";

const DEFAULT_WEB_ORIGIN = "http://127.0.0.1:3002";

export function resolveListenHost(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return environment.API_HOST?.trim() || "127.0.0.1";
}

export function resolveCorsOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = (environment.CORS_ORIGINS ?? environment.WEB_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [DEFAULT_WEB_ORIGIN];
}

/** Logs method, path (no query string), status and duration only. */
interface LoggedRequest {
  method: string;
  path: string;
}
interface LoggedResponse {
  statusCode: number;
  on(event: "finish", listener: () => void): unknown;
}

export function safeLoggedPath(path: string): string {
  return path.replace(
    /^(\/api\/v1\/sales\/unsubscribe\/)[^/]+$/,
    "$1[redacted]",
  );
}

function requestLogger(): (
  request: LoggedRequest,
  response: LoggedResponse,
  next: () => void,
) => void {
  const logger = new Logger("HTTP");
  return (request, response, next) => {
    const startedAt = Date.now();
    response.on("finish", () => {
      logger.log(
        JSON.stringify({
          method: request.method,
          path: safeLoggedPath(request.path),
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      );
    });
    next();
  };
}

export function configureApp(
  app: INestApplication,
  options: { requestLogging?: boolean } = {},
): void {
  app.use(helmet());
  if (options.requestLogging) app.use(requestLogger());
  app.enableCors({ origin: resolveCorsOrigins() });
}
