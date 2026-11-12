import type { LeadStage, ServiceLine } from "@bjh/contracts";
import type {
  JobFinanceRecord,
  JobListRecord,
  JobTaskRecord,
  LeadRecord,
  OutstandingInvoiceRecord,
  ReportDeliveryRecord,
  ReportInvoiceRecord,
  ReportPaymentRecord,
  ReportStockMovementRecord,
  SalesServiceReportRecord,
  StockBalanceRecord,
} from "../database/database.port";
import { formatInvoiceAmount } from "../finance/invoice-pdf";
import { methodLabels } from "../finance/receipt-pdf";
import type { ReportColumn, ReportDocument } from "./report-pdf";

/** The reports a rep can download; the last three carry money and are for finance. */
export const reportTypes = [
  "sales-pipeline",
  "quotes-requests",
  "shipment-status",
  "job-activity",
  "delays-tasks",
  "deliveries",
  "warehouse-inventory",
  "invoices-payments",
  "receivables-ageing",
  "job-margin",
] as const;
export type ReportType = (typeof reportTypes)[number];
export const financeReportTypes: readonly ReportType[] = [
  "invoices-payments",
  "receivables-ageing",
  "job-margin",
];

const serviceLabels: Record<string, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};
const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  ready_to_close: "Ready to close",
  closed: "Closed",
  cancelled: "Cancelled",
};
const stageLabels: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
const sourceLabels: Record<string, string> = {
  quote_request: "Quote request",
  referral: "Referral",
  walk_in: "Walk-in",
  phone: "Phone",
  email: "Email",
  other: "Other",
  campaign: "Campaign",
};
const requestSourceLabels: Record<string, string> = {
  portal: "Client portal",
  staff: "Entered by staff",
  email: "Email",
  website: "Website form",
  earlier: "Earlier requests",
};
const taskKindLabels: Record<string, string> = {
  task: "Task",
  missing_documents: "Missing documents",
  damage: "Damage",
  delay: "Delay",
  other: "Other",
};

const isFinished = (status: string) =>
  status === "closed" || status === "cancelled";

const day = (value: string | null | undefined): string =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Africa/Accra",
      }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value))
    : "-";
const inRange = (value: string | null | undefined, from: string, to: string) =>
  !!value && value.slice(0, 10) >= from && value.slice(0, 10) <= to;
