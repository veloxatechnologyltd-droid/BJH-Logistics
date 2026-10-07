import { z } from "zod";

export const departmentRoleKeys = [
  "air_import_rep",
  "air_export_rep",
  "sea_import_rep",
  "sea_export_rep",
] as const;
export const staffRoleKeys = ["super_admin", ...departmentRoleKeys] as const;

export type StaffRoleKey = (typeof staffRoleKeys)[number];

export const serviceLineKeys = [
  "sea_import",
  "sea_export",
  "air_import",
  "air_export",
  "warehousing",
  "road_transport",
] as const;
export type ServiceLine = (typeof serviceLineKeys)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, required text of 1..max characters, with the API's error wording. */
function requiredText(field: string, maximumLength: number) {
  return z
    .string({ error: `${field} is required` })
    .transform((value) => value.trim())
    .refine((value) => value.length >= 1 && value.length <= maximumLength, {
      error: `${field} must contain 1 to ${maximumLength} characters`,
    });
}

const emailField = requiredText("email", 254).refine(
  (value) => EMAIL_PATTERN.test(value),
  { error: "email must be a valid email address" },
);

const objectError = (message: string) => ({ error: message });

const optionalText = (field: string, maximumLength: number) =>
  z
    .string({ error: `${field} must be text` })
    .transform((value) => value.trim())
    .refine((value) => value.length <= maximumLength, {
      error: `${field} must be at most ${maximumLength} characters`,
    })
    .nullish()
    .transform((value) => value || null);

/** A phone number people can type: digits with an optional +, spaces, dashes and brackets. */
const phoneField = z
  .string({ error: "phone must be text" })
  .transform((value) => value.trim())
  .refine((value) => value === "" || /^\+?[0-9][0-9 ()-]{4,38}$/.test(value), {
    error:
      "phone must be a phone number such as 024 405 8592 or +233 24 405 8592",
  })
  .nullish()
  .transform((value) => value || null);

export const customerInputSchema = z.object(
  {
    companyName: requiredText("companyName", 160),
    tradingName: optionalText("tradingName", 160),
    registrationNumber: optionalText("registrationNumber", 120),
    taxNumber: optionalText("taxNumber", 120),
    companyPhone: phoneField,
    companyEmail: z
      .string({ error: "companyEmail must be text" })
      .transform((value) => value.trim())
      .refine((value) => value === "" || EMAIL_PATTERN.test(value), {
        error: "companyEmail must be a valid email address",
      })
      .nullish()
      .transform((value) => value || null),
    website: optionalText("website", 300),
    businessAddress: optionalText("businessAddress", 1000),
    billingAddress: optionalText("billingAddress", 1000),
    country: optionalText("country", 100),
    contactName: requiredText("contactName", 160),
    contactRole: optionalText("contactRole", 120),
    email: emailField,
    phone: phoneField,
  },
  objectError("A customer object is required"),
);
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const customerCompanyUpdateSchema = z.object(
  {
    companyName: requiredText("companyName", 160),
    tradingName: optionalText("tradingName", 160),
    registrationNumber: optionalText("registrationNumber", 120),
    taxNumber: optionalText("taxNumber", 120),
    phone: phoneField,
    companyEmail: z
      .string({ error: "companyEmail must be text" })
      .transform((value) => value.trim())
      .refine((value) => value === "" || EMAIL_PATTERN.test(value), {
        error: "companyEmail must be a valid email address",
      })
      .nullish()
      .transform((value) => value || null),
    website: optionalText("website", 300),
    businessAddress: optionalText("businessAddress", 1000),
    billingAddress: optionalText("billingAddress", 1000),
    country: optionalText("country", 100),
  },
  objectError("A customer company update is required"),
);
export type CustomerCompanyUpdate = z.infer<typeof customerCompanyUpdateSchema>;

export const customerContactInputSchema = z.object(
  {
    name: requiredText("name", 160),
    role: optionalText("role", 120),
    email: emailField,
    phone: phoneField,
    isPrimary: z.boolean().default(false),
  },
  objectError("A contact object is required"),
);
export type CustomerContactInput = z.infer<typeof customerContactInputSchema>;

/** Update a contact's details and notification settings. */
export const customerContactUpdateSchema = z
  .object(
    {
      name: requiredText("name", 160),
      role: optionalText("role", 120),
      email: emailField,
      phone: phoneField,
      notify: z.boolean({ error: "notify must be true or false" }),
      isPrimary: z.boolean({ error: "isPrimary must be true or false" }),
    },
    objectError("A contact update object is required"),
  )
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    error: "At least one contact field must be provided",
  });
export type CustomerContactUpdate = z.infer<typeof customerContactUpdateSchema>;

export const quoteRequestInputSchema = z.object(
  {
    companyName: requiredText("companyName", 160),
    contactName: requiredText("contactName", 160),
    email: emailField,
    message: requiredText("message", 5000),
  },
  objectError("A quote request object is required"),
);
export type QuoteRequestInput = z.infer<typeof quoteRequestInputSchema>;

const staffRoleField = z.enum(staffRoleKeys, {
  error: "roleKey is not a supported staff role",
});

export const staffRoleInputSchema = z.object(
  {
    email: z.string().optional().catch(undefined),
    roleKey: staffRoleField,
  },
  objectError("A roleKey is required"),
);
export type StaffRoleInput = z.infer<typeof staffRoleInputSchema>;

export const staffCreateInputSchema = z.object(
  {
    email: z.string().catch(""),
    password: z.string().catch(""),
    roleKey: staffRoleField,
  },
  objectError("Email, password and roleKey are required"),
);
export type StaffCreateInput = z.infer<typeof staffCreateInputSchema>;

const uuidField = (field: string) =>
  z
    .string({ error: `${field} is required` })
    .refine(isUuid, { error: `${field} must be a valid ID` });

export const jobCreateInputSchema = z.object(
  {
    customerCompanyId: uuidField("customerCompanyId"),
    serviceLine: z.enum(serviceLineKeys, {
      error:
        "serviceLine must be sea_import, sea_export, air_import, air_export, warehousing or road_transport",
    }),
    quoteRequestId: uuidField("quoteRequestId")
      .nullish()
      .transform((v) => v ?? null),
  },
  objectError("A job object is required"),
);
export type JobCreateInput = z.infer<typeof jobCreateInputSchema>;

export const jobStatusKeys = [
  "open",
  "in_progress",
  "on_hold",
  "ready_to_close",
  "closed",
  "cancelled",
] as const;
export type JobStatus = (typeof jobStatusKeys)[number];

/** A customer is active with an unfinished job or one opened within this many days. */
export const customerActiveDays = 90;

