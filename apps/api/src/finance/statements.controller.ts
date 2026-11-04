import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  StaffRolesGuard,
  SupabaseIdentityGuard,
  financeRoles,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { JobReportService } from "./job-report.service";
import { StatementsService } from "./statements.service";

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

/** Statements of account: staff only; `companyId` is required, `from` and `to` (YYYY-MM-DD) are optional. */
@Controller("api/v1/finance/statements")
@UseGuards(
  SupabaseIdentityGuard,
  DepartmentStaffGuard,
  StaffRolesGuard(financeRoles),
)
export class StatementsController {
  constructor(
    @Inject(StatementsService) private readonly statements: StatementsService,
  ) {}

  @Get()
  statement(@Query() query: Record<string, unknown>) {
    return this.statements.statement(query);
  }

  @Get("pdf")
  async pdf(
    @Query() query: Record<string, unknown>,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.statements.pdf(query);
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }
}

/**
 * A customer's job report as a PDF: `companyId` is required; `jobIds`
 * (comma separated), `from` and `to` (YYYY-MM-DD, by opening date) narrow it.
 */
@Controller("api/v1/finance/job-reports")
@UseGuards(
  SupabaseIdentityGuard,
  DepartmentStaffGuard,
  JobScopeGuard,
  StaffRolesGuard(financeRoles),
)
export class JobReportsController {
  constructor(
    @Inject(JobReportService) private readonly reports: JobReportService,
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

  /** Emails the report PDF to the customer's contacts. */
  @Post("send")
  send(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.reports.send(body, request.authUser!.userId, scopeOf(request));
  }
}