const daysBetween = (later: string, earlier: string) =>
  Math.round(
    (Date.parse(`${later.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "-";
const period = (from: string, to: string) =>
  `Period: ${day(from)} to ${day(to)}`;
const money = formatInvoiceAmount;
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
const roleLabel = (role: string) =>
  role.charAt(0).toUpperCase() + role.slice(1).replaceAll("_", " ");
const countBy = <T>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts];
};
const left = (header: string, width: number): ReportColumn => ({
  header,
  width,
});
const right = (header: string, width: number): ReportColumn => ({
  header,
  width,
  align: "right",
});

export function salesPipelineDocument(input: {
  from: string;
  to: string;
  today: string;
  sales: Pick<
    SalesServiceReportRecord,
    "newLeads" | "leadsBySource" | "leadsByCampaign" | "pipeline"
  > & { converted: number; convertedCompanies: string[] };
  leads: LeadRecord[];
}): ReportDocument {
  const { from, to, today, sales, leads } = input;
  const open = leads.filter(
    (lead) => lead.stage !== "won" && lead.stage !== "lost",
  );
  const due = open
    .filter((lead) => lead.nextFollowUp && lead.nextFollowUp <= today)
    .sort((a, b) => a.nextFollowUp!.localeCompare(b.nextFollowUp!));
  const logged = leads
    .filter((lead) => inRange(lead.createdAt, from, to))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    title: "Sales pipeline and conversions",
    subtitle: period(from, to),
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: [
          { label: "New leads", value: String(sales.newLeads) },
          {
            label: "Converted clients",
            value: String(sales.converted),
            note: "First accepted quote",
          },
          {
            label: "Conversion",
            value: percent(sales.converted, sales.newLeads),
            note: "Converted per new lead",
          },
          { label: "Open leads", value: String(open.length), note: "Today" },
          {
            label: "Follow-ups due",
            value: String(due.length),
            note: "Due today or overdue",
          },
        ],
      },
      { kind: "heading", text: "Where new leads came from" },
      {
        kind: "bars",
        rows: Object.entries(sales.leadsBySource).map(([key, value]) => [
          sourceLabels[key] ?? key,
          value,
        ]),
        empty: "No leads were logged in these dates.",
      },
      { kind: "heading", text: "Leads from campaigns" },
      {
        kind: "table",
        columns: [
          left("Campaign", 4),
          right("New leads", 1.5),
          right("Won so far", 1.5),
        ],
        rows: sales.leadsByCampaign.map((entry) => [
          entry.campaign,
          String(entry.newLeads),
          String(entry.won),
        ]),
        empty: "No leads came from a campaign in these dates.",
      },
      { kind: "heading", text: "Pipeline today" },
      {
        kind: "bars",
        rows: Object.entries(sales.pipeline).map(([key, value]) => [
          stageLabels[key as LeadStage] ?? key,
          value,
        ]),
        empty: "There are no leads yet.",
      },
      ...(sales.convertedCompanies.length > 0
        ? [
            {
              kind: "note" as const,
              text: `Clients converted in these dates: ${sales.convertedCompanies.join(", ")}.`,
            },
          ]
        : []),
      { kind: "heading", text: "Follow-ups due or overdue" },
      {
        kind: "table",
        columns: [
          left("Company", 3),
          left("Contact", 2),
          left("Stage", 1.2),
          left("Owner", 2),
          left("Follow-up due", 1.5),
        ],
        rows: due.map((lead) => [
          lead.companyName,
          lead.contactName ?? "-",
          stageLabels[lead.stage],
          lead.ownerName ?? "Unassigned",
          day(lead.nextFollowUp),
        ]),
        empty: "No follow-up is due.",
      },
      { kind: "heading", text: "Leads logged in the period" },
      {
        kind: "table",
        columns: [
          left("Company", 3),
          left("Contact", 2),
          left("Source", 2.5),
          left("Stage", 1.2),
          left("Owner", 2),
          left("Logged", 1.3),
        ],
        rows: logged.map((lead) => [
          lead.companyName,
          lead.contactName ?? "-",
          // A lead from a campaign says which one (or that it was deleted).
          lead.source === "campaign"
            ? `Campaign: ${lead.campaignName ?? "deleted"}`
            : (sourceLabels[lead.source] ?? lead.source),
          stageLabels[lead.stage],
          lead.ownerName ?? "Unassigned",
          day(lead.createdAt),
        ]),
        empty: "No leads were logged in these dates.",
      },
    ],
  };
}

export function quotesRequestsDocument(input: {
  from: string;
  to: string;
  service: SalesServiceReportRecord;
}): ReportDocument {
  const { from, to, service } = input;
  const requests = Object.values(service.requestsBySource).reduce(
    (sum, value) => sum + value,
    0,
  );
  const decided = service.quotesAccepted + service.quotesRejected;
  const hours = service.medianHoursToQuote;
  return {
    title: "Quote requests and quotes",
    subtitle: period(from, to),
    orientation: "portrait",
    blocks: [
      {
        kind: "kpis",
        items: [
          { label: "Quote requests", value: String(requests) },
          { label: "Quotes issued", value: String(service.quotesIssued) },
          {
            label: "Accepted · rejected",
            value: `${service.quotesAccepted} · ${service.quotesRejected}`,
            note: `Win rate ${percent(service.quotesAccepted, decided)}`,
          },
          {
            label: "Time to first quote",
            value:
              hours === null
                ? "-"
                : hours < 48
                  ? `${hours} h`
                  : `${Math.round(hours / 24)} days`,
            note: "Typical (median)",
          },
          {
            label: "Waiting for a quote",
            value: String(service.waitingForQuote),
            note: "Today",
          },
          {
            label: "Inquiries answered",
            value: `${service.inquiriesAnswered} of ${service.inquiries}`,
          },
        ],
      },
      { kind: "heading", text: "Quote requests by channel" },
      {
        kind: "bars",
        rows: Object.entries(service.requestsBySource).map(([key, value]) => [
          requestSourceLabels[key] ?? key,
          value,
        ]),
        empty: "No quote requests came in during these dates.",
      },
      {
        kind: "note",
        text: "Win rate is quotes accepted out of quotes accepted or rejected; quotes still open are not counted. Time to first quote runs from the request arriving to its first issued quote.",
      },
    ],
  };
}

export interface ShipmentStatusRow {
  job: JobListRecord;
  /** House and master B/L or AWB numbers, house first. */
  billNumbers: string[];
  /** The latest step recorded on an open job. */
  lastStep: { label: string; at: string } | null;
}

/**
 * The client-report fields of a job (goods, a status remark, the expected finish
 * date; migration 20261104000300). A release without them has no such
 * properties at all, so they are read defensively and their columns appear only
 * once jobs carry them.
 */
type ClientReportFields = {
  goodsDescription?: string | null;
  remarks?: string | null;
  expectedCompletionDate?: string | null;
};
const clientFields = (job: JobListRecord) =>
  job as JobListRecord & ClientReportFields;

/**
 * Open jobs as of today, then the jobs completed in the period, in the columns
 * the reps' own updates use: B/L or AWB number, goods, vessel or flight, port of
 * discharge, expected arrival, status or remark, completion date. For one
 * customer it is the update the rep sends them; for all, the desk's overview.
 */
export function shipmentStatusDocument(input: {
  from: string;
  to: string;
  today: string;
  serviceLine: ServiceLine | null;
  /** Set when the update is for one customer. */
  customerName: string | null;
  open: ShipmentStatusRow[];
  /** How many open jobs there are when the list was cut short. */
  totalOpen: number;
  completed: ShipmentStatusRow[];
  /** How many jobs were completed in the period when the list was cut short. */
  totalCompleted: number;
}): ReportDocument {
  const { from, to, today, serviceLine, customerName } = input;
  const weekAhead = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const open = [...input.open].sort((a, b) => {
    const x = a.job.currentEtaAt?.slice(0, 10) ?? "9999-99-99";
    const y = b.job.currentEtaAt?.slice(0, 10) ?? "9999-99-99";
    return (
      x.localeCompare(y) || a.job.fileNumber.localeCompare(b.job.fileNumber)
    );
  });
  const completed = [...input.completed].sort((a, b) =>
    (b.job.closedAt ?? "").localeCompare(a.job.closedAt ?? ""),
  );
  const tracked = open.filter(({ job }) =>
    ["sea_import", "sea_export", "air_import", "air_export"].includes(
      job.serviceLine,
    ),
  );
  const eta = (row: ShipmentStatusRow) => row.job.currentEtaAt?.slice(0, 10);

  // The customer is in the title, and the service is in the subtitle, when
  // the update is for one; the columns say them only when they vary.
  const hasClientFields = [...input.open, ...input.completed].some(
    ({ job }) => "goodsDescription" in job,
  );
  /** A completed job always has a date to show; an open one only once it carries an expected finish. */
  const columnsFor = (done: boolean): ReportColumn[] => [
    left("Job", 2.4),
    ...(customerName ? [] : [left("Customer", 2)]),
    ...(serviceLine ? [] : [left("Service", 1.4)]),
    left("BL / AWB", 2),
    ...(hasClientFields ? [left("Description of goods", 2.3)] : []),
    left("Vessel / flight", 1.8),
    left("Port of discharge", 1.4),
    left("ETA", 1.3),
    left("Status / remarks", 2.7),
    ...(done || hasClientFields ? [left("Completion date", 1.7)] : []),
  ];
  const line = (
    row: ShipmentStatusRow,
    done: boolean,
    status: string,
    completion: string | null | undefined,
  ) => [
    row.job.fileNumber,
    ...(customerName ? [] : [row.job.customerCompanyName]),
    ...(serviceLine
      ? []
      : [serviceLabels[row.job.serviceLine] ?? row.job.serviceLine]),
    row.billNumbers.join("\n") || "-",
    ...(hasClientFields ? [clientFields(row.job).goodsDescription ?? "-"] : []),
    row.job.vessel ?? "-",
    row.job.portOfDischarge ?? "-",
    day(row.job.currentEtaAt),
    status,
    ...(done || hasClientFields ? [day(completion)] : []),
  ];
  const openStatus = ({ job, lastStep }: ShipmentStatusRow) => {
    const remark = clientFields(job).remarks?.trim();
    return [
      remark,
      // A plain open job needs no label once a remark says more.
      !remark || !["open", "in_progress"].includes(job.status)
        ? (statusLabels[job.status] ?? job.status)
        : null,
      lastStep ? `Last step: ${lastStep.label}, ${day(lastStep.at)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  };

  return {
    title: customerName
      ? `Shipment status update: ${customerName}`
      : "Shipment status update",
    subtitle: `Open jobs as of ${day(today)} · completed jobs ${day(from)} to ${day(to)} · ${serviceLine ? serviceLabels[serviceLine] : "All services"}`,
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: [
          { label: "Open jobs", value: String(input.totalOpen) },
          {
            label: "Arriving in 7 days",
            value: String(
              tracked.filter(
                (row) =>
                  eta(row) && eta(row)! >= today && eta(row)! <= weekAhead,
              ).length,
            ),
          },
          {
            label: "Expected date passed",
            value: String(
              tracked.filter((row) => eta(row) && eta(row)! < today).length,
            ),
            note: "Not yet closed",
          },
          {
            label: "No expected date",
            value: String(tracked.filter((row) => !eta(row)).length),
            note: "Sea and air jobs",
          },
          { label: "Completed", value: String(input.totalCompleted) },
        ],
      },
      { kind: "heading", text: "Open jobs" },
      {
        kind: "table",
        columns: columnsFor(false),
        rows: open.map((row) =>
          line(
            row,
            false,
            openStatus(row),
            clientFields(row.job).expectedCompletionDate,
          ),
        ),
        empty: "There are no open jobs.",
      },
      ...(open.length < input.totalOpen
        ? [
            {
              kind: "note" as const,
              text: `Showing the ${open.length} jobs with the earliest expected dates of ${input.totalOpen} open jobs.`,
            },
          ]
        : []),
      { kind: "heading", text: "Completed jobs" },
      {
        kind: "table",
        columns: columnsFor(true),
        rows: completed.map((row) =>
          line(
            row,
            true,
            clientFields(row.job).remarks?.trim() || "Completed",
            row.job.closedAt,
          ),
        ),
        empty: "No job was completed in these dates.",
      },
      ...(completed.length < input.totalCompleted
        ? [
            {
              kind: "note" as const,
              text: `Showing the ${completed.length} most recent of ${input.totalCompleted} completed jobs.`,
            },
          ]
        : []),
      ...(hasClientFields
        ? [
            {
              kind: "note" as const,
              text: "For an open job the completion date is when staff expect it to finish; for a completed job it is the day it closed.",
            },
          ]
        : []),
    ],
  };
}

