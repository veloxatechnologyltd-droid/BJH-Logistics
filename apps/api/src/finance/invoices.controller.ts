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
import { InvoicesService } from "./invoices.service";

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

/** Invoices and payments: staff manage them, customers read their own company's. */
@Controller("api/v1/jobs/:id/invoices")
@UseGuards(SupabaseIdentityGuard)
export class InvoicesController {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}

  @Get()
  @UseGuards(JobScopeGuard)
  list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.invoices.list(id, scopeOf(request));
  }

  @Post()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  create(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.create(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post("from-charges")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  createFromCharges(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.createFromCharges(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Put(":invoiceId")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  update(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.update(id, invoiceId, body, scopeOf(request));
  }

  @Post(":invoiceId/issue")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  issue(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.issue(
      id,
      invoiceId,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post(":invoiceId/void")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  voidInvoice(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.voidInvoice(
      id,
      invoiceId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get(":invoiceId/pdf")
  @UseGuards(JobScopeGuard)
  async pdf(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.invoices.pdf(
      id,
      invoiceId,
      scopeOf(request),
    );
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }

  @Post(":invoiceId/payments")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  recordPayment(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.recordPayment(
      id,
      invoiceId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get(":invoiceId/payments/:paymentId/receipt")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  async receipt(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Param("paymentId") paymentId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.invoices.receiptPdf(
      id,
      invoiceId,
      paymentId,
      scopeOf(request),
    );
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }

  @Post(":invoiceId/payments/:paymentId/reverse")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  reversePayment(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Param("paymentId") paymentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.reversePayment(
      id,
      invoiceId,
      paymentId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}

/** Unpaid invoices across jobs: staff see their service lines, customers their own company. */
@Controller("api/v1/invoices/outstanding")
@UseGuards(SupabaseIdentityGuard)
export class OutstandingInvoicesController {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}

  @Get()
  @UseGuards(JobScopeGuard)
  list(
    @Query("companyId") companyId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.outstanding(companyId, scopeOf(request));
  }
}

/** Internal money overview (costs and margins): staff only, within their service lines. */
@Controller("api/v1/finance/summary")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class FinanceSummaryController {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}

  @Get()
  summary(@Req() request: AuthenticatedRequest) {
    return this.invoices.financeSummary(scopeOf(request));
  }
}
