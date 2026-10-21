export interface Message {
  subject: string;
  /** The email text. The link is added after it. */
  body: string;
  /** The SMS text, short. The link is added after it. */
  smsText: string;
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(minor / 100)
    .replace(/\p{Zs}/gu, " ");

/** Ghana is on GMT all year, so the time shown is unambiguous. */
export function formatGhanaTime(iso: string): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  }).format(new Date(iso))} (Ghana time)`;
}

const sign = (sender: string) => `\n\n${sender}`;

export const milestoneMessage = (
  sender: string,
  fileNumber: string,
  /** The step's customer wording, e.g. "your cargo has arrived at the port". */
  update: string,
): Message => ({
  subject: `${fileNumber}: ${update.charAt(0).toUpperCase()}${update.slice(1)}`,
  body: `Update on your shipment ${fileNumber}: ${update}.${sign(sender)}`,
  smsText: `${sender}: ${fileNumber} - ${update}.`,
});

export const etaMessage = (
  sender: string,
  fileNumber: string,
  etaAt: string,
): Message => ({
  subject: `${fileNumber}: expected arrival updated`,
  body: `The expected arrival for your shipment ${fileNumber} is now ${formatGhanaTime(etaAt)}.${sign(sender)}`,
  smsText: `${sender}: ${fileNumber} is now expected ${formatGhanaTime(etaAt)}.`,
});

export const etaReminderMessage = (
  sender: string,
  fileNumber: string,
  etaAt: string,
): Message => ({
  subject: `${fileNumber}: arriving soon`,
  body: `Reminder: your shipment ${fileNumber} is expected ${formatGhanaTime(etaAt)}.${sign(sender)}`,
  smsText: `${sender}: reminder, ${fileNumber} is expected ${formatGhanaTime(etaAt)}.`,
});

export const quoteIssuedMessage = (
  sender: string,
  quoteNumber: string,
): Message => ({
  subject: `Your quotation ${quoteNumber} is ready`,
  body: `Your quotation ${quoteNumber} is ready. You can open and download it below.${sign(sender)}`,
  smsText: `${sender}: your quotation ${quoteNumber} is ready.`,
});

export const invoiceIssuedMessage = (
  sender: string,
  invoiceNumber: string,
  totalMinor: number,
  currency: string,
  dueDate: string | null,
): Message => ({
  subject: `Invoice ${invoiceNumber}`,
  body: `Invoice ${invoiceNumber} for ${money(totalMinor, currency)} has been issued${dueDate ? `, due ${dueDate}` : ""}. You can open and download it below.${sign(sender)}`,
  smsText: `${sender}: invoice ${invoiceNumber}, ${money(totalMinor, currency)}${dueDate ? `, due ${dueDate}` : ""}.`,
});

export const paymentReceivedMessage = (
  sender: string,
  receiptNumber: string | null,
  invoiceNumber: string,
  amountMinor: number,
  balanceMinor: number,
  currency: string,
): Message => ({
  subject: `Payment received for invoice ${invoiceNumber}`,
  body: `We have recorded your payment of ${money(amountMinor, currency)} for invoice ${invoiceNumber}${receiptNumber ? ` (receipt ${receiptNumber})` : ""}. Balance remaining: ${money(balanceMinor, currency)}.${sign(sender)}`,
  smsText: `${sender}: payment of ${money(amountMinor, currency)} received for ${invoiceNumber}. Balance ${money(balanceMinor, currency)}.`,
});

/** One payment that settled several invoices: a single message, not one per invoice. */
export const paymentsReceivedMessage = (
  sender: string,
  currency: string,
  lines: Array<{
    invoiceNumber: string;
    receiptNumber: string | null;
    amountMinor: number;
    balanceMinor: number;
  }>,
): Message => {
  const total = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const balance = lines.reduce((sum, line) => sum + line.balanceMinor, 0);
  return {
    subject: `Payment received for ${lines.length} invoices`,
    body: `We have recorded your payment of ${money(total, currency)}, applied to these invoices:\n${lines
      .map(
        (line) =>
          `- ${line.invoiceNumber}: ${money(line.amountMinor, currency)}${line.receiptNumber ? ` (receipt ${line.receiptNumber})` : ""}, balance ${money(line.balanceMinor, currency)}`,
      )
      .join(
        "\n",
      )}\nBalance remaining on these invoices: ${money(balance, currency)}.${sign(sender)}`,
    smsText: `${sender}: payment of ${money(total, currency)} received for ${lines.length} invoices. Balance on them ${money(balance, currency)}.`,
  };
};

export const deliveryDispatchedMessage = (
  sender: string,
  waybillNumber: string,
  driverName: string,
  driverPhone: string,
  vehicle: string,
  address: string,
): Message => ({
  subject: `Your goods are on the way (${waybillNumber})`,
  body: `Your goods are on the way to ${address}. Waybill ${waybillNumber}. Driver: ${driverName}, ${driverPhone}. Vehicle: ${vehicle}.${sign(sender)}`,
  smsText: `${sender}: goods on the way, waybill ${waybillNumber}. Driver ${driverName} ${driverPhone}, ${vehicle}.`,
});

export const deliveryDeliveredMessage = (
  sender: string,
  waybillNumber: string,
  receiver: string,
): Message => ({
  subject: `Delivered (${waybillNumber})`,
  body: `Waybill ${waybillNumber} was delivered and received by ${receiver}.${sign(sender)}`,
  smsText: `${sender}: waybill ${waybillNumber} delivered, received by ${receiver}.`,
});

export const staffMessage = (
  sender: string,
  subject: string | null,
  text: string,
): Message => ({
  subject: subject ?? `A message from ${sender}`,
  body: `${text}${sign(sender)}`,
  smsText: `${sender}: ${text}`.slice(0, 480),
});