/** Allowed moves. Leaving closed/cancelled is a reopen. */
export const jobStatusTransitions: Record<JobStatus, readonly JobStatus[]> = {
  open: ["in_progress", "on_hold", "closed", "cancelled"],
  in_progress: ["on_hold", "ready_to_close", "closed", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
  ready_to_close: ["in_progress", "closed", "cancelled"],
  closed: ["in_progress"],
  cancelled: ["in_progress"],
};

/**
 * A written reason is required to cancel, to reopen a closed/cancelled job and
 * to close a job that was not first marked ready_to_close (a closure override).
 */
export function jobStatusReasonRequired(
  from: JobStatus,
  to: JobStatus,
): boolean {
  return (
    to === "cancelled" ||
    from === "closed" ||
    from === "cancelled" ||
    (to === "closed" && from !== "ready_to_close")
  );
}

export const jobStatusChangeInputSchema = z.object(
  {
    status: z.enum(jobStatusKeys, {
      error: "status is not a supported job status",
    }),
    reason: z
      .string({ error: "reason must be text" })
      .transform((value) => value.trim())
      .refine((value) => value.length <= 2000, {
        error: "reason must be at most 2000 characters",
      })
      .nullish()
      .transform((value) => value || null),
  },
  { error: "A status object is required" },
);
export type JobStatusChangeInput = z.infer<typeof jobStatusChangeInputSchema>;

export const partyRoleKeys = [
  "shipper",
  "consignee",
  "notify_party",
  "agent",
] as const;
export type PartyRole = (typeof partyRoleKeys)[number];

export const jobPartyInputSchema = z.object(
  {
    role: z.enum(partyRoleKeys, {
      error: "role must be shipper, consignee, notify_party or agent",
    }),
    name: requiredText("name", 200),
    details: z
      .string({ error: "details must be text" })
      .transform((value) => value.trim())
      .refine((value) => value.length <= 1000, {
        error: "details must be at most 1000 characters",
      })
      .nullish()
      .transform((value) => value || null),
  },
  { error: "A party object is required" },
);
export type JobPartyInput = z.infer<typeof jobPartyInputSchema>;

export const referenceKindKeys = [
  "master_bl",
  "house_bl",
  "master_awb",
  "house_awb",
  "booking",
  "container",
] as const;
export type ReferenceKind = (typeof referenceKindKeys)[number];

const seaOnlyKinds: readonly ReferenceKind[] = [
  "master_bl",
  "house_bl",
  "container",
];
const airOnlyKinds: readonly ReferenceKind[] = ["master_awb", "house_awb"];

/** Bills of lading and containers belong to sea jobs, air waybills to air jobs. */
export function referenceKindAllowedFor(
  serviceLine: ServiceLine,
  kind: ReferenceKind,
): boolean {
  if (serviceLine.startsWith("sea")) return !airOnlyKinds.includes(kind);
  if (serviceLine.startsWith("air")) return !seaOnlyKinds.includes(kind);
  // Warehousing and road jobs: a booking or a container, no bills of lading.
  return kind === "booking" || kind === "container";
}

/** House documents hang under a master of the matching kind. */
export const referenceParentKind: Partial<
  Record<ReferenceKind, ReferenceKind>
> = { house_bl: "master_bl", house_awb: "master_awb" };

export const shipmentReferenceInputSchema = z.object(
  {
    kind: z.enum(referenceKindKeys, {
      error:
        "kind must be master_bl, house_bl, master_awb, house_awb, booking or container",
    }),
    value: requiredText("value", 80),
    sealNumber: z
      .string({ error: "sealNumber must be text" })
      .transform((value) => value.trim())
      .refine((value) => value.length <= 80, {
        error: "sealNumber must be at most 80 characters",
      })
      .nullish()
      .transform((value) => value || null),
    parentReferenceId: uuidField("parentReferenceId")
      .nullish()
      .transform((value) => value ?? null),
  },
  { error: "A reference object is required" },
);
export type ShipmentReferenceInput = z.infer<
  typeof shipmentReferenceInputSchema
>;

export const documentTypeLabels = {
  bill_of_lading: "Bill of lading",
  airway_bill: "Airway bill",
  commercial_invoice: "Commercial invoice",
  packing_list: "Packing list",
  customs_document: "Customs document",
  delivery_note: "Delivery note / proof of delivery",
  eir: "EIR (equipment interchange receipt)",
  supplier_invoice: "Supplier invoice",
  disbursement_evidence: "Disbursement evidence",
  office_letter: "Office letter",
  other: "Other",
} as const;
export type DocumentType = keyof typeof documentTypeLabels;
export const documentTypeKeys = Object.keys(
  documentTypeLabels,
) as DocumentType[];

/** Fields sent with an uploaded file; documentId adds a new version to an existing document. */
export const documentUploadFieldsSchema = z.object(
  {
    documentType: z.enum(
      documentTypeKeys as [DocumentType, ...DocumentType[]],
      {
        error: "documentType is required and must be a supported document type",
      },
    ),
    documentId: uuidField("documentId")
      .nullish()
      .transform((value) => value ?? null),
  },
  { error: "Upload details are required" },
);
export type DocumentUploadFields = z.infer<typeof documentUploadFieldsSchema>;

/** A library upload is always a new document; it may name a job or a company, not both. */
export const libraryUploadFieldsSchema = documentUploadFieldsSchema
  .omit({ documentId: true })
  .extend({
    title: z
      .string()
      .trim()
      .max(200, { error: "title can be at most 200 characters" })
      .nullish()
      .transform((value) => value || null),
    jobId: uuidField("jobId")
      .nullish()
      .transform((value) => value ?? null),
    companyId: uuidField("companyId")
      .nullish()
      .transform((value) => value ?? null),
  })
  .refine((fields) => !(fields.jobId && fields.companyId), {
    error: "Choose a job or a customer company, not both",
  });
export type LibraryUploadFields = z.infer<typeof libraryUploadFieldsSchema>;

export interface MilestoneDefinition {
  key: string;
  label: string;
}

/**
 * Sea import sequence as the client described it (client-derived; order is
 * indicative and not enforced).
 * Milestones are not enforced in order: real jobs overlap.
 */
export const seaImportMilestones: readonly MilestoneDefinition[] = [
  { key: "cargo_arrived", label: "Cargo arrived; customer updated" },
  {
    key: "customs_declaration_submitted",
    label: "Documents entered with customs",
  },
  { key: "duties_assessed", label: "Customs tax / duties generated" },
  { key: "customer_invoice_issued", label: "Bill issued to customer" },
  { key: "customer_payment_recorded", label: "Customer payment recorded" },
  {
    key: "port_charges_paid",
    label: "Port, terminal and other charges paid",
  },
  {
    key: "container_released_by_line",
    label: "Container released by shipping line",
  },
  { key: "terminal_booked", label: "Terminal charges booked" },
  { key: "customs_inspection_completed", label: "Customs inspection done" },
  {
    key: "customs_released",
    label: "Customs released; delivery authorisation received",
  },
  { key: "container_dispatched", label: "Container loaded and dispatched" },
  {
    key: "delivery_note_signed",
    label: "Delivered; delivery note signed by consignee",
  },
  {
    key: "empty_container_returned",
    label: "Empty container returned to terminal",
  },
  { key: "eir_received", label: "EIR (equipment condition) received" },
];

/** Sea export, as the client described it: invoice, booking, stuffing, customs, shipping. */
export const seaExportMilestones: readonly MilestoneDefinition[] = [
  { key: "customer_invoice_issued", label: "Cost arranged; invoice sent" },
  { key: "vessel_booked", label: "Vessel booked" },
  {
    key: "container_sent_to_customer",
    label: "Container sent to customer for loading",
  },
  { key: "container_stuffed", label: "Container stuffed" },
  {
    key: "container_returned_to_port",
    label: "Loaded container returned to port",
  },
  { key: "customs_processed", label: "Customs process done" },
  { key: "customs_released", label: "Customs release received" },
  {
    key: "terminal_charges_paid",
    label: "Terminal handling charges paid",
  },
  { key: "container_shipped", label: "Container shipped out" },
  {
    key: "final_invoice_or_waybill_issued",
    label: "Final invoice / waybill issued to customer",
  },
];

/** Air import: the same clearance and delivery steps as sea, without container steps or EIR. */
export const airImportMilestones: readonly MilestoneDefinition[] = [
  { key: "cargo_arrived", label: "Cargo arrived; customer updated" },
  {
    key: "customs_declaration_submitted",
    label: "Documents entered with customs",
  },
  { key: "duties_assessed", label: "Customs tax / duties generated" },
  { key: "customer_invoice_issued", label: "Bill issued to customer" },
  { key: "customer_payment_recorded", label: "Customer payment recorded" },
  { key: "airport_charges_paid", label: "Airport and other charges paid" },
  { key: "customs_released", label: "Customs released cargo" },
  {
    key: "delivery_note_signed",
    label: "Delivered; delivery note signed by consignee",
  },
];

/** Air export: booking, customs, charges, departure and waybill. */
export const airExportMilestones: readonly MilestoneDefinition[] = [
  { key: "air_booked", label: "Air booking made with airline" },
  {
    key: "cargo_received_from_customer",
    label: "Goods received from customer",
  },
  { key: "customs_arranged", label: "Customs arrangements made" },
  { key: "customs_released", label: "Customs released goods" },
  {
    key: "airport_airline_charges_paid",
    label: "Airport and airline charges paid",
  },
  { key: "cargo_departed", label: "Cargo left Ghana" },
  { key: "waybill_issued", label: "Waybill issued" },
];

export const milestoneTemplates: Record<
  ServiceLine,
  readonly MilestoneDefinition[]
> = {
  sea_import: seaImportMilestones,
  sea_export: seaExportMilestones,
  air_import: airImportMilestones,
  air_export: airExportMilestones,
  // Warehousing and road jobs have no milestone list: stock movements and
  // deliveries carry their progress.
  warehousing: [],
  road_transport: [],
};

export const milestoneEventInputSchema = z.object(
  {
    milestoneKey: requiredText("milestoneKey", 80),
    occurredAt: z
      .string({ error: "occurredAt must be a date and time" })
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        error: "occurredAt must be a date and time",
      })
      .nullish()
      .transform((value) => (value ? new Date(value).toISOString() : null)),
    note: z
      .string({ error: "note must be text" })
      .transform((value) => value.trim())
      .refine((value) => value.length <= 2000, {
        error: "note must be at most 2000 characters",
      })
      .nullish()
      .transform((value) => value || null),
    correctionOf: uuidField("correctionOf")
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("A milestone object is required"),
);
export type MilestoneEventInput = z.infer<typeof milestoneEventInputSchema>;

