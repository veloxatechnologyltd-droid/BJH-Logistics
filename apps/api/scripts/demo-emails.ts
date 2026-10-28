/**
 * Posts the walkthrough's synthetic customer emails to the email intake
 * webhook, the same way the email service will (docs/demo-walkthrough.md).
 * Every sender, company and number is invented; the domains are reserved
 * `.example` ones. Run make-demo-documents.ts first (it writes the attachment).
 *
 *   INBOUND_EMAIL_SECRET=... corepack pnpm --filter @bjh/api exec tsx scripts/demo-emails.ts
 *   ... scripts/demo-emails.ts --api https://<api-host>/api --yes   # a hosted API
 *   ... --fresh   # new message IDs, so the emails arrive again as new requests
 *   ... --only tiles-ningbo   # one email by its key; the "later" ones are sent only this way
 *
 * Without --fresh a second run is recognised as the same emails and changes nothing.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DOCUMENTS = resolve(process.cwd(), "../../.local/demo-documents");

interface DemoEmail {
  key: string;
  to: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  text: string;
  attachment?: string;
  /** Sent only with --only <key>, at its point in the walkthrough. */
  later?: boolean;
}

const emails: DemoEmail[] = [
  {
    key: "fabric-ningbo",
    to: "quote@bjhlogistics.com",
    fromName: "Efua Owusu",
    fromEmail: "efua.owusu@akwaaba-garments.example",
    subject: "Rate request - Ningbo to Tema",
    text: [
      "Good morning,",
      "",
      "Please send us your rate for sea freight clearance from Ningbo to Tema for the goods on the attached packing list. We need the containers delivered to our warehouse in Kaneshie.",
      "",
      "Kind regards,",
      "Efua Owusu",
      "Procurement, Akwaaba Synthetic Garments Ltd",
      "+233 20 555 0142",
    ].join("\n"),
    attachment: "packing-list.pdf",
  },
  {
    key: "tiles-ningbo",
    to: "quote@bjhlogistics.com",
    fromName: "Yaw Darko",
    fromEmail: "yaw@kpone-hardware.example",
    subject: "Quotation needed: 1 x 40ft Ningbo to Tema",
    text: [
      "Hello BJH,",
      "",
      "We have 1 x 40ft HC of ceramic floor tiles, about 26 tonnes, coming from Ningbo to Tema on FOB terms. Cargo is ready early December. Kindly quote clearing and delivery.",
      "",
      "Yaw Darko",
      "Kpone Synthetic Hardware",
      "024 555 0187",
    ].join("\n"),
    later: true,
  },
  {
    key: "cocoa-air",
    to: "inquiries@bjhlogistics.com",
    fromName: "Abena Sarpong",
    fromEmail: "abena@golden-cocoa.example",
    subject: "Air freight to Amsterdam",
    text: [
      "Dear Sir/Madam,",
      "",
      "Do you handle air export to Europe? We want to send 24 pieces of dried cocoa products, 480 kg, from Kumasi via Accra to Amsterdam by mid-November.",
      "",
      "Thank you,",
      "Abena Sarpong",
      "Golden Synthetic Cocoa Exports",
    ].join("\n"),
  },
  {
    key: "rice-truck",
    to: "inquiries@bjhlogistics.com",
    fromName: "Kwesi Mensah",
    fromEmail: "kwesi@northern-grains.example",
    subject: "Truck Tema to Tamale",
    text: [
      "Hi,",
      "",
      "Can you give us a price to move 1 x 40ft container of bagged rice from Tema port to our depot in Tamale next week?",
      "",
      "Kwesi",
      "Northern Synthetic Grains",
    ].join("\n"),
  },
  {
    key: "documents-question",
    to: "inquiries@bjhlogistics.com",
    fromName: "Kojo Asante",
    fromEmail: "kojo@asante-motors.example",
    subject: "Documents for clearing",
    text: [
      "Hello,",
      "",
      "We are importing for the first time. Which documents do you need from us to clear a sea shipment at Tema, and what are your office hours?",
      "",
      "Regards,",
      "Kojo Asante",
      "Asante Synthetic Motors",
    ].join("\n"),
  },
  {
    key: "where-is-container",
    to: "inquiries@bjhlogistics.com",
    fromName: "Efua Owusu",
    fromEmail: "efua.owusu@akwaaba-garments.example",
    subject: "Arrival of our container",
    text: [
      "Hi,",
      "",
      "Could you let us know when our shipment is expected to arrive at Tema? We need to plan the delivery to Kaneshie.",
      "",
      "Thanks,",
      "Efua",
    ].join("\n"),
    later: true,
  },
];

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const api = (option("--api") ?? "http://127.0.0.1:3001/api").replace(
    /\/$/,
    "",
  );
  const host = new URL(api).hostname;
  const local = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!local && !process.argv.includes("--yes")) {
    throw new Error(
      `${host} is not local: add --yes to post the demo emails there`,
    );
  }
  const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
  if (!secret) throw new Error("Set INBOUND_EMAIL_SECRET to the API's value");
  const run = process.argv.includes("--fresh") ? `-${Date.now()}` : "";
  const only = option("--only");
  const chosen = only
    ? emails.filter((email) => email.key === only)
    : emails.filter((email) => !email.later);
  if (chosen.length === 0) {
    throw new Error(
      `No demo email is called ${only}; the keys are ${emails.map((email) => email.key).join(", ")}`,
    );
  }

  console.log(`Posting ${chosen.length} demo emails to ${api}`);
  for (const email of chosen) {
    const form = new FormData();
    form.append("from_email", email.fromEmail);
    form.append("from_name", email.fromName);
    form.append("to", email.to);
    form.append("subject", email.subject);
    form.append("text", email.text);
    form.append(
      "message_id",
      `<demo-walkthrough-${email.key}${run}@bjh-demo.example>`,
    );
    if (email.attachment) {
      const bytes = readFileSync(join(DOCUMENTS, email.attachment));
      form.append(
        "attachments",
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        email.attachment,
      );
    }
    const response = await fetch(`${api}/v1/inbound-email`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: form,
    });
    const body = await response.text();
    console.log(`  ${email.to.padEnd(28)} ${email.subject}`);
    console.log(`    HTTP ${response.status} ${body}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
