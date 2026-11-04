import type { PushMessage } from "./push-provider";
import type { PushRecipients } from "./push.service";

/**
 * A new quote request or inquiry has come in, by email or from the customer
 * portal (Evans, 2026-11-04). The client desk is told: customer service and
 * the super admin, and sales for quote requests. Only the sender's name goes
 * in the notification, not what they wrote. One notification per inbox:
 * further ones replace it and are counted.
 */
export function newRequestPush(
  mailbox: "quotes" | "inquiries",
  from: string,
): { recipients: PushRecipients; message: PushMessage } {
  const inquiry = mailbox === "inquiries";
  return {
    recipients: {
      roles: inquiry
        ? ["super_admin", "customer_service_rep"]
        : ["super_admin", "customer_service_rep", "sales_rep"],
    },
    message: {
      title: inquiry ? "New inquiry" : "New quote request",
      body: `From ${from.slice(0, 120)}`,
      url: inquiry ? "/inquiries" : "/quotations",
      tag: inquiry ? "requests:inquiries" : "requests:quotes",
    },
  };
}