/**
 * Parses untrusted input with a contract schema. Returns the parsed value or
 * the first issue's message, so callers can raise their own HTTP error.
 */
export function parseContract<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { success: true; data: T } | { success: false; message: string } {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, message: result.error.issues[0].message };
}

export const etaInputSchema = z.object(
  {
    etaAt: z
      .string({ error: "etaAt is required" })
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        error: "etaAt must be a date and time",
      })
      .transform((value) => new Date(value).toISOString()),
    source: requiredText("source", 200),
    note: z
      .string({ error: "note must be text" })
      .transform((value) => value.trim())
      .refine((value) => value.length <= 2000, {
        error: "note must be at most 2000 characters",
      })
      .nullish()
      .transform((value) => value || null),
    correctionOf: uuidField("correctionOf")
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("An ETA object is required"),
);
export type EtaInput = z.infer<typeof etaInputSchema>;

export const taskKinds = [
  "task",
  "missing_documents",
  "damage",
  "delay",
  "other",
] as const;
export type TaskKind = (typeof taskKinds)[number];

export const jobTaskInputSchema = z.object(
  {
    kind: z
      .enum(taskKinds, { error: `kind must be one of ${taskKinds.join(", ")}` })
      .default("task"),
    title: requiredText("title", 200),
    details: optionalText("details", 2000),
    assignedRole: z.enum(staffRoleKeys, {
      error: `assignedRole must be one of ${staffRoleKeys.join(", ")}`,
    }),
    dueDate: z
      .string({ error: "dueDate must be a date (YYYY-MM-DD)" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        error: "dueDate must be a date (YYYY-MM-DD)",
      })
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
        error: "dueDate must be a date (YYYY-MM-DD)",
      })
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("A task object is required"),
);
export type JobTaskInput = z.infer<typeof jobTaskInputSchema>;

export const taskCompletionSchema = z.object(
  { note: optionalText("note", 2000) },
  objectError("A completion object is required"),
);

export const quoteBasisKeys = [
  "fixed",
  "per_bl",
  "per_container",
  "at_cost",
] as const;
export type QuoteBasis = (typeof quoteBasisKeys)[number];

export const quoteBasisLabels: Record<QuoteBasis, string> = {
  fixed: "Fixed",
  per_bl: "Per bill of lading",
  per_container: "Per container",
  at_cost: "At cost",
};

const MAX_MINOR_AMOUNT = 1_000_000_000_000;
const minorAmount = (field: string) =>
  z
    .number({ error: `${field} must be a whole number of minor units` })
    .int({ error: `${field} must be a whole number of minor units` })
    .min(0, { error: `${field} cannot be negative` })
    .max(MAX_MINOR_AMOUNT, { error: `${field} is too large` })
    .nullish()
    .transform((value) => value ?? null);

