import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  extractionApproveInputSchema,
  isUuid,
  parseContract,
  referenceParentKind,
} from "@bjh/contracts";
import {
  DatabasePort,
  DocumentExtractionRecord,
  ExtractionApplyResult,
  JobScope,
} from "../database/database.port";
import { JobDetailsService } from "../jobs/job-details.service";
import { JobsService } from "../jobs/jobs.service";
import { extractFields, readPdfText } from "./document-extraction";
import {
  AI_READABLE_TYPES,
  DOCUMENT_READER,
  DocumentReadingError,
} from "./document-reader";
import type { DocumentReader } from "./document-reader";
import { DOCUMENT_STORAGE } from "./document-storage.port";
import type { DocumentStorage } from "./document-storage.port";

/**
 * Proposes shipment references from a document on the job as a draft. With an
 * AI service set up, the AI reads the PDF or image (scans and photos too);
 * otherwise the PDF's text layer is read here (no third party sees it) and a
 * scanned PDF gets an empty draft that says so. Nothing reaches the job until
 * a person reviews the draft and approves fields, which may be corrected first.
 */
@Injectable()
export class ExtractionsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(JobDetailsService) private readonly details: JobDetailsService,
    @Inject(DOCUMENT_READER) private readonly reader: DocumentReader,
  ) {}

  async list(id: string, scope: JobScope): Promise<DocumentExtractionRecord[]> {
    const job = await this.jobs.get(id, scope);
    return this.database.listDocumentExtractions(job.id);
  }

  async extract(
    id: string,
    documentId: string,
    version: string | undefined,
    createdBy: string,
    scope: JobScope,
  ): Promise<DocumentExtractionRecord> {
    const job = await this.jobs.get(id, scope);
    const versionNumber = version === undefined ? undefined : Number(version);
    if (
      versionNumber !== undefined &&
      (!Number.isInteger(versionNumber) || versionNumber < 1)
    ) {
      throw new BadRequestException("version must be a positive integer");
    }
    const stored = isUuid(documentId)
      ? await this.database.findDocumentVersion(
          job.id,
          documentId,
          versionNumber,
        )
      : null;
    if (!stored) throw new NotFoundException("Document was not found");
    if (this.reader.model) {
      if (!AI_READABLE_TYPES.includes(stored.contentType)) {
        throw new BadRequestException("Only a PDF, PNG or JPEG can be read");
      }
      let fields;
      try {
        fields = await this.reader.read({
          bytes: await this.storage.get(stored.objectKey),
          contentType: stored.contentType,
        });
      } catch (error) {
        if (error instanceof DocumentReadingError) {
          throw new ServiceUnavailableException(
            `${error.message}. Try again, or add the references by hand.`,
          );
        }
        throw error;
      }
      return this.database.createDocumentExtraction({
        jobId: job.id,
        documentId: stored.documentId,
        versionNumber: stored.versionNumber,
        textFound: true,
        readBy: this.reader.model,
        fields,
        createdBy,
      });
    }
    if (stored.contentType !== "application/pdf") {
      throw new BadRequestException(
        "Only a PDF has text to read; images need AI reading, which is not set up",
      );
    }
    let text: string;
    try {
      text = await readPdfText(await this.storage.get(stored.objectKey));
    } catch {
      throw new BadRequestException("The PDF could not be read");
    }
    const textFound = text.replace(/\s+/g, "").length >= 20;
    return this.database.createDocumentExtraction({
      jobId: job.id,
      documentId: stored.documentId,
      versionNumber: stored.versionNumber,
      textFound,
      readBy: null,
      fields: textFound ? extractFields(text) : [],
      createdBy,
    });
  }

  /**
   * Applies the chosen fields as shipment references, masters first so a house
   * document can hang under its master. Each field reports what happened.
   */
  async approve(
    id: string,
    extractionId: string,
    input: unknown,
    reviewedBy: string,
    scope: JobScope,
  ): Promise<DocumentExtractionRecord> {
    const job = await this.jobs.get(id, scope);
    const parsed = parseContract(extractionApproveInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before changing it");
    }
    const draft = await this.draft(job.id, extractionId);

    const chosen = parsed.data.fields;
    const seen = new Set<number>();
    for (const field of chosen) {
      if (!draft.fields[field.index]) {
        throw new BadRequestException(
          `field ${field.index} is not in this draft`,
        );
      }
      if (seen.has(field.index)) {
        throw new BadRequestException(`field ${field.index} is listed twice`);
      }
      seen.add(field.index);
    }
    const isHouse = (index: number) =>
      draft.fields[index].key in referenceParentKind;
    const ordered = [...chosen].sort(
      (a, b) => Number(isHouse(a.index)) - Number(isHouse(b.index)),
    );

    const applied: ExtractionApplyResult[] = [];
    for (const field of ordered) {
      const proposed = draft.fields[field.index];
      const outcome = (result: string) =>
        applied.push({
          index: field.index,
          key: proposed.key,
          value: field.value,
          result,
        });
      const parentKind = referenceParentKind[proposed.key];
      let parentReferenceId: string | null = null;
      if (parentKind) {
        const masters = (
          await this.database.listShipmentReferences(job.id)
        ).filter((item) => item.kind === parentKind);
        if (masters.length === 0) {
          outcome(`not added: apply or add the master (${parentKind}) first`);
          continue;
        }
        if (masters.length > 1) {
          outcome("not added: several masters on the job; add it by hand");
          continue;
        }
        parentReferenceId = masters[0].id;
      }
      try {
        await this.details.addReference(
          job.id,
          {
            kind: proposed.key,
            value: field.value,
            sealNumber: proposed.key === "container" ? field.sealNumber : null,
            parentReferenceId,
          },
          reviewedBy,
          scope,
        );
        outcome("added");
      } catch (error) {
        if (
          error instanceof ConflictException &&
          error.message === "This reference is already on the job"
        ) {
          outcome("already on the job");
        } else if (error instanceof HttpException) {
          outcome(`not added: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
    applied.sort((a, b) => a.index - b.index);
    return this.review(job.id, extractionId, "approved", applied, reviewedBy);
  }

  async reject(
    id: string,
    extractionId: string,
    reviewedBy: string,
    scope: JobScope,
  ): Promise<DocumentExtractionRecord> {
    const job = await this.jobs.get(id, scope);
    await this.draft(job.id, extractionId);
    return this.review(job.id, extractionId, "rejected", null, reviewedBy);
  }

  private async draft(
    jobId: string,
    extractionId: string,
  ): Promise<DocumentExtractionRecord> {
    const found = isUuid(extractionId)
      ? (await this.database.listDocumentExtractions(jobId)).find(
          (item) => item.id === extractionId,
        )
      : undefined;
    if (!found) throw new NotFoundException("Extraction was not found");
    if (found.status !== "draft") {
      throw new ConflictException("This draft was already reviewed");
    }
    return found;
  }

  private async review(
    jobId: string,
    extractionId: string,
    status: "approved" | "rejected",
    applied: ExtractionApplyResult[] | null,
    reviewedBy: string,
  ): Promise<DocumentExtractionRecord> {
    const result = await this.database.reviewDocumentExtraction(
      jobId,
      extractionId,
      { status, applied, reviewedBy },
    );
    if (result === "not_found") {
      throw new NotFoundException("Extraction was not found");
    }
    if (result === "not_draft") {
      throw new ConflictException("This draft was already reviewed");
    }
    return result;
  }
}
