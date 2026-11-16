import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  StaffRolesGuard,
  SupabaseIdentityGuard,
  financeRoles,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { ExpensesService } from "./expenses.service";

/** Business expenses (rent, fuel, salaries...): finance staff; payroll is the super admin's. */
@Controller("api/v1/finance/expenses")
@UseGuards(
  SupabaseIdentityGuard,
  DepartmentStaffGuard,
  StaffRolesGuard(financeRoles),
)
export class ExpensesController {
  constructor(
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
  ) {}

  @Get()
  list(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.expenses.list(query, request.staffRoles ?? []);
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.expenses.create(
      body,
      request.authUser!.userId,
      request.staffRoles ?? [],
    );
  }

  @Post(":id/void")
  void(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.expenses.void(
      id,
      body,
      request.authUser!.userId,
      request.staffRoles ?? [],
    );
  }
}