const textList = (field: string, maximumItems: number, maximumLength: number) =>
  z
    .array(
      z
        .string({ error: `${field} must be a list of text` })
        .transform((value) => value.trim())
        .refine((value) => value.length >= 1 && value.length <= maximumLength, {
          error: `each ${field} entry must contain 1 to ${maximumLength} characters`,
        }),
      { error: `${field} must be a list of text` },
    )
    .max(maximumItems, {
      error: `${field} can have at most ${maximumItems} entries`,
    })
    .nullish()
    .transform((value) => value ?? []);

/** One charge row: a single amount, or one amount per size column of the quote. */
export const quoteLineInputSchema = z
  .object(
    {
      section: optionalText("section", 200),
      description: requiredText("description", 300),
      /** Optional description printed under the charge name. */
      details: optionalText("details", 500),
      basis: z.enum(quoteBasisKeys, {
        error: `basis must be one of ${quoteBasisKeys.join(", ")}`,
      }),
      basisNote: optionalText("basisNote", 300),
      amountMinor: minorAmount("amountMinor"),
      sizeAmountsMinor: z
        .array(
          z
            .number({ error: "sizeAmountsMinor must be whole minor units" })
            .int({ error: "sizeAmountsMinor must be whole minor units" })
            .min(0, { error: "sizeAmountsMinor cannot be negative" })
            .max(MAX_MINOR_AMOUNT, { error: "sizeAmountsMinor is too large" }),
          { error: "sizeAmountsMinor must be a list of amounts" },
        )
        .min(1, { error: "sizeAmountsMinor needs at least one amount" })
        .max(4, { error: "sizeAmountsMinor has at most 4 amounts" })
        .nullish()
        .transform((value) => value ?? null),
    },
    objectError("A charge line object is required"),
  )
  .superRefine((line, context) => {
    const sized = line.sizeAmountsMinor !== null;
    if (sized && line.amountMinor !== null) {
      context.addIssue({
        code: "custom",
        message: "Use either one amount or an amount per size, not both",
      });
    } else if (
      line.basis !== "at_cost" &&
      line.amountMinor === null &&
      !sized
    ) {
      context.addIssue({
        code: "custom",
        message: "Only at-cost lines can leave the amount out",
      });
    }
  });
export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

export const quoteVersionInputSchema = z
  .object(
    {
      currency: z
        .string({ error: "currency is required" })
        .transform((value) => value.trim().toUpperCase())
        .refine((value) => /^[A-Z]{3}$/.test(value), {
          error: "currency must be a 3-letter code such as USD or GHS",
        }),
      title: requiredText("title", 200),
      subtitle: optionalText("subtitle", 200),
      shipmentScope: optionalText("shipmentScope", 500),
      intro: optionalText("intro", 4000),
      atCostNote: optionalText("atCostNote", 2000),
      procedureSteps: textList("procedureSteps", 30, 1000),
      requiredDocuments: textList("requiredDocuments", 30, 300),
      documentsNote: optionalText("documentsNote", 2000),
      timeline: optionalText("timeline", 2000),
      terms: textList("terms", 30, 1000),
      /** Names of the size columns, for example 20ft and 40ft; empty for none. */
      sizeLabels: textList("sizeLabels", 4, 30),
      lines: z
        .array(quoteLineInputSchema, { error: "lines must be a list" })
        .max(100, { error: "A quote can have at most 100 charge lines" }),
    },
    objectError("A quote version object is required"),
  )
  .superRefine((version, context) => {
    const names = version.sizeLabels.map((label) => label.toLowerCase());
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        message: "sizeLabels must not repeat",
      });
    } else if (
      version.lines.some(
        (line) =>
          line.sizeAmountsMinor !== null &&
          line.sizeAmountsMinor.length !== version.sizeLabels.length,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Give one amount for each size column, or use one amount",
      });
    }
  });
export type QuoteVersionInput = z.infer<typeof quoteVersionInputSchema>;

export const quoteCreateInputSchema = z.object(
  {
    customerCompanyId: uuidField("customerCompanyId"),
    serviceLine: z.enum(serviceLineKeys, {
      error:
        "serviceLine must be sea_import, sea_export, air_import, air_export, warehousing or road_transport",
    }),
    quoteRequestId: uuidField("quoteRequestId")
      .nullish()
      .transform((value) => value ?? null),
    version: quoteVersionInputSchema,
  },
  objectError("A quote object is required"),
);
export type QuoteCreateInput = z.infer<typeof quoteCreateInputSchema>;

export const quoteDecisionKeys = ["accepted", "rejected"] as const;
export type QuoteDecision = (typeof quoteDecisionKeys)[number];

/** Staff record the client's decision on one issued version of a quote. */
export const quoteDecisionInputSchema = z.object(
  {
    versionNumber: z
      .number({ error: "versionNumber is required" })
      .int({ error: "versionNumber must be a whole number" })
      .min(1, { error: "versionNumber must be a whole number" }),
    decision: z.enum(quoteDecisionKeys, {
      error: "decision must be accepted or rejected",
    }),
    clientSignatory: requiredText("clientSignatory", 160),
    decidedAt: z
      .string({ error: "decidedAt must be a date and time" })
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        error: "decidedAt must be a date and time",
      })
      .nullish()
      .transform((value) => (value ? new Date(value).toISOString() : null)),
    note: optionalText("note", 2000),
  },
  objectError("A quote decision object is required"),
);
export type QuoteDecisionInput = z.infer<typeof quoteDecisionInputSchema>;

const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/-]{0,19}$/;
const prefixField = (field: string) =>
  z
    .string({ error: `${field} is required` })
    .transform((value) => value.trim())
    .refine((value) => PREFIX_PATTERN.test(value), {
      error: `${field} must be 1 to 20 letters, digits, "/" or "-"`,
    });

const optionalEmail = z
  .string({ error: "email must be text" })
  .transform((value) => value.trim())
  .refine((value) => value === "" || EMAIL_PATTERN.test(value), {
    error: "email must be a valid email address",
  })
  .nullish()
  .transform((value) => value || null);

/**
 * BJH's business settings. Tax rates are basis points (1500 = 15%); how levies
 * combine on an invoice is decided with the invoice work (F3), not here.
 */
export const notificationChannelModes = ["email", "sms", "both"] as const;
export type NotificationChannelMode = (typeof notificationChannelModes)[number];

