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
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { hiddenDocumentTypesFor } from "../documents/documents.service";
import { TeamChatService } from "./team-chat.service";
import type { TeamActor } from "./team-chat.service";

/** The signed-in staff member, with the job access they bring to the chat. */
function actorOf(request: AuthenticatedRequest): TeamActor {
  return {
    userId: request.authUser!.userId,
    roles: request.staffRoles ?? [],
    scope: {
      companyIds: request.allowedCompanyIds,
      serviceLines: request.allowedServiceLines,
      hiddenDocumentTypes: hiddenDocumentTypesFor(request.staffRoles),
    },
  };
}

/** Internal team chat: staff only; customers are refused by DepartmentStaffGuard. */
@Controller("api/v1/team-chat")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class TeamChatController {
  constructor(
    @Inject(TeamChatService) private readonly chat: TeamChatService,
  ) {}

  @Get("people")
  people(@Req() request: AuthenticatedRequest) {
    return this.chat.people(request.authUser!.userId);
  }

  @Get("unread")
  unread(@Req() request: AuthenticatedRequest) {
    return this.chat.unread(actorOf(request));
  }

  @Get("tags")
  tags(@Query("q") q: unknown, @Req() request: AuthenticatedRequest) {
    return this.chat.searchTags(actorOf(request), q);
  }

  @Get("conversations")
  conversations(@Req() request: AuthenticatedRequest) {
    return this.chat.conversations(actorOf(request));
  }

  @Post("conversations/direct")
  direct(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.chat.direct(actorOf(request), body);
  }

  @Post("conversations/group")
  group(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.chat.createGroup(actorOf(request), body);
  }

  @Get("conversations/:id")
  open(
    @Param("id") id: string,
    @Query("before") before: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chat.open(actorOf(request), id, before);
  }

  @Post("conversations/:id/messages")
  send(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chat.send(actorOf(request), id, body);
  }

  @Post("conversations/:id/members")
  addMember(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chat.addMember(actorOf(request), id, body);
  }

  @Post("conversations/:id/leave")
  leave(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.chat.leave(actorOf(request), id);
  }
}
