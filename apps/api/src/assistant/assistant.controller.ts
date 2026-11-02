import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { UserThrottlerGuard } from "../auth/user-throttler.guard";
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

  /** The signed-in person's own past conversations; nobody sees anyone else's. */
  @Get("conversations")
  conversations(@Req() request: AuthenticatedRequest) {
    return this.assistant.listConversations(request.authUser!.userId);
  }

  @Get("conversations/:id")
  conversation(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.assistant.getConversation(id, request.authUser!.userId);
  }

  @Delete("conversations/:id")
  @HttpCode(204)
  async deleteConversation(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.assistant.deleteConversation(id, request.authUser!.userId);
  }

  /** Each turn can run several model calls, so one person gets 20 a minute. */
  @Post("turn")
  @HttpCode(200)
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  turn(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assistant.turn(body, {
      userId: request.authUser!.userId,
      roles: request.staffRoles ?? [],
    });
  }

  @Post("confirm")
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  confirm(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.assistant.confirm(body, {
      userId: request.authUser!.userId,
      email: request.authUser!.email ?? null,
      roles: request.staffRoles ?? [],
    });
  }
}
