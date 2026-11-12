/**
 * Plain-language wording for the Activity log. The API stores each request as
 * its method and route pattern (for example `POST /api/v1/jobs/:id/milestones`);
 * this turns that into a sentence a non-technical admin can read.
 */

const labels: Record<string, string> = {
  // Sign-in and account
  "GET /auth/session": "Opened the app (checked sign-in)",
  "GET /auth/bootstrap-status": "Checked first-time setup",
  "POST /auth/bootstrap-super-admin": "Created the first super admin",
  "POST /auth/password": "Changed their own password",
  "POST /auth/password-reset": "Asked for a password reset",

  // Admin: staff, customer accounts, notifications
  "GET /admin/activity": "Viewed the activity log",
  "GET /admin/staff": "Viewed the staff list",
  "POST /admin/staff": "Added a staff member",
  "POST /admin/staff/delete": "Deleted a staff member",
  "DELETE /admin/staff/:userId": "Deleted a staff member",
  "PATCH /admin/staff/:userId/name": "Changed a staff member's name",
  "PATCH /admin/staff/:userId/password": "Reset a staff member's password",
  "POST /admin/staff/:userId/activate": "Re-activated a staff member",
  "POST /admin/staff/:userId/suspend": "Suspended a staff member",
  "POST /admin/staff/:userId/roles": "Gave a staff member a role",
  "DELETE /admin/staff/:userId/roles/:roleKey":
    "Removed a role from a staff member",
  "GET /admin/customer-accounts": "Viewed customer logins",
  "GET /admin/customer-accounts/pending":
    "Viewed customer logins waiting for approval",
  "POST /admin/customer-accounts": "Created a customer login",
  "PATCH /admin/customer-accounts/:userId/password":
    "Reset a customer's password",
  "POST /admin/customer-accounts/:userId/activate": "Approved a customer login",
  "POST /admin/customer-accounts/:userId/suspend": "Suspended a customer login",
  "GET /admin/company-memberships":
    "Viewed which logins belong to which customer",
  "POST /admin/company-memberships": "Linked a login to a customer company",
  "DELETE /admin/company-memberships/:userId/:companyId":
    "Removed a login from a customer company",
  "GET /admin/notifications": "Viewed email notifications sent",
  "POST /admin/notifications/dispatch": "Sent pending email notifications",
  "POST /admin/notifications/deliveries/:id/retry":
    "Tried a failed email notification again",
  "GET /staff-notifications": "Viewed staff reminders",
  "POST /staff-notifications/:id/dismiss": "Dismissed a staff reminder",
  "POST /staff-notifications/:id/snooze": "Snoozed a staff reminder",

  // Customers
  "GET /customers": "Viewed the customer list",
  "GET /customers/:id": "Viewed a customer",
  "GET /customers/:id/insights": "Viewed a customer's activity summary",
  "GET /customers/insights": "Viewed customer activity summaries",
  "POST /customers": "Added a customer",
  "PATCH /customers/:id": "Edited a customer",
  "POST /customers/:id/contacts": "Added a contact to a customer",
  "PATCH /customers/:id/contacts/:contactId": "Edited a customer contact",

  // Jobs
  "GET /jobs": "Viewed the job list",
  "GET /jobs/:id": "Opened a job",
  "POST /jobs": "Created a job",
  "GET /jobs/:id/milestones": "Viewed a job's milestones",
  "POST /jobs/:id/milestones": "Recorded a milestone on a job",
  "GET /jobs/:id/status-history": "Viewed a job's status history",
  "POST /jobs/:id/status": "Changed a job's status",
  "GET /jobs/:id/eta": "Viewed a job's arrival estimate",
  "POST /jobs/:id/eta": "Updated a job's arrival estimate",
  "PUT /jobs/:id/etd": "Updated a job's departure date",
  "PUT /jobs/:id/voyage": "Updated a job's vessel and voyage",
  "PUT /jobs/:id/report-details": "Updated a job's report details",
  "GET /jobs/:id/notifications": "Viewed a job's notifications",
  "GET /jobs/:id/parties": "Viewed the companies on a job",
  "POST /jobs/:id/parties": "Added a company to a job",
  "DELETE /jobs/:id/parties/:partyId": "Removed a company from a job",
  "GET /jobs/:id/references": "Viewed a job's reference numbers",
  "POST /jobs/:id/references": "Added a reference number to a job",
  "DELETE /jobs/:id/references/:referenceId":
    "Removed a reference number from a job",
  "GET /jobs/:id/team": "Viewed the team on a job",
  "POST /jobs/:id/team": "Assigned someone to a job",
  "DELETE /jobs/:id/team/:assignmentId": "Removed someone from a job",
  "GET /jobs/:id/tasks": "Viewed a job's tasks",
  "POST /jobs/:id/tasks": "Added a task to a job",
  "POST /jobs/:id/tasks/:taskId/complete": "Completed a job task",
  "GET /tasks": "Viewed tasks",
  "GET /jobs/:id/correspondence": "Viewed a job's email history",
  "POST /jobs/:id/correspondence": "Logged an email on a job",
  "POST /jobs/:id/messages": "Sent a message about a job",
  "POST /jobs/:id/messages/draft": "Wrote a draft message about a job",
  "GET /jobs/:id/stock": "Viewed stock on a job",
  "POST /jobs/:id/stock": "Recorded stock on a job",
  "GET /jobs/:id/deliveries": "Viewed a job's deliveries",
  "POST /jobs/:id/deliveries": "Scheduled a delivery",
  "GET /jobs/:id/deliveries/:deliveryId/pdf": "Downloaded a delivery note",
  "POST /jobs/:id/deliveries/:deliveryId/proof": "Added proof of delivery",

  // Documents and extraction
  "GET /documents": "Viewed documents",
  "POST /documents": "Uploaded a document",
  "GET /documents/:documentId/download": "Downloaded a document",
  "GET /jobs/:id/documents": "Viewed a job's documents",
  "POST /jobs/:id/documents": "Uploaded a document to a job",
  "GET /jobs/:id/documents/:documentId/download": "Downloaded a job document",
  "POST /jobs/:id/documents/:documentId/extract":
    "Read details from a document",
  "GET /jobs/:id/extractions": "Viewed details read from documents",
  "POST /jobs/:id/extractions/:extractionId/approve":
    "Approved details read from a document",
  "POST /jobs/:id/extractions/:extractionId/reject":
    "Rejected details read from a document",
  "GET /shipping-documents": "Viewed shipping documents",
  "GET /jobs/:id/transport-documents": "Viewed a job's transport documents",
  "GET /jobs/:id/transport-documents/prefill":
    "Started a transport document from job details",
  "POST /jobs/:id/transport-documents": "Created a transport document",
  "PUT /jobs/:id/transport-documents/:documentId":
    "Edited a transport document",
  "GET /jobs/:id/transport-documents/:documentId/pdf":
    "Downloaded a transport document",
  "POST /jobs/:id/transport-documents/:documentId/issue":
    "Issued a transport document",
  "POST /jobs/:id/transport-documents/:documentId/void":
    "Cancelled a transport document",

  // Charges and money
  "GET /jobs/:id/charges": "Viewed a job's charges",
  "POST /jobs/:id/charges": "Added a charge to a job",
  "DELETE /jobs/:id/charges/:chargeId": "Removed a charge from a job",
  "POST /jobs/:id/charges/:chargeId/actuals":
    "Recorded the actual cost of a charge",
  "POST /jobs/:id/charges/import-from-quote":
    "Copied charges from a quote into a job",
  "GET /jobs/:id/invoices": "Viewed a job's invoices",
  "POST /jobs/:id/invoices": "Created an invoice",
  "POST /jobs/:id/invoices/from-charges":
    "Created an invoice from a job's charges",
  "PUT /jobs/:id/invoices/:invoiceId": "Edited an invoice",
  "GET /jobs/:id/invoices/:invoiceId/pdf": "Downloaded an invoice",
  "POST /jobs/:id/invoices/:invoiceId/accept": "Accepted an invoice",
  "POST /jobs/:id/invoices/:invoiceId/issue": "Issued an invoice",
  "POST /jobs/:id/invoices/:invoiceId/void": "Cancelled an invoice",
  "POST /jobs/:id/invoices/:invoiceId/payments": "Recorded a payment",
  "POST /jobs/:id/invoices/:invoiceId/payments/:paymentId/reverse":
    "Reversed a payment",
  "GET /jobs/:id/invoices/:invoiceId/payments/:paymentId/receipt":
    "Downloaded a receipt",
  "POST /jobs/:id/invoices/:invoiceId/payments/:paymentId/receipt/send":
    "Emailed a receipt",
  "GET /companies/:id/invoices": "Viewed a customer's invoices",
  "POST /companies/:id/invoices": "Created an invoice for a customer",
  "PUT /companies/:id/invoices/:invoiceId": "Edited a customer's invoice",
  "GET /companies/:id/invoices/:invoiceId/pdf":
    "Downloaded a customer's invoice",
  "POST /companies/:id/invoices/:invoiceId/issue":
    "Issued a customer's invoice",
  "POST /companies/:id/invoices/:invoiceId/void":
    "Cancelled a customer's invoice",
  "POST /companies/:id/invoices/:invoiceId/payments": "Recorded a payment",
  "POST /companies/:id/invoices/:invoiceId/payments/:paymentId/reverse":
    "Reversed a payment",
  "GET /companies/:id/invoices/:invoiceId/payments/:paymentId/receipt":
    "Downloaded a receipt",
  "POST /companies/:id/invoices/:invoiceId/payments/:paymentId/receipt/send":
    "Emailed a receipt",
  "GET /invoices": "Viewed invoices",
  "GET /invoices/outstanding": "Viewed unpaid invoices",
  "GET /invoices/summary": "Viewed the invoice summary",
  "POST /invoices/summary/send": "Emailed the invoice summary",
  "POST /invoices/issue": "Issued invoices",
  "POST /payments": "Recorded a payment",
  "GET /receipts": "Viewed receipts",
  "GET /receipts/summary": "Viewed the receipts summary",
  "POST /receipts/summary/send": "Emailed the receipts summary",
  "GET /credits": "Viewed customer credits",
  "GET /credits/:id/receipt": "Downloaded a credit receipt",
  "POST /credits/:id/apply": "Applied a customer credit",
  "POST /credits/:id/reverse": "Reversed a customer credit",
  "GET /finance/summary": "Viewed the finance summary",
  "GET /finance/statements": "Viewed customer statements",
  "GET /finance/statements/pdf": "Downloaded a customer statement",
  "GET /finance/job-reports": "Viewed job reports",
  "GET /finance/job-reports/pdf": "Downloaded a job report",
  "POST /finance/job-reports/send": "Emailed a job report",
  "GET /client-job-reports": "Viewed job reports",
  "GET /client-job-reports/pdf": "Downloaded a job report",
  "GET /reports/pdf": "Downloaded a report",

  // Quotes and quote requests
  "GET /quotes": "Viewed quotes",
  "GET /quotes/:id": "Opened a quote",
  "GET /quotes/:id/pdf": "Downloaded a quote",
  "POST /quotes": "Created a quote",
  "PUT /quotes/:id/draft": "Edited a draft quote",
  "POST /quotes/:id/versions": "Made a new version of a quote",
  "POST /quotes/:id/issue": "Issued a quote",
  "POST /quotes/:id/send": "Sent a quote to the customer",
  "POST /quotes/:id/decision": "Recorded the customer's decision on a quote",
  "POST /quotes/:id/respond": "Responded to a quote",
  "GET /quote-requests": "Viewed quote requests",
  "GET /quote-requests/:id": "Opened a quote request",
  "GET /quote-requests/:id/attachments/:attachmentId":
    "Downloaded a quote request attachment",
  "GET /quote-requests/:id/quote-suggestion": "Viewed a suggested quote",
  "GET /quote-requests/:id/replies": "Viewed replies to a quote request",
  "POST /quote-requests": "Created a quote request",
  "POST /quote-requests/mine": "Sent a quote request",
  "POST /quote-requests/:id/read-email": "Read a quote request's email",
  "POST /quote-requests/:id/reminders": "Sent a reminder about a quote request",
  "POST /quote-requests/:id/replies": "Replied to a quote request",
  "POST /quote-requests/:id/reply/draft":
    "Wrote a draft reply to a quote request",
  "POST /quote-requests/:id/reply/send": "Sent a reply to a quote request",
  "PUT /quote-requests/:id/reply": "Edited a reply to a quote request",
  "PUT /quote-requests/:id/details": "Edited a quote request",
  "PATCH /quote-requests/:id/customer":
    "Assigned a customer to a quote request",
  "PATCH /quote-requests/:id/mailbox":
    "Moved a quote request to another mailbox",

  // Chat and messages
  "GET /messages": "Viewed messages",
  "POST /messages": "Sent a message",
  "POST /messages/draft": "Wrote a draft message",
  "GET /chat/mine": "Viewed their chat with BJH",
  "POST /chat/mine": "Sent a chat message to BJH",
  "GET /chat/threads": "Viewed customer chats",
  "GET /chat/threads/:companyId": "Opened a customer chat",
  "POST /chat/threads/:companyId": "Replied in a customer chat",
  "GET /team-chat/unread": "Checked for new team chat messages",
  "GET /team-chat/conversations": "Viewed team chats",
  "GET /team-chat/conversations/:id": "Opened a team chat",
  "GET /team-chat/people": "Viewed people to chat with",
  "GET /team-chat/tags": "Viewed team chat tags",
  "POST /team-chat/conversations/direct": "Started a chat with a colleague",
  "POST /team-chat/conversations/group": "Started a group chat",
  "POST /team-chat/conversations/:id/messages": "Sent a team chat message",
  "POST /team-chat/conversations/:id/members": "Added someone to a team chat",
  "POST /team-chat/conversations/:id/leave": "Left a team chat",
  "GET /support": "Viewed support requests",
  "GET /support/mine": "Viewed their support requests",
  "POST /support": "Sent a support request",
  "PATCH /support/:id": "Updated a support request",
  "POST /support/:id/replies": "Replied to a support request",
  "POST /support/mine/:id/replies": "Replied on their support request",

  // Sales and leads
  "GET /leads": "Viewed leads",
  "GET /leads/summary": "Viewed the leads summary",
  "GET /leads/:id/activities": "Viewed a lead's history",
  "POST /leads": "Added a lead",
  "PATCH /leads/:id": "Edited a lead",
  "POST /leads/:id/activities": "Added a note to a lead",
  "POST /leads/:id/customer": "Turned a lead into a customer",
  "GET /campaigns": "Viewed lead campaigns",
  "GET /campaigns/config": "Viewed lead campaign settings",
  "GET /campaigns/:id": "Opened a lead campaign",
  "GET /campaigns/:id/prospects": "Viewed a campaign's prospects",
  "GET /campaigns/:id/prospects/:prospectId": "Opened a campaign prospect",
  "GET /campaigns/:id/runs": "Viewed a campaign's searches",
  "GET /campaigns/:id/runs/:runId": "Opened a campaign search",
  "POST /campaigns": "Created a lead campaign",
  "PATCH /campaigns/:id": "Edited a lead campaign",
  "DELETE /campaigns/:id": "Deleted a lead campaign",
  "POST /campaigns/:id/runs": "Started a campaign search",
  "POST /campaigns/:id/runs/:runId/cancel": "Stopped a campaign search",
  "POST /campaigns/:id/prospects/promote": "Moved prospects into leads",
  "GET /sales/overview": "Viewed the sales overview",
  "GET /sales/pool": "Viewed the sales contact pool",
  "POST /sales/pool/dismiss": "Removed contacts from the sales pool",
  "GET /sales/drafts": "Viewed sales email drafts",
  "POST /sales/drafts": "Wrote a sales email draft",
  "PATCH /sales/drafts/:id": "Edited a sales email draft",
  "POST /sales/drafts/:id/approve": "Approved a sales email",
  "POST /sales/drafts/:id/reject": "Rejected a sales email",
  "POST /sales/drafts/approve": "Approved sales emails",
  "GET /sales/messages": "Viewed sales emails",
  "GET /sales/messages/:id": "Opened a sales email",
  "GET /sales/messages/:id/thread": "Viewed a sales email conversation",
  "GET /sales/messages/:id/attachments/:attachmentId/download":
    "Downloaded a sales email attachment",
  "GET /sales/mailbox/folders": "Viewed the sales mailbox folders",
  "POST /sales/mailbox/sync": "Refreshed the sales mailbox",
  "POST /sales/messages/preview": "Previewed a sales email",
  "POST /sales/messages/send": "Sent a sales email",
  "POST /sales/messages/:id/retry": "Tried sending a sales email again",
  "POST /sales/messages/:id/unsubscribe-sender": "Unsubscribed a sender",
  "GET /sales/unsubscribe/:token": "Opened an unsubscribe link",
  "POST /sales/unsubscribe/:token": "Unsubscribed from sales emails",
  "POST /inbound-email": "Received an email",
  "POST /inbound-email/poll": "Checked the mailbox for new emails",

  // Transport, stock and warehouse
  "GET /drivers": "Viewed drivers",
  "POST /drivers": "Added a driver",
  "POST /drivers/:id/active": "Activated or deactivated a driver",
  "GET /vehicles": "Viewed vehicles",
  "POST /vehicles": "Added a vehicle",
  "PUT /vehicles/:id": "Edited a vehicle",
  "POST /vehicles/:id/active": "Activated or deactivated a vehicle",
  "GET /warehouse/locations": "Viewed warehouse locations",
  "POST /warehouse/locations": "Added a warehouse location",
  "POST /warehouse/locations/:id/active":
    "Activated or deactivated a warehouse location",
  "GET /stock/report": "Viewed the stock report",

  // Settings, knowledge, assistant, push
  "GET /settings": "Viewed settings",
  "PUT /settings": "Changed settings",
  "GET /settings/revisions": "Viewed the history of settings changes",
  "GET /knowledge": "Viewed the knowledge base",
  "POST /knowledge": "Added a knowledge base entry",
  "PUT /knowledge/:id": "Edited a knowledge base entry",
  "DELETE /knowledge/:id": "Deleted a knowledge base entry",
  "POST /knowledge/:id/reviewed": "Marked a knowledge base entry as reviewed",
  "GET /assistant": "Opened the assistant",
  "GET /assistant/conversations": "Viewed assistant conversations",
  "GET /assistant/conversations/:id": "Opened an assistant conversation",
  "DELETE /assistant/conversations/:id": "Deleted an assistant conversation",
  "POST /assistant/turn": "Asked the assistant something",
  "POST /assistant/confirm": "Confirmed an assistant action",
  "GET /push/key": "Set up phone notifications",
  "POST /push/subscriptions": "Turned on phone notifications",
  "DELETE /push/subscriptions": "Turned off phone notifications",
};

