import type { BusinessSettings } from "@bjh/contracts";
import { authenticatedFetch } from "../../auth/authenticatedFetch";

export type SettingsRevision = {
  revisionNumber: number;
  settings: BusinessSettings;
  changedBy: string;
  changedAt: string;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const settingsUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/settings`;

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await authenticatedFetch(`${settingsUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(failure?.message)
      ? failure.message.join(", ")
      : failure?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

export const getSettings = () =>
  send<{ current: SettingsRevision | null }>("", "GET");
export const saveSettings = (settings: unknown) =>
  send<SettingsRevision>("", "PUT", settings);
