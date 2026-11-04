/**
 * The email template for replies to customers (the assistant's and staff's):
 * the reply as written, then Henry's signature block, as he supplied it.
 * Sent as plain text with a matching HTML version; mail apps that block
 * styling or images still show the text one in full.
 */
export const replySignature = {
  name: "Henry Yaw Somuah",
  company: "BJH Logistics Services Ltd",
  address: [
    "Height of Greener Pastures Building",
    "Third Floor, Suite 6",
    "Meridian Street",
    "Tema Community 1",
    "Ghana, West Africa",
  ],
  vat: "VAT No. C0000064351",
  cell: "+233 24 405 8592",
  email: "henry@bjhlogistics.com",
  website: "www.bjhlogistics.com",
} as const;

/** Customer-reply events: the AI's or a person's reply to an emailed request. */
export const replyEvents: readonly string[] = ["email_reply", "inquiry_reply"];

export function replyText(body: string): string {
  const s = replySignature;
  return [
    body.trimEnd(),
    "",
    "--",
    s.name,
    s.company,
    ...s.address,
    s.vat,
    "",
    `Cell: ${s.cell}`,
    `Email: ${s.email}`,
    `Website: ${s.website}`,
  ].join("\n");
}

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function replyHtml(body: string): string {
  const s = replySignature;
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px">${escape(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const muted = "color:#5b6575";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:640px;padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1d2433">
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:2px solid #0b3fae;padding-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#1d2433">
<tr><td style="padding-top:12px">
<div style="font-size:15px;font-weight:bold;color:#0b3fae">${escape(s.name)}</div>
<div style="font-weight:bold">${escape(s.company)}</div>
<div style="${muted};margin-top:6px">${s.address.map(escape).join("<br>")}</div>
<div style="${muted}">${escape(s.vat)}</div>
<div style="margin-top:8px">
<span style="${muted}">Cell</span> <a href="tel:${s.cell.replace(/\s/g, "")}" style="color:#1d2433;text-decoration:none">${escape(s.cell)}</a><br>
<span style="${muted}">Email</span> <a href="mailto:${s.email}" style="color:#0b3fae">${escape(s.email)}</a><br>
<span style="${muted}">Web</span> <a href="https://${s.website}" style="color:#0b3fae">${escape(s.website)}</a>
</div>
</td></tr>
</table>
</div>
</body></html>`;
}
