import {
  allServices,
  clearance,
  contact,
  FOUNDED,
  quoteChecklist,
} from "../content.ts";
import { absoluteUrl, SITE_DESCRIPTION } from "../seo.ts";
import { serviceHref } from "../serviceDetails.ts";

// A plain-text summary for AI assistants (the llms.txt convention). Support
// among AI providers is not confirmed, so this is a low-cost extra: the same
// facts are in the page text and the structured data. Built from content.ts,
// so it cannot say anything the site does not.
export const dynamic = "force-static";

export function GET() {
  const text = [
    `# ${contact.company}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "## Services",
    ...allServices.map(
      (service) =>
        `- [${service.title}](${absoluteUrl(serviceHref(service.slug))}): ${service.summary}`,
    ),
    "",
    "## Key facts",
    `- Operating since: ${FOUNDED}`,
    `- Location: ${contact.address.join(", ")}`,
    `- Customs clearance at Tema Port: ${clearance.scope} Clearance and delivery takes ${clearance.days} business days after the cargo arrives, provided the documents are ready and normal port and customs processes apply.`,
    `- Documents usually needed for clearance: ${clearance.documents.map((document) => document.name).join(", ")}.`,
    "- Charges: customs duty, shipping line and port terminal charges are charged at cost in the quotation.",
    `- To get a quote, send: ${quoteChecklist.join("; ")}.`,
    "",
    "## Contact",
    `- Request a quote: ${absoluteUrl("/request-a-quote")}`,
    `- Quote requests by email: ${contact.quoteEmails.join(", ")}`,
    `- General enquiries by email: ${contact.generalEmails.join(", ")}`,
    `- Telephone and WhatsApp: ${contact.phoneNumbers.join(", ")}`,
    "",
    "## Company",
    `- [About us](${absoluteUrl("/about")})`,
    `- [Projects and specialist cargo](${absoluteUrl("/projects")})`,
    `- [Contact](${absoluteUrl("/contact")})`,
    "",
  ].join("\n");

  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