export function jobActivityDocument(input: {
  from: string;
  to: string;
  jobs: JobListRecord[];
}): ReportDocument {
  const { from, to, jobs } = input;
  const opened = jobs.filter((job) => inRange(job.openedAt, from, to));
  const closed = jobs.filter(
    (job) => job.status === "closed" && inRange(job.closedAt, from, to),
  );
  const open = jobs.filter((job) => !isFinished(job.status));
  const spans = closed.map((job) => daysBetween(job.closedAt!, job.openedAt));
  const average = spans.length
    ? Math.round(spans.reduce((sum, value) => sum + value, 0) / spans.length)
    : null;
  const lines = Object.keys(serviceLabels);
  const customers = [
    ...new Set([...opened, ...closed].map((job) => job.customerCompanyName)),
  ].sort((a, b) => a.localeCompare(b));
  const activity = [
    ...opened.map((job) => ({ job, what: "Opened", at: job.openedAt })),
    ...closed.map((job) => ({ job, what: "Closed", at: job.closedAt! })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return {
    title: "Jobs opened and closed",
    subtitle: period(from, to),
    orientation: "portrait",
    blocks: [
      {
        kind: "kpis",
        items: [
          { label: "Jobs opened", value: String(opened.length) },
          { label: "Jobs closed", value: String(closed.length) },
          { label: "Open now", value: String(open.length), note: "Today" },
          {
            label: "Time to close",
            value:
              average === null
                ? "-"
                : `${average} ${average === 1 ? "day" : "days"}`,
            note: "Average, closed jobs",
          },
        ],
      },
      { kind: "heading", text: "By service" },
      {
        kind: "table",
        columns: [
          left("Service", 3),
          right("Opened", 1),
          right("Closed", 1),
          right("Open now", 1),
        ],
        rows: lines.map((line) => [
          serviceLabels[line],
          String(opened.filter((job) => job.serviceLine === line).length),
          String(closed.filter((job) => job.serviceLine === line).length),
          String(open.filter((job) => job.serviceLine === line).length),
        ]),
        total: [
          "All services",
          String(opened.length),
          String(closed.length),
          String(open.length),
        ],
        empty: "",
      },
      { kind: "heading", text: "By customer" },
      {
        kind: "table",
        columns: [left("Customer", 4), right("Opened", 1), right("Closed", 1)],
        rows: customers.map((name) => [
          name,
          String(
            opened.filter((job) => job.customerCompanyName === name).length,
          ),
          String(
            closed.filter((job) => job.customerCompanyName === name).length,
          ),
        ]),
        empty: "No job was opened or closed in these dates.",
      },
      { kind: "heading", text: "Job list" },
      {
        kind: "table",
        columns: [
          left("Job", 1.6),
          left("Customer", 3),
          left("Service", 1.6),
          left("Activity", 1.1),
          left("Date", 1.4),
          left("Status now", 1.3),
        ],
        rows: activity.map(({ job, what, at }) => [
          job.fileNumber,
          job.customerCompanyName,
          serviceLabels[job.serviceLine] ?? job.serviceLine,
          what,
          day(at),
          statusLabels[job.status] ?? job.status,
        ]),
        empty: "No job was opened or closed in these dates.",
      },
    ],
  };
}

export function delaysTasksDocument(input: {
  today: string;
  tasks: JobTaskRecord[];
  jobs: JobListRecord[];
}): ReportDocument {
  const { today, tasks, jobs } = input;
  const overdue = tasks
    .filter((task) => task.dueDate !== null && task.dueDate < today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const exceptions = tasks.filter((task) =>
    ["delay", "damage", "missing_documents"].includes(task.kind),
  );
  const onHold = jobs.filter((job) => job.status === "on_hold");
  const taskRow = (task: JobTaskRecord) => [
    task.fileNumber,
    task.customerCompanyName,
    task.title,
    taskKindLabels[task.kind] ?? task.kind,
    roleLabel(task.assignedRole),
    day(task.dueDate),
  ];
  const columns = [
    left("Job", 1.4),
    left("Customer", 2.4),
    left("Task", 3),
    left("Type", 1.5),
    left("Assigned to", 1.6),
    left("Due", 1.2),
  ];
  return {
    title: "Delays, exceptions and overdue tasks",
    subtitle: `Open work as of ${day(today)}`,
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: [
          { label: "Open tasks", value: String(tasks.length) },
          { label: "Overdue tasks", value: String(overdue.length) },
          {
            label: "Delays and exceptions",
            value: String(exceptions.length),
            note: "Delay, damage, missing documents",
          },
          { label: "Jobs on hold", value: String(onHold.length) },
        ],
      },
      { kind: "heading", text: "Open tasks by team" },
      {
        kind: "bars",
        rows: countBy(tasks, (task) => roleLabel(task.assignedRole)),
        empty: "There are no open tasks.",
      },
      { kind: "heading", text: "Overdue tasks" },
      {
        kind: "table",
        columns,
        rows: overdue.map(taskRow),
        empty: "No task is overdue.",
      },
      { kind: "heading", text: "Delays, damage and missing documents" },
      {
        kind: "table",
        columns,
        rows: exceptions.map(taskRow),
        empty: "No delay or exception is open.",
      },
      { kind: "heading", text: "Jobs on hold" },
      {
        kind: "table",
        columns: [
          left("Job", 1.4),
          left("Customer", 3),
          left("Service", 1.6),
          left("Opened", 1.3),
        ],
        rows: onHold.map((job) => [
          job.fileNumber,
          job.customerCompanyName,
          serviceLabels[job.serviceLine] ?? job.serviceLine,
          day(job.openedAt),
        ]),
        empty: "No job is on hold.",
      },
    ],
  };
}

export function deliveriesDocument(input: {
  from: string;
  to: string;
  today: string;
  deliveries: ReportDeliveryRecord[];
}): ReportDocument {
  const { from, to, today, deliveries } = input;
  const dispatched = deliveries.filter(({ delivery }) =>
    inRange(delivery.dispatchedAt, from, to),
  );
  const delivered = deliveries.filter(({ delivery }) =>
    inRange(delivery.deliveredAt, from, to),
  );
  const onTheWay = deliveries.filter(
    ({ delivery }) => delivery.status === "dispatched",
  );
  const slow = onTheWay.filter(
    ({ delivery }) => daysBetween(today, delivery.dispatchedAt) > 3,
  );
  const sorted = [...deliveries].sort((a, b) =>
    a.delivery.dispatchedAt.localeCompare(b.delivery.dispatchedAt),
  );
  return {
    title: "Deliveries and transport",
    subtitle: `${period(from, to)} · deliveries still on the way are shown as of ${day(today)}`,
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: [
          { label: "Dispatched", value: String(dispatched.length) },
          { label: "Delivered", value: String(delivered.length) },
          { label: "On the way now", value: String(onTheWay.length) },
          {
            label: "On the way over 3 days",
            value: String(slow.length),
            note: "Worth a call to the driver",
          },
        ],
      },
      {
        kind: "table",
        columns: [
          left("Waybill", 1.8),
          left("Job / customer", 2.6),
          left("Dispatched", 1.3),
          left("Delivered to", 2.6),
          left("Driver / vehicle", 2.2),
          left("Status", 2.4),
        ],
        rows: sorted.map(({ fileNumber, customerCompanyName, delivery }) => [
          delivery.waybillNumber,
          `${fileNumber}\n${customerCompanyName}`,
          day(delivery.dispatchedAt),
          delivery.deliveryAddress,
          `${delivery.driverName}\n${delivery.vehicleRegistration}`,
          delivery.status === "delivered"
            ? `Delivered ${day(delivery.deliveredAt)}${delivery.receiverName ? `\nReceived by ${delivery.receiverName}` : ""}${delivery.damageNotes ? `\nDamage: ${delivery.damageNotes}` : ""}`
            : `On the way since ${day(delivery.dispatchedAt)}`,
        ]),
        empty: "No delivery was dispatched or completed in these dates.",
      },
    ],
  };
}

