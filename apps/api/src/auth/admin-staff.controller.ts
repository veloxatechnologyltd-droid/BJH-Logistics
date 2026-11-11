import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Patch,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SupabaseIdentityGuard, SuperAdminGuard } from "./auth.guards";
import type { AuthenticatedRequest } from "./auth.guards";
import { AdminStaffService } from "./admin-staff.service";

@Controller("api/v1/admin/staff")
@UseGuards(SupabaseIdentityGuard, SuperAdminGuard)
export class AdminStaffController {
  constructor(
    @Inject(AdminStaffService) private readonly staff: AdminStaffService,
  ) {}

  @Get()
  list(@Query("page") page?: string) {
    return this.staff.list(page);
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.staff.create(body, request.authUser!);
  }

  @Patch(":userId/name")
  setName(@Param("userId") userId: string, @Body() body: unknown) {
    return this.staff.setName(userId, body);
  }

  @Patch(":userId/password")
  setPassword(@Param("userId") userId: string, @Body() body: unknown) {
    return this.staff.setPassword(userId, body);
  }

  @Post(":userId/suspend")
  suspend(
    @Param("userId") userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.setSuspended(userId, true, request.authUser!);
  }

  @Post(":userId/activate")
  activate(
    @Param("userId") userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.setSuspended(userId, false, request.authUser!);
  }

  @Post(":userId/roles")
  assign(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.assign(userId, body, request.authUser!);
  }

  @Post("delete")
  removeMany(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.staff.removeMany(body, request.authUser!);
  }

  @Delete(":userId")
  remove(
    @Param("userId") userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.remove(userId, request.authUser!);
  }

  @Delete(":userId/roles/:roleKey")
  revoke(
    @Param("userId") userId: string,
    @Param("roleKey") roleKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.revoke(userId, roleKey, request.authUser!);
  }
}
