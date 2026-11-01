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
  StaffCompanyReadGuard,
  StaffRolesGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { ChatService } from "./chat.service";

/** Customer service speaks for BJH in client conversations (client meeting, 2026-11-01). */
const chatRoles = StaffRolesGuard(["super_admin", "customer_service_rep"]);

@Controller("api/v1/chat")
@UseGuards(SupabaseIdentityGuard)
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Get("threads")
  @UseGuards(chatRoles)
  threads() {
    return this.chat.threads();
  }

  @Get("threads/:companyId")
  @UseGuards(chatRoles)
  thread(@Param("companyId") companyId: string) {
    return this.chat.thread(companyId);
  }

  @Post("threads/:companyId")
  @UseGuards(chatRoles)
  reply(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chat.reply(companyId, body, {
      userId: request.authUser!.userId,
      email: request.authUser!.email ?? null,
    });
  }

  /** The signed-in customer's own conversation. */
  @Get("mine")
  @UseGuards(StaffCompanyReadGuard)
  mine(
    @Query("companyId") companyId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chat.mine(request.allowedCompanyIds, companyId);
  }

  @Post("mine")
  @UseGuards(StaffCompanyReadGuard)
  sendMine(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.chat.sendMine(
      body,
      {
        userId: request.authUser!.userId,
        email: request.authUser!.email ?? null,
      },
      request.allowedCompanyIds,
    );
  }
}