export const businessSettingsSchema = z
  .object(
    {
      issuer: z.object(
        {
          name: requiredText("issuer name", 160),
          address: optionalText("issuer address", 500),
          phone: optionalText("issuer phone", 80),
          email: optionalEmail,
          website: optionalText("issuer website", 200),
        },
        objectError("issuer details are required"),
      ),
      currencies: z
        .array(
          z
            .string({ error: "currencies must be 3-letter codes" })
            .transform((value) => value.trim().toUpperCase())
            .refine((value) => /^[A-Z]{3}$/.test(value), {
              error: "currencies must be 3-letter codes such as USD or GHS",
            }),
          { error: "currencies must be a list of 3-letter codes" },
        )
        .min(1, { error: "Configure at least one currency" })
        .max(10, { error: "At most 10 currencies can be configured" }),
      taxLines: z
        .array(
          z.object(
            {
              name: requiredText("tax line name", 80),
              rateBasisPoints: z
                .number({ error: "rateBasisPoints must be a whole number" })
                .int({ error: "rateBasisPoints must be a whole number" })
                .min(0, { error: "rateBasisPoints must be 0 to 10000" })
                .max(10000, { error: "rateBasisPoints must be 0 to 10000" }),
            },
            objectError("A tax line object is required"),
          ),
          { error: "taxLines must be a list" },
        )
        .max(10, { error: "At most 10 tax lines can be configured" })
        .nullish()
        .transform((value) => value ?? []),
      paymentTermsDays: z
        .number({ error: "paymentTermsDays must be a whole number" })
        .int({ error: "paymentTermsDays must be a whole number" })
        .min(0, { error: "paymentTermsDays must be 0 to 365" })
        .max(365, { error: "paymentTermsDays must be 0 to 365" })
        .nullish()
        .transform((value) => value ?? null),
      numbering: z.object(
        {
          quotePrefix: prefixField("quotePrefix"),
          invoicePrefix: prefixField("invoicePrefix"),
          receiptPrefix: prefixField("receiptPrefix"),
          waybillPrefix: prefixField("waybillPrefix")
            .nullish()
            .transform((value) => value ?? "BJH/WB"),
        },
        objectError("numbering prefixes are required"),
      ),
      quoteDefaults: z
        .object(
          {
            intro: optionalText("quote intro", 4000),
            atCostNote: optionalText("at-cost note", 2000),
            procedureSteps: textList("procedureSteps", 30, 1000),
            requiredDocuments: textList("requiredDocuments", 30, 300),
            documentsNote: optionalText("documents note", 2000),
            timeline: optionalText("timeline", 2000),
            terms: textList("terms", 30, 1000),
          },
          objectError("quoteDefaults must be an object"),
        )
        .nullish()
        .transform(
          (value) =>
            value ?? {
              intro: null,
              atCostNote: null,
              procedureSteps: [],
              requiredDocuments: [],
              documentsNote: null,
              timeline: null,
              terms: [],
            },
        ),
      // Which channel every customer message uses: email, SMS or both.
      notifications: z
        .object(
          {
            channels: z.enum(notificationChannelModes, {
              error: "notification channels must be email, sms or both",
            }),
          },
          objectError("notifications must be an object"),
        )
        .nullish()
        .transform((value) => value ?? { channels: "both" as const }),
    },
    objectError("A settings object is required"),
  )
  .superRefine((settings, context) => {
    if (new Set(settings.currencies).size !== settings.currencies.length) {
      context.addIssue({
        code: "custom",
        message: "currencies must not repeat",
      });
    }
  });
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

export const chargeKinds = ["service", "disbursement"] as const;
export type ChargeKind = (typeof chargeKinds)[number];
export const chargeKindLabels: Record<ChargeKind, string> = {
  service: "Service charge",
  disbursement: "Disbursement (third-party cost)",
};

const currencyCode = (field: string) =>
  z
    .string({ error: `${field} is required` })
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), {
      error: `${field} must be a 3-letter code such as USD or GHS`,
    });

export const jobChargeInputSchema = z.object(
  {
    kind: z.enum(chargeKinds, {
      error: `kind must be one of ${chargeKinds.join(", ")}`,
    }),
    description: requiredText("description", 300),
    currency: currencyCode("currency"),
    quantity: z
      .number({ error: "quantity must be a whole number" })
      .int({ error: "quantity must be a whole number" })
      .min(1, { error: "quantity must be 1 to 10000" })
      .max(10000, { error: "quantity must be 1 to 10000" })
      .nullish()
      .transform((value) => value ?? 1),
    unitQuotedMinor: minorAmount("unitQuotedMinor"),
  },
  objectError("A charge object is required"),
);
export type JobChargeInput = z.infer<typeof jobChargeInputSchema>;

/** An exchange rate as text, e.g. "15.2500": positive, up to 8 decimals. */
export const exchangeRateSchema = z
  .string({
    error: "exchangeRate must be a positive number with up to 8 decimals",
  })
  .transform((value) => value.trim())
  .refine((value) => /^\d{1,10}(\.\d{1,8})?$/.test(value), {
    error: "exchangeRate must be a positive number with up to 8 decimals",
  })
  .refine((value) => Number(value) > 0, {
    error: "exchangeRate must be a positive number with up to 8 decimals",
  });

