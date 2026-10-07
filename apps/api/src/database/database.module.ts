import { Logger, Module } from "@nestjs/common";
import type { Provider } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Pool } from "pg";
import { DatabasePort } from "./database.port";
import {
  POSTGRES_POOL,
  PostgresDatabaseService,
} from "./postgres-database.service";

/**
 * The Supabase root CA, from DATABASE_SSL_CA (the PEM text) or the file at
 * DATABASE_SSL_CA_PATH. Without it, pg falls back to the system CAs, which
 * do not include Supabase's root.
 */
export function resolveDatabaseCa(
  logger: Pick<Logger, "log" | "error">,
  environment: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const inline = environment.DATABASE_SSL_CA?.trim().replace(/\\n/g, "\n");
  if (inline) {
    logger.log("Supabase root certificate loaded from DATABASE_SSL_CA");
    return inline;
  }
  const configuredCaPath =
    environment.DATABASE_SSL_CA_PATH ?? "../../.local/supabase-root.crt";
  const caPath = isAbsolute(configuredCaPath)
    ? configuredCaPath
    : resolve(process.cwd(), configuredCaPath);
  try {
    const ca = readFile(caPath);
    logger.log(`Supabase root certificate loaded from ${caPath}`);
    return ca;
  } catch {
    logger.error(
      `Supabase root certificate unavailable at ${caPath}; PostgreSQL connections will rely on system CAs`,
    );
    return undefined;
  }
}

function createPostgresPool(connectionString: string): Pool {
  const logger = new Logger("PostgresPool");
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme");
  }

  const localConnection =
    url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const ca = localConnection ? undefined : resolveDatabaseCa(logger);

  // TLS settings are provided explicitly so pg verifies the server certificate.
  for (const sslParameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    url.searchParams.delete(sslParameter);
  }
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: localConnection
      ? false
      : ca
        ? { ca, rejectUnauthorized: true }
        : { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "bjh-logistics-api",
  });

  pool.on("error", (error) => {
    const errorCode =
      "code" in error && typeof error.code === "string"
        ? ` (${error.code})`
        : "";
    logger.error(`Idle PostgreSQL connection failed${errorCode}`);
  });

  return pool;
}

function requireDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required (PostgreSQL connection URL)");
  }
  return connectionString;
}

const providers: Provider[] = [
  {
    provide: POSTGRES_POOL,
    useFactory: () => createPostgresPool(requireDatabaseUrl()),
  },
  PostgresDatabaseService,
];

@Module({
  providers: [
    ...providers,
    {
      provide: DatabasePort,
      useExisting: PostgresDatabaseService,
    },
  ],
  exports: [DatabasePort],
})
export class DatabaseModule {}
