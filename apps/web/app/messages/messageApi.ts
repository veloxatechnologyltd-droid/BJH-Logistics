import { authenticatedFetch } from "../auth/authenticatedFetch";

export type ChannelMode = "email" | "sms" | "both";

export type MessageDelivery = {
  id: string;
  channel: "email" | "sms";
  contactName: string | null;
  recipient: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  lastError: string | null;
};

export type ClientMessage = {
  id: string;
  companyId: string;
  companyName: string;
  jobId: string | null;
  fileNumber: string | null;
  event: string;
  subject: string;
  body: string;
  linkUrl: string | null;
  /** Who sent it; null when the system or the email assistant did. */
  createdBy: string | null;
  createdAt: string;
  deliveries: MessageDelivery[];
};

export type Feed = { channels: ChannelMode; messages: ClientMessage[] };

export type SendResult = {
  event: "message" | "broadcast";
  sent: Array<{ companyId: string; companyName: string }>;
  skipped: Array<{ companyId: string; companyName: string; reason: string }>;
};

/** What each kind of message is called for staff. */
export const eventLabels: Record<string, string> = {
  message: "Message",
  broadcast: "Broadcast",
  quote_issued: "Quote issued",
  quote_sent: "Quote sent",
  milestone: "Shipment update",
  eta: "Arrival date",
  eta_reminder: "Arrival reminder",
  invoice_issued: "Invoice",
  payment_received: "Payment received",
  delivery_dispatched: "Out for delivery",
  delivery_delivered: "Delivered",
  email_reply: "Reply to email",
};

export const channelLabels: Record<ChannelMode, string> = {
  both: "email and SMS",
  email: "email only",
  sms: "SMS only",
};

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : body?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

export async function getFeed(filter: {
  companyId?: string;
  event?: string;
  limit?: number;
}): Promise<Feed> {
  const query = new URLSearchParams();
  if (filter.limit) query.set("limit", String(filter.limit));
  if (filter.companyId) query.set("companyId", filter.companyId);
  if (filter.event) query.set("event", filter.event);
  return read<Feed>(
    await authenticatedFetch(`${apiBaseUrl}/v1/messages?${query}`),
  );
}

export async function sendClientMessage(input: {
  audience: "all" | string[];
  subject?: string;
  body: string;
}): Promise<SendResult> {
  return read<SendResult>(
    await authenticatedFetch(`${apiBaseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function sendQuoteToClient(quoteId: string): Promise<unknown> {
  return read<unknown>(
    await authenticatedFetch(
      `${apiBaseUrl}/v1/quotes/${encodeURIComponent(quoteId)}/send`,
      { method: "POST" },
    ),
  );
}