export const chargeActualInputSchema = z.object(
  {
    amountMinor: z
      .number({ error: "amountMinor must be a whole number of minor units" })
      .int({ error: "amountMinor must be a whole number of minor units" })
      .min(0, { error: "amountMinor cannot be negative" })
      .max(MAX_MINOR_AMOUNT, { error: "amountMinor is too large" }),
    currency: currencyCode("currency"),
    exchangeRate: exchangeRateSchema.nullish().transform((v) => v ?? null),
    rateNote: optionalText("rateNote", 200),
    supplierDocumentId: uuidField("supplierDocumentId")
      .nullish()
      .transform((value) => value ?? null),
    note: optionalText("note", 2000),
    correctionOf: uuidField("correctionOf")
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("An actual amount object is required"),
);
export type ChargeActualInput = z.infer<typeof chargeActualInputSchema>;

export const chargeImportInputSchema = z.object(
  {
    /** One of the size column names of the accepted quote, such as 20ft. */
    containerSize: optionalText("containerSize", 30),
    quantity: z
      .number({ error: "quantity must be a whole number" })
      .int({ error: "quantity must be a whole number" })
      .min(1, { error: "quantity must be at least 1" })
      .max(10000, { error: "quantity cannot exceed 10000" })
      .nullish()
      .transform((value) => value ?? 1),
  },
  objectError("An import object is required"),
);
export type ChargeImportInput = z.infer<typeof chargeImportInputSchema>;

/**
 * Converts minor units with an exchange rate, rounding half up, using integer
 * arithmetic only (money never passes through floating point).
 */
export function convertMinor(
  amountMinor: number,
  exchangeRate: string,
): number {
  const [whole, fraction = ""] = exchangeRate.split(".");
  const scaled = BigInt(whole + fraction.padEnd(8, "0"));
  const half = BigInt(50_000_000);
  return Number((BigInt(amountMinor) * scaled + half) / BigInt(100_000_000));
}

export const driverInputSchema = z.object(
  {
    name: requiredText("name", 160),
    phone: requiredText("phone", 40),
  },
  objectError("A driver object is required"),
);
export type DriverInput = z.infer<typeof driverInputSchema>;

export const vehicleInputSchema = z.object(
  {
    registration: requiredText("registration", 40),
    description: optionalText("description", 200),
  },
  objectError("A vehicle object is required"),
);
export type VehicleInput = z.infer<typeof vehicleInputSchema>;

export const activeInputSchema = z.object(
  { active: z.boolean({ error: "active must be true or false" }) },
  objectError("An active flag is required"),
);

export const deliveryInputSchema = z.object(
  {
    driverId: uuidField("driverId"),
    vehicleId: uuidField("vehicleId"),
    cargoDescription: requiredText("cargoDescription", 500),
    packages: z
      .number({ error: "packages must be a whole number" })
      .int({ error: "packages must be a whole number" })
      .min(1, { error: "packages must be 1 to 1000000" })
      .max(1_000_000, { error: "packages must be 1 to 1000000" })
      .nullish()
      .transform((value) => value ?? null),
    grossWeightKg: z
      .number({ error: "grossWeightKg must be a number" })
      .min(0, { error: "grossWeightKg must be 0 to 100000000" })
      .max(100_000_000, { error: "grossWeightKg must be 0 to 100000000" })
      .nullish()
      .transform((value) => value ?? null),
    pickupLocation: optionalText("pickupLocation", 300),
    deliveryAddress: requiredText("deliveryAddress", 500),
  },
  objectError("A delivery object is required"),
);
export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

/** The proof of delivery: who received the goods, when, and any damage. */
export const proofOfDeliveryInputSchema = z.object(
  {
    receiverName: requiredText("receiverName", 160),
    receiverPhone: optionalText("receiverPhone", 40),
    deliveredAt: z
      .string({ error: "deliveredAt must be a date and time" })
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        error: "deliveredAt must be a date and time",
      })
      .nullish()
      .transform((value) => (value ? new Date(value).toISOString() : null)),
    damageNotes: optionalText("damageNotes", 2000),
    podDocumentId: uuidField("podDocumentId")
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("A proof of delivery object is required"),
);
export type ProofOfDeliveryInput = z.infer<typeof proofOfDeliveryInputSchema>;

const isoDate = (field: string) =>
  z
    .string({ error: `${field} must be a date (YYYY-MM-DD)` })
    .transform((value) => value.trim())
    .refine(
      (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value,
      { error: `${field} must be a date (YYYY-MM-DD)` },
    );

export const invoiceLineSchema = z.object(
  {
    description: requiredText("description", 300),
    amountMinor: z
      .number({ error: "amountMinor must be a whole number of minor units" })
      .int({ error: "amountMinor must be a whole number of minor units" })
      .min(0, { error: "amountMinor cannot be negative" })
      .max(MAX_MINOR_AMOUNT, { error: "amountMinor is too large" }),
    taxable: z
      .boolean({ error: "taxable must be true or false" })
      .nullish()
      .transform((value) => value ?? true),
  },
  objectError("An invoice line object is required"),
);
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const invoiceInputSchema = z.object(
  {
    currency: currencyCode("currency"),
    lines: z
      .array(invoiceLineSchema, { error: "lines must be a list" })
      .max(100, { error: "An invoice can have at most 100 lines" })
      .nullish()
      .transform((value) => value ?? []),
    dueDate: isoDate("dueDate")
      .nullish()
      .transform((value) => value ?? null),
    notes: optionalText("notes", 2000),
  },
  objectError("An invoice object is required"),
);
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

/** Starting an invoice from the job's charges: no lines are sent. */
export const invoiceFromChargesInputSchema = invoiceInputSchema.omit({
  lines: true,
});
export type InvoiceFromChargesInput = z.infer<
  typeof invoiceFromChargesInputSchema
>;

export const invoiceReasonInputSchema = z.object(
  { reason: requiredText("reason", 500) },
  objectError("A reason is required"),
);

export const paymentMethodKeys = [
  "cash",
  "bank_transfer",
  "cheque",
  "mobile_money",
  "other",
] as const;
export type PaymentMethod = (typeof paymentMethodKeys)[number];

/** A payment received outside the system; staff record it, nothing is charged here. */
export const paymentInputSchema = z.object(
  {
    amountMinor: z
      .number({ error: "amountMinor must be a whole number of minor units" })
      .int({ error: "amountMinor must be a whole number of minor units" })
      .min(1, { error: "amountMinor must be more than zero" })
      .max(MAX_MINOR_AMOUNT, { error: "amountMinor is too large" }),
    receivedOn: isoDate("receivedOn"),
    method: z.enum(paymentMethodKeys, {
      error: `method must be one of ${paymentMethodKeys.join(", ")}`,
    }),
    reference: optionalText("reference", 200),
    evidenceDocumentId: uuidField("evidenceDocumentId")
      .nullish()
      .transform((value) => value ?? null),
    note: optionalText("note", 2000),
  },
  objectError("A payment object is required"),
);
export type PaymentInput = z.infer<typeof paymentInputSchema>;

/** The super admin creates a customer account directly and links it to one company. */
export const customerAccountCreateInputSchema = z.object(
  {
    email: emailField,
    password: z.string().catch(""),
    companyId: uuidField("companyId"),
  },
  objectError("Email, password and companyId are required"),
);
export type CustomerAccountCreateInput = z.infer<
  typeof customerAccountCreateInputSchema
>;

/** A customer's own quote request; the company and email come from their account. */
export const portalQuoteRequestInputSchema = z.object(
  {
    contactName: requiredText("contactName", 160),
    message: requiredText("message", 5000),
    companyId: uuidField("companyId")
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("A quote request object is required"),
);
export type PortalQuoteRequestInput = z.infer<
  typeof portalQuoteRequestInputSchema
>;

export const correspondenceChannelKeys = [
  "email",
  "whatsapp",
  "sms",
  "phone",
  "letter",
  "other",
] as const;
export type CorrespondenceChannel = (typeof correspondenceChannelKeys)[number];

export const correspondenceDirectionKeys = ["received", "sent"] as const;
export type CorrespondenceDirection =
  (typeof correspondenceDirectionKeys)[number];

/** A message, call or letter staff log against a job (no message is sent from here). */
export const correspondenceInputSchema = z.object(
  {
    channel: z.enum(correspondenceChannelKeys, {
      error: `channel must be one of ${correspondenceChannelKeys.join(", ")}`,
    }),
    direction: z.enum(correspondenceDirectionKeys, {
      error: "direction must be received or sent",
    }),
    occurredAt: z
      .string({ error: "occurredAt must be a date and time" })
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        error: "occurredAt must be a date and time",
      })
      .nullish()
      .transform((value) => (value ? new Date(value).toISOString() : null)),
    counterparty: optionalText("counterparty", 200),
    subject: optionalText("subject", 300),
    body: requiredText("body", 20000),
    documentId: uuidField("documentId")
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("A correspondence object is required"),
);
export type CorrespondenceInput = z.infer<typeof correspondenceInputSchema>;

export const warehouseLocationInputSchema = z.object(
  { name: requiredText("name", 120) },
  objectError("A location object is required"),
);
export type WarehouseLocationInput = z.infer<
  typeof warehouseLocationInputSchema
>;

export const stockKindKeys = ["receipt", "release"] as const;
export type StockKind = (typeof stockKindKeys)[number];

/** Goods received into, or released from, a location on a warehousing job. */
export const stockMovementInputSchema = z.object(
  {
    locationId: uuidField("locationId"),
    kind: z.enum(stockKindKeys, { error: "kind must be receipt or release" }),
    item: requiredText("item", 200),
    unit: optionalText("unit", 40).transform((value) => value ?? "units"),
    quantity: z
      .number({ error: "quantity must be a whole number" })
      .int({ error: "quantity must be a whole number" })
      .min(1, { error: "quantity must be 1 to 100000000" })
      .max(100_000_000, { error: "quantity must be 1 to 100000000" }),
    conditionNotes: optionalText("conditionNotes", 2000),
    reference: optionalText("reference", 200),
    occurredAt: z
      .string({ error: "occurredAt must be a date and time" })
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        error: "occurredAt must be a date and time",
      })
      .nullish()
      .transform((value) => (value ? new Date(value).toISOString() : null)),
  },
  objectError("A stock movement object is required"),
);
export type StockMovementInput = z.infer<typeof stockMovementInputSchema>;

