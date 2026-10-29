export type QuoteDetails = {
  name: string;
  company: string;
  email: string;
  phone: string;
  service: string;
  origin: string;
  destination: string;
  cargo: string;
  weight: string;
  readyDate: string;
  notes: string;
};

const labels: [keyof QuoteDetails, string][] = [
  ["name", "Name"],
  ["company", "Company"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["service", "Service"],
  ["origin", "Origin"],
  ["destination", "Destination"],
  ["cargo", "Cargo"],
  ["weight", "Dimensions / weight / container"],
  ["readyDate", "Preferred timing"],
  ["notes", "Notes"],
];

/** The quote request as plain text, one "Label: value" line per filled field. */
export function quoteText(details: QuoteDetails): string {
  return labels
    .map(([key, label]) => [label, details[key].trim()] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function quoteSubject(details: QuoteDetails): string {
  const route = [details.origin, details.destination]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" to ");
  return ["Quote request", details.service.trim(), route]
    .filter(Boolean)
    .join(" - ");
}

/** A mailto: link that opens the visitor's email app with the request filled in. */
export function quoteMailto(recipient: string, details: QuoteDetails): string {
  const subject = encodeURIComponent(quoteSubject(details));
  const body = encodeURIComponent(
    `Hello BJH Logistics,\n\nPlease quote for:\n\n${quoteText(details)}\n`,
  );
  return `mailto:${recipient}?subject=${subject}&body=${body}`;
}
