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
  quoteDeskRoles,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { QuotesService } from "./quotes.service";

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

@Controller("api/v1/quotes")
@UseGuards(SupabaseIdentityGuard)
export class QuotesController {
  constructor(@Inject(QuotesService) private readonly quotes: QuotesService) {}

  @Post()
  @UseGuards(DepartmentStaffGuard, StaffRolesGuard(quoteDeskRoles))
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.quotes.create(
      body,
      request.authUser!.userId,
      request.staffRoles!,
    );
  }

  @Get()
  @UseGuards(JobScopeGuard)
  list(@Req() request: AuthenticatedRequest) {
    return this.quotes.list(scopeOf(request));
  }

  @Get(":id")
  @UseGuards(JobScopeGuard)
  get(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.quotes.get(id, scopeOf(request));
  }

  @Get(":id/pdf")
  @UseGuards(JobScopeGuard)
  async pdf(
    @Param("id") id: string,
    @Query("version") version: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.quotes.pdf(
      id,
      version,
      scopeOf(request),
    );
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }

  @Put(":id/draft")
  @UseGuards(
    DepartmentStaffGuard,
    JobScopeGuard,
    StaffRolesGuard(quoteDeskRoles),
  )
  saveDraft(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.quotes.saveDraft(id, body, scopeOf(request));
  }

  @Post(":id/versions")
  @UseGuards(
    DepartmentStaffGuard,
    JobScopeGuard,
    StaffRolesGuard(quoteDeskRoles),
  )
  startVersion(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.quotes.startVersion(
      id,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post(":id/issue")
  @UseGuards(
    DepartmentStaffGuard,
    JobScopeGuard,
    StaffRolesGuard(quoteDeskRoles),
  )
  issue(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.quotes.issue(id, request.authUser!.userId, scopeOf(request));
  }

  @Post(":id/send")
  @UseGuards(
    DepartmentStaffGuard,
    JobScopeGuard,
    StaffRolesGuard(quoteDeskRoles),
  )
  send(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.quotes.send(id, request.authUser!.userId, scopeOf(request));
  }

  @Post(":id/respond")
  @UseGuards(JobScopeGuard)
  respond(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.quotes.respond(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post(":id/decision")
  @UseGuards(
    DepartmentStaffGuard,
    JobScopeGuard,
    StaffRolesGuard(quoteDeskRoles),
  )
  decide(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.quotes.decide(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}
