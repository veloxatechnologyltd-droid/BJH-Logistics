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
import { EmailAssistantService } from "../intake/email-assistant.service";
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
    @Inject(EmailAssistantService)
    private readonly assistant: EmailAssistantService,
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
    @Query("mailbox") mailbox: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.requests.list(
      customerCompanyId,
      request.allowedCompanyIds,
      mailbox,
    );
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

  /** Moves an email request to the other inbox (Requests or Inquiries); any staff member may sort. */
  @Patch(":id/mailbox")
  @UseGuards(DepartmentStaffGuard)
  move(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assistant.move(id, body, request.staffRoles ?? []);
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
  async readEmail(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const roles = request.staffRoles ?? [];
    const read = await this.inbound.readAgain(id, roles);
    if (read.intake?.extractionStatus !== "done") return read;
    await this.assistant.afterReading(id);
    return this.requests.get(id, undefined, roles);
  }

  /** Drafts the reply to an email request again, from the email, BJH's knowledge, the customer's jobs and past pricing. */
  @Post(":id/reply/draft")
  @UseGuards(DepartmentStaffGuard)
  draftReply(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.assistant.redraft(id, request.staffRoles ?? []);
  }

  /** Saves a person's edit of the reply before it is sent. */
  @Put(":id/reply")
  @UseGuards(DepartmentStaffGuard)
  saveReply(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assistant.saveReply(id, body, request.staffRoles ?? []);
  }

  /** Sends the reply by email to the sender only; a request's reply is sent once. */
  @Post(":id/reply/send")
  @UseGuards(DepartmentStaffGuard)
  sendReply(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assistant.sendReply(
      id,
      body,
      request.authUser!.userId,
      request.staffRoles ?? [],
    );
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
