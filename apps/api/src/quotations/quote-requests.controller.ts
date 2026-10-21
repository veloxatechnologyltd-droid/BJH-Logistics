import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
  StaffCompanyReadGuard,
  SuperAdminGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { InboundEmailService } from "../intake/inbound-email.service";
import { QuoteRequestsService } from "./quote-requests.service";

@Controller("api/v1/quote-requests")
@UseGuards(SupabaseIdentityGuard)
export class QuoteRequestsController {
  constructor(
    @Inject(QuoteRequestsService)
    private readonly requests: QuoteRequestsService,
    @Inject(InboundEmailService)
    private readonly inbound: InboundEmailService,
  ) {}

  @Post()
  @UseGuards(SuperAdminGuard)
  create(@Body() body: unknown) {
    return this.requests.create(body);
  }

  @Post("mine")
  @UseGuards(StaffCompanyReadGuard)
  createMine(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.requests.createForCustomer(
      body,
      request.authUser!,
      request.allowedCompanyIds,
    );
  }

  @Get()
  @UseGuards(StaffCompanyReadGuard)
  list(
    @Query("customerCompanyId") customerCompanyId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.requests.list(customerCompanyId, request.allowedCompanyIds);
  }

  @Get(":id")
  @UseGuards(StaffCompanyReadGuard)
  get(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.requests.get(
      id,
      request.allowedCompanyIds,
      request.staffRoles ?? [],
    );
  }

  @Patch(":id/customer")
  @UseGuards(SuperAdminGuard)
  associateCustomer(@Param("id") id: string, @Body() body: unknown) {
    return this.requests.associateCustomer(id, body);
  }

  /** Details of an email request, corrected by the super admin or the rep in charge of its service; saving them records that they were checked. */
  @Put(":id/details")
  @UseGuards(DepartmentStaffGuard)
  saveDetails(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbound.saveDetails(
      id,
      body,
      request.authUser!.userId,
      request.staffRoles ?? [],
    );
  }

  /** Reads the saved email again, when the first reading failed. */
  @Post(":id/read-email")
  @UseGuards(DepartmentStaffGuard)
  readEmail(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.inbound.readAgain(id, request.staffRoles ?? []);
  }

  /** A starting draft for the request's quote, from the most similar past issued quote; nothing is saved. */
  @Get(":id/quote-suggestion")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  quoteSuggestion(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.requests.quoteSuggestion(id, {
      companyIds: request.allowedCompanyIds,
      serviceLines: request.allowedServiceLines,
    });
  }

  @Get(":id/attachments/:attachmentId")
  @UseGuards(DepartmentStaffGuard)
  attachment(
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    return this.inbound.attachmentLink(id, attachmentId);
  }
}
