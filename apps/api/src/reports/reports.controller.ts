import {
  Controller,
  Get,
  Inject,
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
import { ReportPdfService } from "./report-pdf.service";

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

/** PDF reports; staff see only companies and service lines in their API scope. */
@Controller("api/v1/reports")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class ReportsController {
  constructor(
    @Inject(ReportPdfService) private readonly pdfs: ReportPdfService,
  ) {}

  /**
   * One report as a PDF: `type`, `from` and `to` are required; shipment-status
   * also takes an optional `serviceLine`. The money reports are for finance.
   */
  @Get("pdf")
  async pdf(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.pdfs.pdf(
      query,
      scopeOf(request),
      request.staffRoles ?? [],
    );
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }
}
