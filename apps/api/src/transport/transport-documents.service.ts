import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  cleanTransportDocumentFields,
  invoiceReasonInputSchema,
  isUuid,
  parseContract,
  transportDocumentCreateSchema,
  transportDocumentKinds,
  transportDocumentKindsFor,
  transportDocumentTitles,
  transportDocumentUpdateSchema,
  type TransportDocumentKind,
} from "@bjh/contracts";
import {
  DatabasePort,
  JobPartyRecord,
  JobRecord,
  JobScope,
  ShipmentReferenceRecord,
  ShippingDocumentRecord,
  TransportDocumentRecord,
} from "../database/database.port";
import { JobsService } from "../jobs/jobs.service";
import { renderTransportDocumentPdf } from "./transport-document-pdf";

const partyText = (
  parties: JobPartyRecord[],
  role: string,
): string | undefined => {
  const party = parties.find((item) => item.role === role);
  if (!party) return undefined;
  return party.details ? `${party.name}\n${party.details}` : party.name;
};

/**
 * BJH's own house documents: a house B/L, a house air waybill or an air
 * manifest, prepared from the job. Staff type the document number (unique
 * among issued documents of its kind) and the details the job does not hold;
 * issuing freezes the document, and a mistake is corrected by voiding it and
 * issuing a new one. Customers can download issued documents of their own
 * company's jobs.
 */
