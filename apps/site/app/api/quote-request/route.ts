import { randomUUID } from "node:crypto";
import { contact } from "../../content.ts";
import {
  quoteSubject,
  quoteText,
  type QuoteDetails,
} from "../../request-a-quote/quoteEmail.ts";

const required: (keyof QuoteDetails)[] = [
  "name",
  "email",
  "service",
  "origin",
  "destination",
  "cargo",
];
const keys: (keyof QuoteDetails)[] = [
  "name",
  "company",
  "email",
  "phone",
  "service",
  "origin",
  "destination",
  "cargo",
  "weight",
  "readyDate",
  "notes",
];

export async function POST(request: Request) {
  const apiBase = process.env.SITE_API_BASE_URL?.trim();
  const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
  if (!apiBase || !secret) {
    return Response.json(
      { error: "Quote requests are unavailable right now." },
      { status: 503 },
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      { error: "Check the request details and try again." },
      { status: 400 },
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Response.json(
      { error: "Check the request details and try again." },
      { status: 400 },
    );
  }
  const values = input as Record<string, unknown>;
  const details = {} as QuoteDetails;
  for (const key of keys) {
    const value = values[key];
    if (typeof value !== "string" || value.length > 2000) {
      return Response.json(
        { error: "Check the request details and try again." },
        { status: 400 },
      );
    }
    details[key] = value.trim();
  }
  if (
    required.some((key) => !details[key]) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)
  ) {
    return Response.json(
      { error: "Complete the required fields and use a valid email." },
      { status: 400 },
    );
  }

  const fields = new FormData();
  fields.set("from_email", details.email);
  fields.set("from_name", details.name);
  fields.set("to", contact.quotesEmail);
  fields.set("subject", quoteSubject(details));
  fields.set("text", `Website quote request\n\n${quoteText(details)}`);
  fields.set("message_id", `website:${randomUUID()}`);
  // Tells the API this came from the quote form, not an email. Only this
  // server route can say so: the webhook needs the intake secret.
  fields.set("source", "website");

  try {
    const response = await fetch(
      `${apiBase.replace(/\/$/, "")}/v1/inbound-email`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: fields,
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error(`Intake returned ${response.status}`);
    return Response.json({ received: true });
  } catch {
    return Response.json(
      {
        error:
          "We couldn't send your request. Please try again or email us directly.",
      },
      { status: 502 },
    );
  }
}