/** A message staff send to a company's contacts by the configured channels. */
export const jobMessageInputSchema = z.object(
  {
    subject: optionalText("subject", 200),
    body: requiredText("body", 1500),
  },
  objectError("A message object is required"),
);
export type JobMessageInput = z.infer<typeof jobMessageInputSchema>;

/**
 * A message to client companies that is not about one job: to every company
 * ("all") or to the companies chosen, sent by the configured channels.
 */
export const clientMessageInputSchema = z.object(
  {
    audience: z.union(
      [
        z.literal("all"),
        z
          .array(uuidField("audience"), {
            error: "audience must be all or a list of company IDs",
          })
          .min(1, { error: "Choose at least one company" })
          .max(500, { error: "At most 500 companies can be chosen" }),
      ],
      { error: "audience must be all or a list of company IDs" },
    ),
    subject: optionalText("subject", 200),
    body: requiredText("body", 1500),
  },
  objectError("A message object is required"),
);
export type ClientMessageInput = z.infer<typeof clientMessageInputSchema>;

/** The fields a person chose to apply from an extraction draft, with any corrections. */
export const extractionApproveInputSchema = z.object(
  {
    fields: z
      .array(
        z.object(
          {
            index: z
              .number({ error: "index must be a whole number" })
              .int({ error: "index must be a whole number" })
              .min(0, { error: "index must be a whole number" }),
            value: requiredText("value", 80),
            sealNumber: optionalText("sealNumber", 80),
          },
          objectError("A field object is required"),
        ),
        { error: "fields must be a list" },
      )
      .min(1, { error: "Choose at least one field to apply" })
      .max(50, { error: "At most 50 fields can be applied at once" }),
  },
  objectError("An approval object is required"),
);
export type ExtractionApproveInput = z.infer<
  typeof extractionApproveInputSchema
>;

export const transportDocumentKinds = [
  "house_bl",
  "house_awb",
  "air_manifest",
] as const;
export type TransportDocumentKind = (typeof transportDocumentKinds)[number];

export const transportDocumentTitles: Record<TransportDocumentKind, string> = {
  house_bl: "Transport bill of lading (house B/L)",
  house_awb: "House air waybill (HAWB)",
  air_manifest: "Air cargo manifest",
};

export interface TransportDocumentField {
  key: string;
  label: string;
  /** Several lines of text rather than a single line. */
  multiline?: boolean;
  /** Sits beside its neighbours in the printed grid; multiline fields span the row. */
  group: string;
}

const line = (key: string, label: string, group: string) => ({
  key,
  label,
  group,
});
const block = (key: string, label: string, group: string) => ({
  key,
  label,
  group,
  multiline: true,
});

/**
 * The fields of each document, laid out like BJH's own house B/L, HAWB and
 * manifest samples. Values are free text: BJH types what the document says.
 */
export const transportDocumentFields: Record<
  TransportDocumentKind,
  TransportDocumentField[]