export function warehouseInventoryDocument(input: {
  from: string;
  to: string;
  balances: StockBalanceRecord[];
  movements: ReportStockMovementRecord[];
}): ReportDocument {
  const { from, to, balances, movements } = input;
  const customers = new Set(balances.map((row) => row.customerCompanyName));
  const received = movements.filter(
    ({ movement }) => movement.kind === "receipt",
  );
  const released = movements.filter(
    ({ movement }) => movement.kind === "release",
  );
  const stock = [...balances].sort(
    (a, b) =>
      a.customerCompanyName.localeCompare(b.customerCompanyName) ||
      a.fileNumber.localeCompare(b.fileNumber) ||
      a.item.localeCompare(b.item),
  );
  return {
    title: "Warehouse inventory report",
    subtitle: `${period(from, to)} · stock on hand at the end of ${day(to)}`,
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: [
          { label: "Stock lines on hand", value: String(balances.length) },
          { label: "Customers storing goods", value: String(customers.size) },
          { label: "Receipts in the period", value: String(received.length) },
          { label: "Releases in the period", value: String(released.length) },
        ],
      },
      { kind: "heading", text: `Stock on hand at the end of ${day(to)}` },
      {
        kind: "table",
        columns: [
          left("Customer", 3),
          left("Job", 1.5),
          left("Location", 2),
          left("Item", 3),
          left("Unit", 1.2),
          right("On hand", 1.2),
        ],
        rows: stock.map((row) => [
          row.customerCompanyName,
          row.fileNumber,
          row.locationName,
          row.item,
          row.unit,
          String(row.balance),
        ]),
        empty: "No goods were in the warehouse at the end of this period.",
      },
      { kind: "heading", text: "Goods received and released" },
      {
        kind: "table",
        columns: [
          left("Date", 1.3),
          left("Customer / job", 3),
          left("Location", 2),
          left("Item", 3),
          left("Movement", 1.2),
          right("Quantity", 1.1),
          left("Unit", 1),
          left("Reference", 1.8),
        ],
        rows: movements.map(({ fileNumber, customerCompanyName, movement }) => [
          day(movement.occurredAt),
          `${customerCompanyName}\n${fileNumber}`,
          movement.locationName,
          movement.item,
          movement.kind === "receipt" ? "Received" : "Released",
          String(movement.quantity),
          movement.unit,
          movement.reference ?? "-",
        ]),
        empty: "No goods were received or released in these dates.",
      },
    ],
  };
}