@Injectable()
export class TransportDocumentsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  /** Every house document and road waybill across jobs, within the caller's service lines. */
  listAll(scope: JobScope): Promise<ShippingDocumentRecord[]> {
    return this.database.listShippingDocuments(scope);
  }

  async list(id: string, scope: JobScope): Promise<TransportDocumentRecord[]> {
    const job = await this.jobs.get(id, scope);
    const documents = await this.database.listTransportDocuments(job.id);
    return scope.companyIds === undefined
      ? documents
      : documents.filter((item) => item.issuedAt !== null);
  }

  /** The number and details the job already holds, to start a document from. */
  async prefill(
    id: string,
    kindValue: string | undefined,
    scope: JobScope,
  ): Promise<{
    documentNumber: string | null;
    fields: Record<string, string>;
  }> {
    const job = await this.jobs.get(id, scope);
    const kind = this.parseKind(kindValue, job);
    const [parties, references, settings] = await Promise.all([
      this.database.listJobParties(job.id),
      this.database.listShipmentReferences(job.id),
      this.database.getBusinessSettings(),
    ]);
    const issuer = settings?.settings.issuer;
    const agent = issuer
      ? [
          issuer.name,
          issuer.address,
          [issuer.phone, issuer.email].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join("\n")
      : undefined;
    const first = (kindOfReference: ShipmentReferenceRecord["kind"]) =>
      references.find((item) => item.kind === kindOfReference)?.value;
    const containers = references
      .filter((item) => item.kind === "container")
      .map((item) =>
        item.sealNumber ? `${item.value}, seal ${item.sealNumber}` : item.value,
      )
      .join("\n");

    const fields: Record<string, string | undefined> = {
      shipper: partyText(parties, "shipper"),
      consignee: partyText(parties, "consignee"),
      notifyParty: partyText(parties, "notify_party"),
      forwardingAgent: agent,
    };
    let documentNumber: string | null = null;
    if (kind === "house_bl") {
      fields.deliveryAgent = partyText(parties, "agent");
      fields.masterReference = first("master_bl") ?? first("booking");
      fields.containers = containers || undefined;
      documentNumber = first("house_bl") ?? null;
    } else if (kind === "house_awb") {
      fields.masterAwb = first("master_awb");
      documentNumber = first("house_awb") ?? null;
    } else {
      fields.masterAwb = first("master_awb");
      fields.houseAwb = first("house_awb");
      fields.hawbConsignee = fields.consignee;
      delete fields.consignee;
      documentNumber = first("house_awb") ?? null;
    }
    const present = Object.fromEntries(
      Object.entries(fields).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    return { documentNumber, fields: present };
  }

  async create(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<TransportDocumentRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(transportDocumentCreateSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    this.requireKindFor(job, parsed.data.kind);
    const cleaned = cleanTransportDocumentFields(
      parsed.data.kind,
      parsed.data.fields,
    );
    if (!cleaned.success) throw new BadRequestException(cleaned.message);
    return this.database.createTransportDocument({
      jobId: job.id,
      kind: parsed.data.kind,
      documentNumber: parsed.data.documentNumber,
      fields: cleaned.data,
      createdBy,
    });
  }

  async update(
    id: string,
    documentId: string,
    input: unknown,
    scope: JobScope,
  ): Promise<TransportDocumentRecord> {
    const job = await this.editableJob(id, scope);
    const existing = await this.find(job.id, documentId);
    const parsed = parseContract(transportDocumentUpdateSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const cleaned = cleanTransportDocumentFields(
      existing.kind,
      parsed.data.fields,
    );
    if (!cleaned.success) throw new BadRequestException(cleaned.message);
    const result = await this.database.updateTransportDocumentDraft(
      job.id,
      existing.id,
      { documentNumber: parsed.data.documentNumber, fields: cleaned.data },
    );
    if (result === "not_found") this.notFound();
    if (result === "not_draft") {
      throw new ConflictException(
        "Only a draft can be edited; void this document and issue a new one",
      );
    }
    return result;
  }

  async issue(
    id: string,
    documentId: string,
    issuedBy: string,
    scope: JobScope,
  ): Promise<TransportDocumentRecord> {
    const job = await this.editableJob(id, scope);
    const existing = await this.find(job.id, documentId);
    const result = await this.database.issueTransportDocument(
      job.id,
      existing.id,
      issuedBy,
    );
    if (result === "not_found") this.notFound();
    if (result === "not_draft") {
      throw new ConflictException("This document is already issued or void");
    }
    if (result === "no_number") {
      throw new BadRequestException("Enter the document number before issuing");
    }
    if (result === "number_taken") {
      throw new ConflictException(
        `${transportDocumentTitles[existing.kind]} number ${existing.documentNumber} is already issued; void that one first or use another number`,
      );
    }
    return result;
  }

  async void(
    id: string,
    documentId: string,
    input: unknown,
    voidedBy: string,
    scope: JobScope,
  ): Promise<TransportDocumentRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(invoiceReasonInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const existing = await this.find(job.id, documentId);
    const result = await this.database.voidTransportDocument(
      job.id,
      existing.id,
      voidedBy,
      parsed.data.reason,
    );
    if (result === "not_found") this.notFound();
    if (result === "already_void") {
      throw new ConflictException("This document is already void");
    }
    return result;
  }

  /** Customers reach only documents that were issued, on their own company's jobs. */
  async pdf(
    id: string,
    documentId: string,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    const job = await this.jobs.get(id, scope);
    const document = await this.find(job.id, documentId);
    if (scope.companyIds !== undefined && document.issuedAt === null) {
      this.notFound();
    }
    const settings = await this.database.getBusinessSettings();
    const file = await renderTransportDocumentPdf({
      document,
      job,
      settings: settings?.settings ?? null,
    });
    const base =
      `${document.kind}-${document.documentNumber ?? "draft"}`.replace(
        /[^A-Za-z0-9-]+/g,
        "-",
      );
    return { file, filename: `${base}.pdf` };
  }

  private parseKind(
    value: string | undefined,
    job: JobRecord,
  ): TransportDocumentKind {
    if (!(transportDocumentKinds as readonly string[]).includes(value ?? "")) {
      throw new BadRequestException(
        `kind must be one of ${transportDocumentKinds.join(", ")}`,
      );
    }
    this.requireKindFor(job, value as TransportDocumentKind);
    return value as TransportDocumentKind;
  }

  private requireKindFor(job: JobRecord, kind: TransportDocumentKind): void {
    if (!transportDocumentKindsFor(job.serviceLine).includes(kind)) {
      throw new BadRequestException(
        `${transportDocumentTitles[kind]} cannot be prepared on a ${job.serviceLine} job`,
      );
    }
  }

  private async find(
    jobId: string,
    documentId: string,
  ): Promise<TransportDocumentRecord> {
    const document = isUuid(documentId)
      ? (await this.database.listTransportDocuments(jobId)).find(
          (item) => item.id === documentId,
        )
      : undefined;
    if (!document) this.notFound();
    return document!;
  }

  private notFound(): never {
    throw new NotFoundException("Document was not found on this job");
  }

  private async editableJob(id: string, scope: JobScope): Promise<JobRecord> {
    const job = await this.jobs.get(id, scope);
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before changing it");
    }
    return job;
  }
}