const verbs: Record<string, string> = {
  GET: "Viewed",
  POST: "Added or sent",
  PUT: "Edited",
  PATCH: "Edited",
  DELETE: "Removed",
};

/** First plain word of a route, e.g. "/jobs/:id/milestones" -> "jobs". */
function topic(path: string): string {
  const word = path.split("/").find((part) => part && !part.startsWith(":"));
  return (word ?? "the app").replace(/-/g, " ");
}

export function describeAction(method: string, route: string): string {
  if (route === "(unmatched)") return "Visited a page that does not exist";
  const path = route.replace(/^\/api\/v1/, "") || "/";
  return (
    labels[`${method} ${path}`] ?? `${verbs[method] ?? "Used"} ${topic(path)}`
  );
}

/** What happened to the request, in words. */
export function describeResult(statusCode: number): {
  text: string;
  failed: boolean;
} {
  if (statusCode === 401) return { text: "Not signed in", failed: true };
  if (statusCode === 403) return { text: "Not allowed", failed: true };
  if (statusCode === 404) return { text: "Not found", failed: true };
  if (statusCode === 429) return { text: "Too many attempts", failed: true };
  if (statusCode >= 500) return { text: "Something went wrong", failed: true };
  if (statusCode >= 400) return { text: "Rejected", failed: true };
  return { text: "Done", failed: false };
}
