import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
  documentTypeKeys,
  documentUploadFieldsSchema,
  isUuid,
  libraryUploadFieldsSchema,
  parseContract,
} from "@bjh/contracts";
import type { DocumentType } from "@bjh/contracts";
import { financeRoles } from "../auth/auth.guards";
import {
  DatabasePort,
  DocumentRecord,
  JobScope,
  LibraryDocumentRecord,
} from "../database/database.port";
import type { StaffRoleKey } from "../database/database.port";
import { JobsService } from "../jobs/jobs.service";
import { DOCUMENT_STORAGE, SIGNED_URL_SECONDS } from "./document-storage.port";
import type { DocumentStorage } from "./document-storage.port";
import { detectContentType, sanitizeFilename } from "./file-signature";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** BJH's own costs (supplier invoices, disbursement proof): finance roles only. */
export const COST_EVIDENCE_TYPES: DocumentType[] = [
  "supplier_invoice",
  "disbursement_evidence",
];

/** Customers and non-finance staff (no roles, or none of the finance roles) do not see cost evidence. */
export function hiddenDocumentTypesFor(
  roles: StaffRoleKey[] | undefined,
): DocumentType[] {
  return (roles ?? []).some((role) => financeRoles.includes(role))
    ? []
    : COST_EVIDENCE_TYPES;
}

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  async list(id: string, scope: JobScope): Promise<DocumentRecord[]> {
    const job = await this.jobs.get(id, scope);
    const hidden = scope.hiddenDocumentTypes ?? [];
    return (await this.database.listDocuments(job.id)).filter(
      (document) => !hidden.includes(document.documentType),
    );
  }

  /** 404 unless the document is on the job and of a type the caller may see. */
  async assertVisible(id: string, documentId: string, scope: JobScope) {
    const visible = await this.list(id, scope);
    if (!visible.some((document) => document.id === documentId)) {
      throw new NotFoundException("Document was not found");
    }
  }

  private refuseHiddenType(documentType: DocumentType, scope: JobScope) {
    if (scope.hiddenDocumentTypes?.includes(documentType)) {
      throw new ForbiddenException(
        "Supplier invoices and disbursement evidence are handled by finance",
      );
    }
  }

  /** Stores the file privately under a random key and records a new version. */
  async upload(
    id: string,
    fields: unknown,
    file: UploadedFile | undefined,
    uploadedBy: string,
    scope: JobScope,
  ): Promise<DocumentRecord> {
    const job = await this.jobs.get(id, scope);
    const parsed = parseContract(documentUploadFieldsSchema, fields ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.message);
    this.refuseHiddenType(parsed.data.documentType, scope);
    if (parsed.data.documentId) {
      await this.assertVisible(job.id, parsed.data.documentId, scope);
    }
    const { file: checked, contentType } = this.checkFile(file);

    const objectKey = `${job.id}/${randomUUID()}`;
    await this.storage.put(objectKey, checked.buffer, contentType);
    const saved = await this.database.saveDocumentVersion({
      jobId: job.id,
      documentId: parsed.data.documentId,
      documentType: parsed.data.documentType,
      filename: sanitizeFilename(checked.originalname),
      contentType,
      sizeBytes: checked.size,
      sha256: createHash("sha256").update(checked.buffer).digest("hex"),
      objectKey,
      uploadedBy,
    });
    if (saved === "document_not_found") {
      throw new NotFoundException("Document was not found on this job");
    }
    return saved;
  }

  /** Size and content checks shared by every upload; the claimed type and name are never trusted. */
  private checkFile(file: UploadedFile | undefined) {
    if (!file || file.size === 0) {
      throw new BadRequestException("A non-empty file is required");
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new PayloadTooLargeException("Files can be at most 25 MB");
    }
    const contentType = detectContentType(file.buffer);
    if (!contentType) {
      throw new UnsupportedMediaTypeException(
        "Only PDF, PNG and JPEG files are accepted",
      );
    }
    return { file, contentType };
  }

  /** Searches every document the caller may see; every word typed must match somewhere. */
  async search(
    search: string | undefined,
    type: string | undefined,
    scope: JobScope,
  ): Promise<LibraryDocumentRecord[]> {
    if (type && !documentTypeKeys.includes(type as DocumentType)) {
      throw new BadRequestException("type must be a supported document type");
    }
    const terms = (search ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .slice(0, 8);
    return this.database.searchDocuments(
      {
        terms,
        documentType: (type || null) as DocumentType | null,
        documentId: null,
      },
      scope,
    );
  }

  /** Stores a new document that may stand alone, belong to a job, or belong to one company. */
  async uploadToLibrary(
    fields: unknown,
    file: UploadedFile | undefined,
    uploadedBy: string,
    scope: JobScope,
  ): Promise<LibraryDocumentRecord> {
    const parsed = parseContract(libraryUploadFieldsSchema, fields ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { jobId, companyId, title, documentType } = parsed.data;
    this.refuseHiddenType(documentType, scope);
    if (jobId) await this.jobs.get(jobId, scope);
    if (companyId && !(await this.database.findCustomer(companyId))) {
      throw new NotFoundException("Customer company was not found");
    }
    const { file: checked, contentType } = this.checkFile(file);

    const objectKey = `${jobId ?? "library"}/${randomUUID()}`;
    await this.storage.put(objectKey, checked.buffer, contentType);
    const documentId = await this.database.saveLibraryDocument({
      jobId,
      companyId,
      title,
      documentType,
      filename: sanitizeFilename(checked.originalname),
      contentType,
      sizeBytes: checked.size,
      sha256: createHash("sha256").update(checked.buffer).digest("hex"),
      objectKey,
      uploadedBy,
    });
    const [saved] = await this.database.searchDocuments(
      { terms: [], documentType: null, documentId },
      scope,
    );
    return saved;
  }

  /** Returns a short-lived signed link after the caller's access to the document is checked. */
  async createLibraryDownloadLink(
    documentId: string,
    version: string | undefined,
    scope: JobScope,
  ) {
    const versionNumber = version === undefined ? undefined : Number(version);
    if (
      versionNumber !== undefined &&
      (!Number.isInteger(versionNumber) || versionNumber < 1)
    ) {
      throw new BadRequestException("version must be a positive integer");
    }
    const visible = isUuid(documentId)
      ? await this.database.searchDocuments(
          { terms: [], documentType: null, documentId },
          scope,
        )
      : [];
    const stored =
      visible.length > 0
        ? await this.database.findDocumentVersionById(documentId, versionNumber)
        : null;
    if (!stored) throw new NotFoundException("Document was not found");
    return {
      url: await this.storage.createSignedUrl(
        stored.objectKey,
        SIGNED_URL_SECONDS,
      ),
      expiresInSeconds: SIGNED_URL_SECONDS,
      filename: stored.filename,
      contentType: stored.contentType,
      versionNumber: stored.versionNumber,
    };
  }

  /** Returns a short-lived signed link after the caller's access to the job is checked. */
  async createDownloadLink(
    id: string,
    documentId: string,
    version: string | undefined,
    scope: JobScope,
  ) {
    const job = await this.jobs.get(id, scope);
    const versionNumber = version === undefined ? undefined : Number(version);
    if (
      versionNumber !== undefined &&
      (!Number.isInteger(versionNumber) || versionNumber < 1)
    ) {
      throw new BadRequestException("version must be a positive integer");
    }
    if (isUuid(documentId)) await this.assertVisible(job.id, documentId, scope);
    const stored = isUuid(documentId)
      ? await this.database.findDocumentVersion(
          job.id,
          documentId,
          versionNumber,
        )
      : null;
    if (!stored) throw new NotFoundException("Document was not found");
    return {
      url: await this.storage.createSignedUrl(
        stored.objectKey,
        SIGNED_URL_SECONDS,
      ),
      expiresInSeconds: SIGNED_URL_SECONDS,
      filename: stored.filename,
      contentType: stored.contentType,
      versionNumber: stored.versionNumber,
    };
  }
}
