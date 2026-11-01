import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthController } from "./auth.controller";
import { AdminCompanyMembershipsController } from "./admin-company-memberships.controller";
import { AdminCompanyMembershipsService } from "./admin-company-memberships.service";
import { AdminCustomerAccountsController } from "./admin-customer-accounts.controller";
import { AdminCustomerAccountsService } from "./admin-customer-accounts.service";
import { AdminStaffController } from "./admin-staff.controller";
import { AdminStaffService } from "./admin-staff.service";
import {
  CompanyScopeGuard,
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
  StaffCompanyReadGuard,
  SuperAdminGuard,
} from "./auth.guards";
import { AuthService } from "./auth.service";
import { SupabaseAuthVerifier } from "./supabase-auth-verifier";
import {
  STAFF_AUTH_DIRECTORY,
  SupabaseStaffAuthDirectory,
} from "./staff-admin.port";

@Module({
  imports: [DatabaseModule],
  controllers: [
    AuthController,
    AdminStaffController,
    AdminCompanyMembershipsController,
    AdminCustomerAccountsController,
  ],
  providers: [
    AuthService,
    SupabaseAuthVerifier,
    AdminStaffService,
    AdminCompanyMembershipsService,
    AdminCustomerAccountsService,
    SupabaseStaffAuthDirectory,
    { provide: STAFF_AUTH_DIRECTORY, useExisting: SupabaseStaffAuthDirectory },
    SupabaseIdentityGuard,
    StaffCompanyReadGuard,
    SuperAdminGuard,
    CompanyScopeGuard,
    DepartmentStaffGuard,
  ],
  exports: [
    STAFF_AUTH_DIRECTORY,
    SupabaseAuthVerifier,
    SupabaseIdentityGuard,
    SuperAdminGuard,
    CompanyScopeGuard,
    DepartmentStaffGuard,
    StaffCompanyReadGuard,
  ],
})
export class AuthModule {}
