import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { AssistantService } from "./assistant.service";

/** The staff helper; customers never reach it. */
@Controller("api/v1/assistant")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class AssistantController {
  constructor(
    @Inject(AssistantService) private readonly assistant: AssistantService,
  ) {}

  @Get()
  status() {
    return { enabled: this.assistant.enabled };
  }

  @Post("turn")
  @HttpCode(200)
  turn(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assistant.turn(body, {
      userId: request.authUser!.userId,
      roles: request.staffRoles ?? [],
    });
  }

  @Post("confirm")
  confirm(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assistant.confirm(body, {
      userId: request.authUser!.userId,
      email: request.authUser!.email ?? null,
      roles: request.staffRoles ?? [],
    });
  }
}