> = {
  house_bl: [
    block("shipper", "Shipper", "Parties"),
    block("forwardingAgent", "Forwarding agent", "Parties"),
    block("consignee", "Consignee", "Parties"),
    line("masterReference", "MBL / booking no.", "Parties"),
    block("notifyParty", "Notify party", "Parties"),
    block("deliveryAgent", "Port delivery agent", "Parties"),
    line("portOfLoading", "Port of loading", "Route"),
    line("portOfDischarge", "Port of discharge", "Route"),
    line("placeOfReceipt", "Place of receipt", "Route"),
    line("placeOfDelivery", "Final place of delivery", "Route"),
    line("vessel", "Vessel", "Route"),
    line("voyage", "Voyage", "Route"),
    block("containers", "Containers and seals (one per line)", "Cargo"),
    block(
      "goods",
      "Number and kind of packages, description of goods",
      "Cargo",
    ),
    line("grossWeight", "Gross weight (kg)", "Cargo"),
    line("measurement", "Measurement (CBM)", "Cargo"),
    line("freightTerms", "Freight (prepaid or collect)", "Terms"),
    line("containerStatus", "Container status (FCL/LCL)", "Terms"),
    line("shippedOnBoard", "Shipped on board date", "Terms"),
    line("placeAndDateOfIssue", "Place and date of issue", "Terms"),
    line("originals", "Number of original bills of lading", "Terms"),
    line("signatory", "Signed for the shipper by", "Terms"),
  ],
  house_awb: [
    block("shipper", "Shipper", "Parties"),
    block("forwardingAgent", "Forwarding agent", "Parties"),
    block("consignee", "Consignee", "Parties"),
    block("notifyParty", "Notify", "Parties"),
    line("masterAwb", "MAWB number", "Route"),
    line("agentCode", "Agent IATA code", "Route"),
    line("carrier", "Ship by (airline)", "Route"),
    line("airportOfDeparture", "Airport of departure", "Route"),
    line("airportOfDestination", "Airport of destination", "Route"),
    line("routing", "Routing and destination", "Route"),
    line("flightDate", "Flight / date", "Route"),
    line("currency", "Currency", "Charges"),
    line("airFreight", "Air freight", "Charges"),
    line("hawbFee", "HAWB fee", "Charges"),
    line("originFee", "Origin fee", "Charges"),
    line("totalFreight", "Total freight (prepaid or collect)", "Charges"),
    line("pieces", "No. of pieces", "Cargo"),
    line("grossWeight", "Gross weight (kg)", "Cargo"),
    line("chargeableWeight", "Chargeable weight", "Cargo"),
    line("rate", "Rate / charge", "Cargo"),
    block("goods", "Nature and quantity of goods, dimensions", "Cargo"),
    block("handlingInformation", "Handling information", "Terms"),
    line("dateAndPlaceOfDeparture", "Date and place of departure", "Terms"),
    line("issuingSignatory", "Signature of issuing carrier (name)", "Terms"),
  ],
  air_manifest: [
    line("masterAwb", "Master air waybill", "Reference"),
    line("houseAwb", "House air waybill", "Reference"),
    line("issueDate", "Issue date", "Reference"),
    line("carrierFlight", "Carrier / flight", "Reference"),
    line("route", "Route", "Reference"),
    block("shipper", "Shipper", "Parties"),
    block("hawbConsignee", "HAWB consignee", "Parties"),
    block("handlingAgent", "MAWB consignee / handling agent", "Parties"),
    block("forwardingAgent", "Forwarding agent", "Parties"),
    block("notifyParty", "Notify party", "Parties"),
    block("handlingInformation", "Handling information", "Parties"),
    block(
      "shipmentLines",
      "Shipment details (one house waybill per line: HAWB, packages, weights, volume, goods, origin)",
      "Cargo",
    ),
    line("departure", "Departure", "Cargo"),
    line("destination", "Destination", "Cargo"),
    line("cargoStatus", "Cargo status", "Cargo"),
    line("preparedBy", "Prepared by", "Cargo"),
  ],
};

/** Which documents belong to which service line. */
export function transportDocumentKindsFor(
  serviceLine: ServiceLine,
): TransportDocumentKind[] {
  if (serviceLine.startsWith("sea")) return ["house_bl"];
  if (serviceLine.startsWith("air")) return ["house_awb", "air_manifest"];
  return [];
}

export const transportDocumentCreateSchema = z.object(
  {
    kind: z.enum(transportDocumentKinds, {
      error: `kind must be one of ${transportDocumentKinds.join(", ")}`,
    }),
    documentNumber: optionalText("documentNumber", 80),
    fields: z
      .record(z.string(), z.string({ error: "field values must be text" }), {
        error: "fields must be an object",
      })
      .nullish()
      .transform((value) => value ?? {}),
  },
  objectError("A document object is required"),
);
export type TransportDocumentCreate = z.infer<
  typeof transportDocumentCreateSchema
>;

export const transportDocumentUpdateSchema = z.object(
  {
    documentNumber: optionalText("documentNumber", 80),
    fields: z
      .record(z.string(), z.string({ error: "field values must be text" }), {
        error: "fields must be an object",
      })
      .nullish()
      .transform((value) => value ?? {}),
  },
  objectError("A document object is required"),
);
export type TransportDocumentUpdate = z.infer<
  typeof transportDocumentUpdateSchema
>;

/**
 * Checks the fields of one document: only known fields, trimmed, empty ones
 * dropped, single-line fields up to 300 characters and blocks up to 2000.
 */
export function cleanTransportDocumentFields(
  kind: TransportDocumentKind,
  fields: Record<string, string>,
):
  | { success: true; data: Record<string, string> }
  | {
      success: false;
      message: string;
    } {
  const known = new Map(
    transportDocumentFields[kind].map((field) => [field.key, field]),
  );
  const cleaned: Record<string, string> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const field = known.get(key);
    if (!field) {
      return {
        success: false,
        message: `${key} is not a field of this document`,
      };
    }
    const value = raw.trim();
    const limit = field.multiline ? 2000 : 300;
    if (value.length > limit) {
      return {
        success: false,
        message: `${field.label} must be at most ${limit} characters`,
      };
    }
    if (value) cleaned[key] = value;
  }
  return { success: true, data: cleaned };
}

/** Leads: prospects being won. Stages are deliberately few and in sales order. */
export const leadStageKeys = [
  "new",
  "contacted",
  "quoted",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof leadStageKeys)[number];

export const leadSourceKeys = [
  "quote_request",
  "referral",
  "walk_in",
  "phone",
  "email",
  "other",
] as const;
export type LeadSource = (typeof leadSourceKeys)[number];

const leadDateField = (field: string) =>
  z
    .string({ error: `${field} must be a date such as 2026-10-31` })
    .refine(
      (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)),
      { error: `${field} must be a date such as 2026-10-31` },
    )
    .nullish()
    .transform((value) => value ?? null);

const leadEmailField = z
  .string({ error: "email must be text" })
  .transform((value) => value.trim())
  .refine((value) => value === "" || EMAIL_PATTERN.test(value), {
    error: "email must be a valid email address",
  })
  .nullish()
  .transform((value) => value || null);

export const leadCreateInputSchema = z.object(
  {
    companyName: requiredText("companyName", 160),
    contactName: optionalText("contactName", 160),
    email: leadEmailField,
    phone: phoneField,
    source: z
      .enum(leadSourceKeys, { error: "source is not a supported lead source" })
      .default("other"),
    notes: optionalText("notes", 2000),
    nextFollowUp: leadDateField("nextFollowUp"),
    quoteRequestId: uuidField("quoteRequestId")
      .nullish()
      .transform((value) => value ?? null),
  },
  objectError("A lead object is required"),
);
export type LeadCreateInput = z.infer<typeof leadCreateInputSchema>;

/** Any subset of fields. `owner: "me"` takes the lead; `owner: null` releases it. */
export const leadUpdateInputSchema = z
  .object(
    {
      companyName: requiredText("companyName", 160),
      contactName: optionalText("contactName", 160),
      email: leadEmailField,
      phone: phoneField,
      notes: optionalText("notes", 2000),
      nextFollowUp: leadDateField("nextFollowUp"),
      stage: z.enum(leadStageKeys, { error: "stage is not a supported stage" }),
      lostReason: optionalText("lostReason", 500),
      customerCompanyId: uuidField("customerCompanyId"),
      owner: z
        .literal("me", { error: 'owner must be "me" or null' })
        .nullable(),
    },
    objectError("A lead update object is required"),
  )
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    error: "At least one lead field must be provided",
  });
export type LeadUpdateInput = z.infer<typeof leadUpdateInputSchema>;
