import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { hiddenDocumentTypesFor } from "./documents.service";
import { ExtractionsService } from "./extractions.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
    hiddenDocumentTypes: hiddenDocumentTypesFor(request.staffRoles),
  };
}

/** Draft details read from a job's PDFs, reviewed by staff before anything is applied. */
@Controller("api/v1/jobs/:id")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class ExtractionsController {
  constructor(
    @Inject(ExtractionsService)
    private readonly extractions: ExtractionsService,
  ) {}

  @Get("extractions")
  list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.extractions.list(id, scopeOf(request));
  }

  @Post("documents/:documentId/extract")
  extract(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Query("version") version: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.extractions.extract(
      id,
      documentId,
      version,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post("extractions/:extractionId/approve")
  approve(
    @Param("id") id: string,
    @Param("extractionId") extractionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.extractions.approve(
      id,
      extractionId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post("extractions/:extractionId/reject")
  reject(
    @Param("id") id: string,
    @Param("extractionId") extractionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.extractions.reject(
      id,
      extractionId,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}
