import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SupabaseIdentityGuard, SuperAdminGuard } from "./auth.guards";
import type { AuthenticatedRequest } from "./auth.guards";
import { AdminCustomerAccountsService } from "./admin-customer-accounts.service";

@Controller("api/v1/admin/customer-accounts")
@UseGuards(SupabaseIdentityGuard, SuperAdminGuard)
export class AdminCustomerAccountsController {
  constructor(
    @Inject(AdminCustomerAccountsService)
    private readonly accounts: AdminCustomerAccountsService,
  ) {}

  @Get()
  list() {
    return this.accounts.list();
  }

  @Get("pending")
  listPending() {
    return this.accounts.listPending();
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.accounts.create(body, request.authUser!);
  }

  @Patch(":userId/password")
  setPassword(@Param("userId") userId: string, @Body() body: unknown) {
    return this.accounts.setPassword(userId, body);
  }

  @Post(":userId/suspend")
  suspend(@Param("userId") userId: string) {
    return this.accounts.setSuspended(userId, true);
  }

  @Post(":userId/activate")
  activate(@Param("userId") userId: string) {
    return this.accounts.setSuspended(userId, false);
  }
}
