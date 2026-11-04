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
import { ClientJobReportService } from "./client-job-report.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

/** The part of the Express response the PDF route writes to. */
interface BinaryResponse {
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
}

/**
 * A customer's jobs as a status update for the client: `companyId` is
 * required; `jobIds` (comma separated) picks jobs; otherwise `include`
 * (ongoing, the default; completed; all) does. `from` and `to` (YYYY-MM-DD, by
 * opening date) narrow either. Staff only, within their own service lines, like
 * the jobs list; it carries no money.
 */
@Controller("api/v1/client-job-reports")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class ClientJobReportsController {
  constructor(
    @Inject(ClientJobReportService)
    private readonly reports: ClientJobReportService,
  ) {}

  @Get()
  report(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.report(query, scopeOf(request));
  }

  @Get("pdf")
  async pdf(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.reports.pdf(query, scopeOf(request));
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }
}
