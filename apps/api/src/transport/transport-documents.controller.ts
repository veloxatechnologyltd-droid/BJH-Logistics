import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { TransportDocumentsService } from "./transport-documents.service";

/** The part of the Express response the PDF route writes to. */
interface BinaryResponse {
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
}

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

/** House B/L, house air waybill and manifest: staff prepare them, customers read issued ones. */
@Controller("api/v1/jobs/:id/transport-documents")
@UseGuards(SupabaseIdentityGuard)
export class TransportDocumentsController {
  constructor(
    @Inject(TransportDocumentsService)
    private readonly documents: TransportDocumentsService,
  ) {}

  @Get()
  @UseGuards(JobScopeGuard)
  list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.list(id, scopeOf(request));
  }

  @Get("prefill")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  prefill(
    @Param("id") id: string,
    @Query("kind") kind: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.prefill(id, kind, scopeOf(request));
  }

  @Post()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  create(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.create(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Put(":documentId")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  update(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.update(id, documentId, body, scopeOf(request));
  }

  @Post(":documentId/issue")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  issue(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.issue(
      id,
      documentId,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post(":documentId/void")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  voidDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.void(
      id,
      documentId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get(":documentId/pdf")
  @UseGuards(JobScopeGuard)
  async pdf(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.documents.pdf(
      id,
      documentId,
      scopeOf(request),
    );
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }
}

/** Every bill of lading, air waybill, manifest and waybill across jobs: staff only, within their service lines. */
@Controller("api/v1/shipping-documents")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class ShippingDocumentsController {
  constructor(
    @Inject(TransportDocumentsService)
    private readonly documents: TransportDocumentsService,
  ) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.documents.listAll(scopeOf(request));
  }
}
