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
  StaffRolesGuard,
  SupabaseIdentityGuard,
  financeReadRoles,
  financeRoles,
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
  @UseGuards(
    JobScopeGuard,
    StaffRolesGuard(financeReadRoles, { customers: true }),
  )
  list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.invoices.list(id, scopeOf(request));
  }

  @Post()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, StaffRolesGuard(financeRoles))
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
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, StaffRolesGuard(financeRoles))
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
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, StaffRolesGuard(financeRoles))
  update(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.update(id, invoiceId, body, scopeOf(request));
  }

  @Post(":invoiceId/issue")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, StaffRolesGuard(financeRoles))
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
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, StaffRolesGuard(financeRoles))
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

  @Post(":invoiceId/accept")
  @UseGuards(JobScopeGuard)
  accept(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.accept(
      id,
      invoiceId,
      body,
      request.authUser!.userId,
      request.staffRoles ?? [],
      scopeOf(request),
    );
  }

  @Get(":invoiceId/pdf")
  @UseGuards(
    JobScopeGuard,
    StaffRolesGuard(financeReadRoles, { customers: true }),
  )
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
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, StaffRolesGuard(financeRoles))
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

  /** Customers get their own company's receipts too (client meeting, 2026-11-01). */
  @Get(":invoiceId/payments/:paymentId/receipt")
  @UseGuards(
    JobScopeGuard,
    StaffRolesGuard(financeReadRoles, { customers: true }),
  )
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
  @UseGuards(DepartmentStaffGuard, JobScopeGuard, StaffRolesGuard(financeRoles))
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

  /** Emails the receipt PDF to the client's contacts; customer service or finance. */
  @Post(":invoiceId/payments/:paymentId/receipt/send")
  @UseGuards(
    DepartmentStaffGuard,
    JobScopeGuard,
    StaffRolesGuard(financeReadRoles),
  )
  sendReceipt(
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Param("paymentId") paymentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.sendReceipt(
      id,
      invoiceId,
      paymentId,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}

/** Every receipt the caller may see: staff with finance or customer service, customers their own. */
@Controller("api/v1/receipts")
@UseGuards(
  SupabaseIdentityGuard,
  JobScopeGuard,
  StaffRolesGuard(financeReadRoles, { customers: true }),
)
export class ReceiptsController {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.invoices.receipts(scopeOf(request));
  }
}

/** Unpaid invoices across jobs: staff see their service lines, customers their own company. */
@Controller("api/v1/invoices/outstanding")
@UseGuards(
  SupabaseIdentityGuard,
  StaffRolesGuard(financeRoles, { customers: true }),
)
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
@UseGuards(
  SupabaseIdentityGuard,
  DepartmentStaffGuard,
  JobScopeGuard,
  StaffRolesGuard(financeRoles),
)
export class FinanceSummaryController {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}

  @Get()
  summary(@Req() request: AuthenticatedRequest) {
    return this.invoices.financeSummary(scopeOf(request));
  }
}

/** One customer payment applied across several of their invoices at once: staff only, within their service lines. */
@Controller("api/v1/payments")
@UseGuards(
  SupabaseIdentityGuard,
  DepartmentStaffGuard,
  JobScopeGuard,
  StaffRolesGuard(financeRoles),
)
export class PaymentsController {
  constructor(
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}

  @Post()
  record(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.invoices.recordPayments(
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}
