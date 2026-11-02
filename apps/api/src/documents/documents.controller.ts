import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { UserThrottlerGuard } from "../auth/user-throttler.guard";
import {
  DocumentsService,
  MAX_DOCUMENT_BYTES,
  hiddenDocumentTypesFor,
} from "./documents.service";
import type { UploadedFile as UploadedFileData } from "./documents.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
    hiddenDocumentTypes: hiddenDocumentTypesFor(request.staffRoles),
  };
}

@Controller("api/v1/jobs/:id/documents")
@UseGuards(SupabaseIdentityGuard)
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  @Get()
  @UseGuards(JobScopeGuard)
  list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.list(id, scopeOf(request));
  }

  @Post()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 },
    }),
  )
  upload(
    @Param("id") id: string,
    @Body() fields: unknown,
    @UploadedFile() file: UploadedFileData | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.upload(
      id,
      fields,
      file,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get(":documentId/download")
  @UseGuards(JobScopeGuard)
  download(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Query("version") version: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.createDownloadLink(
      id,
      documentId,
      version,
      scopeOf(request),
    );
  }
}

/** The document library: every document the caller may see, across jobs and standalone. */
@Controller("api/v1/documents")
@UseGuards(SupabaseIdentityGuard)
export class DocumentLibraryController {
  constructor(
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  @Get()
  @UseGuards(JobScopeGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  search(
    @Query("search") search: string | undefined,
    @Query("type") type: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.search(search, type, scopeOf(request));
  }

  @Post()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 },
    }),
  )
  upload(
    @Body() fields: unknown,
    @UploadedFile() file: UploadedFileData | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.uploadToLibrary(
      fields,
      file,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get(":documentId/download")
  @UseGuards(JobScopeGuard)
  download(
    @Param("documentId") documentId: string,
    @Query("version") version: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.createLibraryDownloadLink(
      documentId,
      version,
      scopeOf(request),
    );
  }
}
