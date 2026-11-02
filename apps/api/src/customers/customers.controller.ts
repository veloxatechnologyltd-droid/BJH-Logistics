import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ClientDeskGuard,
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
  StaffCompanyReadGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { CustomersService } from "./customers.service";

@Controller("api/v1/customers")
@UseGuards(SupabaseIdentityGuard)
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  @Post()
  @UseGuards(ClientDeskGuard)
  create(@Body() body: unknown) {
    return this.customers.create(body);
  }

  @Patch(":id")
  @UseGuards(ClientDeskGuard)
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.customers.updateCustomer(id, body);
  }

  @Post(":id/contacts")
  @UseGuards(ClientDeskGuard)
  addContact(@Param("id") id: string, @Body() body: unknown) {
    return this.customers.addContact(id, body);
  }

  @Patch(":id/contacts/:contactId")
  @UseGuards(ClientDeskGuard)
  updateContact(
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body() body: unknown,
  ) {
    return this.customers.updateContact(id, contactId, body);
  }

  @Get()
  @UseGuards(StaffCompanyReadGuard)
  list(
    @Query("search") search: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.customers.list(search, request.allowedCompanyIds);
  }

  /** Account figures: staff only, never customers; money only for finance roles. */
  @Get("insights")
  @UseGuards(DepartmentStaffGuard)
  insights(@Req() request: AuthenticatedRequest) {
    return this.customers.insights(request.staffRoles ?? []);
  }

  @Get(":id/insights")
  @UseGuards(DepartmentStaffGuard)
  async insightsFor(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const [record] = await this.customers.insights(
      request.staffRoles ?? [],
      id,
    );
    if (!record) throw new NotFoundException("Customer was not found");
    return record;
  }

  @Get(":id")
  @UseGuards(StaffCompanyReadGuard)
  get(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.customers.get(id, request.allowedCompanyIds);
  }
}