export function invoicesPaymentsDocument(input: {
  from: string;
  to: string;
  invoices: ReportInvoiceRecord[];
  payments: ReportPaymentRecord[];
}): ReportDocument {
  const { from, to } = input;
  const invoices = input.invoices.filter(
    ({ invoice }) => invoice.status === "issued",
  );
  const payments = input.payments.filter(({ payment }) => !payment.reversal);
  const currencies = [
    ...new Set([
      ...invoices.map(({ invoice }) => invoice.currency),
      ...payments.map(({ currency }) => currency),
    ]),
  ].sort();
  const invoiced = (currency: string) =>
    invoices.filter(({ invoice }) => invoice.currency === currency);
  const received = (currency: string) =>
    payments.filter((row) => row.currency === currency);
  const sumInvoices = (rows: ReportInvoiceRecord[]) =>
    rows.reduce((sum, { invoice }) => sum + invoice.totalMinor, 0);
  const sumPayments = (rows: ReportPaymentRecord[]) =>
    rows.reduce((sum, { payment }) => sum + payment.amountMinor, 0);
  const customers = [
    ...new Set([
      ...invoices.map((row) => row.customerCompanyName),
      ...payments.map((row) => row.customerCompanyName),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const byCustomer = customers.flatMap((name) =>
    currencies.flatMap((currency) => {
      const billed = sumInvoices(
        invoiced(currency).filter((row) => row.customerCompanyName === name),
      );
      const paid = sumPayments(
        received(currency).filter((row) => row.customerCompanyName === name),
      );
      return billed || paid
        ? [[name, currency, money(billed, currency), money(paid, currency)]]
        : [];
    }),
  );
  return {
    title: "Invoices and payments",
    subtitle: `${period(from, to)} · invoices by issue date, payments by date received`,
    orientation: "landscape",
    blocks: [
      {
        kind: "table",
        columns: [
          left("Currency", 1.5),
          right("Invoices issued", 1.5),
          right("Invoiced", 2),
          right("Payments received", 1.5),
          right("Received", 2),
        ],
        rows: currencies.map((currency) => [
          currency,
          String(invoiced(currency).length),
          money(sumInvoices(invoiced(currency)), currency),
          String(received(currency).length),
          money(sumPayments(received(currency)), currency),
        ]),
        empty:
          "No invoice was issued and no payment was received in these dates.",
      },
      { kind: "heading", text: "By customer" },
      {
        kind: "table",
        columns: [
          left("Customer", 4),
          left("Currency", 1.2),
          right("Invoiced", 2),
          right("Received", 2),
        ],
        rows: byCustomer,
        empty: "Nothing to show for these dates.",
      },
      { kind: "heading", text: "Invoices issued" },
      {
        kind: "table",
        columns: [
          left("Invoice", 1.8),
          left("Job", 1.5),
          left("Customer", 3.5),
          left("Issued", 1.3),
          left("Due", 1.3),
          right("Amount", 1.8),
        ],
        rows: invoices.map(({ fileNumber, customerCompanyName, invoice }) => [
          invoice.invoiceNumber ?? "-",
          fileNumber ?? "-",
          customerCompanyName,
          day(invoice.issuedAt),
          day(invoice.dueDate),
          money(invoice.totalMinor, invoice.currency),
        ]),
        empty: "No invoice was issued in these dates.",
      },
      { kind: "heading", text: "Payments received" },
      {
        kind: "table",
        columns: [
          left("Receipt", 1.8),
          left("Invoice / job", 2),
          left("Customer", 3.2),
          left("Received", 1.3),
          left("Method", 1.4),
          right("Amount", 1.8),
        ],
        rows: payments.map(
          ({
            fileNumber,
            customerCompanyName,
            invoiceNumber,
            currency,
            payment,
          }) => [
            payment.receiptNumber ?? "-",
            `${invoiceNumber}\n${fileNumber ?? "No job"}`,
            customerCompanyName,
            day(payment.receivedOn),
            methodLabels[payment.method],
            money(payment.amountMinor, currency),
          ],
        ),
        empty: "No payment was received in these dates.",
      },
      {
        kind: "note",
        text: "Reversed payments and voided or draft invoices are left out.",
      },
    ],
  };
}

const ageBuckets = [
  "Not yet due",
  "1 to 30 days",
  "31 to 60 days",
  "61 to 90 days",
  "Over 90 days",
] as const;

/** Which column an invoice's balance falls in, by days past its due date. */
export function ageBucket(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  const late = daysBetween(today, dueDate);
  if (late <= 0) return 0;
  if (late <= 30) return 1;
  if (late <= 60) return 2;
  if (late <= 90) return 3;
  return 4;
}

export function receivablesDocument(input: {
  today: string;
  outstanding: OutstandingInvoiceRecord[];
}): ReportDocument {
  const { today, outstanding } = input;
  const currencies = [
    ...new Set(outstanding.map((row) => row.currency)),
  ].sort();
  const noDueDate = outstanding.filter((row) => !row.dueDate).length;
  const overdue = (row: OutstandingInvoiceRecord) =>
    ageBucket(row.dueDate, today) > 0;
  return {
    title: "Receivables ageing",
    subtitle: `Money owed on issued invoices as of ${day(today)}, by days past the due date`,
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: currencies.flatMap((currency) => {
          const rows = outstanding.filter((row) => row.currency === currency);
          const late = rows.filter(overdue);
          return [
            {
              label: `Owing (${currency})`,
              value: money(
                rows.reduce((sum, row) => sum + row.outstandingMinor, 0),
                currency,
              ),
              note: plural(rows.length, "invoice"),
            },
            {
              label: `Overdue (${currency})`,
              value: money(
                late.reduce((sum, row) => sum + row.outstandingMinor, 0),
                currency,
              ),
              note: plural(late.length, "invoice"),
            },
          ];
        }),
      },
      ...(currencies.length === 0
        ? [
            {
              kind: "note" as const,
              text: "Nothing is owed on any issued invoice.",
            },
          ]
        : []),
      ...currencies.flatMap((currency) => {
        const rows = outstanding.filter((row) => row.currency === currency);
        const customers = [
          ...new Set(rows.map((row) => row.customerCompanyName)),
        ].sort((a, b) => a.localeCompare(b));
        const totals = ageBuckets.map(() => 0);
        const lines = customers.map((name) => {
          const cells = ageBuckets.map(() => 0);
          for (const row of rows.filter(
            (item) => item.customerCompanyName === name,
          )) {
            cells[ageBucket(row.dueDate, today)] += row.outstandingMinor;
          }
          cells.forEach((value, index) => (totals[index] += value));
          return [
            name,
            ...cells.map((value) => (value ? money(value, currency) : "-")),
            money(
              cells.reduce((sum, value) => sum + value, 0),
              currency,
            ),
          ];
        });
        return [
          {
            kind: "heading" as const,
            text: `Ageing by customer (${currency})`,
          },
          {
            kind: "table" as const,
            columns: [
              left("Customer", 3),
              ...ageBuckets.map((bucket) => right(bucket, 1.7)),
              right("Total owing", 1.8),
            ],
            rows: lines,
            total: [
              "Total",
              ...totals.map((value) => (value ? money(value, currency) : "-")),
              money(
                totals.reduce((sum, value) => sum + value, 0),
                currency,
              ),
            ],
            empty: "",
          },
        ];
      }),
      { kind: "heading", text: "Overdue invoices, oldest first" },
      {
        kind: "table",
        columns: [
          left("Invoice", 1.8),
          left("Job", 1.5),
          left("Customer", 3.5),
          left("Due", 1.3),
          right("Days overdue", 1.3),
          right("Owing", 2),
        ],
        rows: outstanding
          .filter(overdue)
          .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
          .map((row) => [
            row.invoiceNumber,
            row.fileNumber ?? "-",
            row.customerCompanyName,
            day(row.dueDate),
            String(daysBetween(today, row.dueDate!)),
            money(row.outstandingMinor, row.currency),
          ]),
        empty: "No invoice is past its due date.",
      },
      ...(noDueDate > 0
        ? [
            {
              kind: "note" as const,
              text: `${noDueDate} invoice${noDueDate === 1 ? " has" : "s have"} no due date and ${noDueDate === 1 ? "is" : "are"} counted as not yet due.`,
            },
          ]
        : []),
    ],
  };
}

export function jobMarginDocument(input: {
  from: string;
  to: string;
  finance: JobFinanceRecord[];
  jobs: JobListRecord[];
}): ReportDocument {
  const { from, to, finance, jobs } = input;
  const opened = new Map(
    jobs
      .filter((job) => inRange(job.openedAt, from, to))
      .map((job) => [job.id, job]),
  );
  const rows = finance
    .filter((row) => opened.has(row.jobId))
    .sort((a, b) => a.fileNumber.localeCompare(b.fileNumber));
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  // A margin needs both sides: the same rule as the Finance page.
  const marginOf = (row: JobFinanceRecord) =>
    row.invoicedMinor > 0 && row.costMinor > 0
      ? row.invoicedMinor - row.costMinor
      : null;
  return {
    title: "Job costs and margin",
    subtitle: `Jobs opened ${day(from)} to ${day(to)}, with everything invoiced and spent on them so far`,
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: currencies.flatMap((currency) => {
          const mine = rows.filter((row) => row.currency === currency);
          const comparable = mine.filter((row) => marginOf(row) !== null);
          return [
            {
              label: `Invoiced (${currency})`,
              value: money(
                mine.reduce((sum, row) => sum + row.invoicedMinor, 0),
                currency,
              ),
              note: plural(mine.length, "job"),
            },
            {
              label: `Margin (${currency})`,
              value: money(
                comparable.reduce((sum, row) => sum + (marginOf(row) ?? 0), 0),
                currency,
              ),
              note: `${plural(comparable.length, "job")} with costs recorded`,
            },
          ];
        }),
      },
      ...(currencies.length === 0
        ? [
            {
              kind: "note" as const,
              text: "No job opened in these dates has an invoice or a recorded cost.",
            },
          ]
        : []),
      ...currencies.flatMap((currency) => {
        const mine = rows.filter((row) => row.currency === currency);
        const sum = (pick: (row: JobFinanceRecord) => number) =>
          mine.reduce((total, row) => total + pick(row), 0);
        const comparable = mine.filter((row) => marginOf(row) !== null);
        return [
          { kind: "heading" as const, text: currency },
          {
            kind: "table" as const,
            columns: [
              left("Job", 1.5),
              left("Customer", 3),
              left("Service", 1.5),
              right("Invoiced", 1.8),
              right("Received", 1.8),
              right("Costs", 1.8),
              right("Margin", 1.8),
            ],
            rows: mine.map((row) => {
              const margin = marginOf(row);
              return [
                row.fileNumber,
                row.customerCompanyName,
                serviceLabels[opened.get(row.jobId)!.serviceLine] ?? "",
                money(row.invoicedMinor, currency),
                money(row.receivedMinor, currency),
                row.costMinor ? money(row.costMinor, currency) : "-",
                margin === null ? "-" : money(margin, currency),
              ];
            }),
            total: [
              "Total",
              "",
              "",
              money(
                sum((row) => row.invoicedMinor),
                currency,
              ),
              money(
                sum((row) => row.receivedMinor),
                currency,
              ),
              money(
                sum((row) => row.costMinor),
                currency,
              ),
              money(
                comparable.reduce(
                  (total, row) => total + (marginOf(row) ?? 0),
                  0,
                ),
                currency,
              ),
            ],
            empty: "",
          },
        ];
      }),
      {
        kind: "note",
        text: "Margin is the amount invoiced less the costs recorded, shown only for jobs that have both. Costs are recorded in GHS, so a margin is only meaningful in GHS.",
      },
    ],
  };
}
