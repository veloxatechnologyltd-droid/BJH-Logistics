import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { knowledgeEntryInputSchema, parseContract } from "@bjh/contracts";
import {
  DepartmentStaffGuard,
  SuperAdminGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { DatabasePort } from "../database/database.port";

function parse(body: unknown) {
  const parsed = parseContract(knowledgeEntryInputSchema, body);
  if (!parsed.success) throw new BadRequestException(parsed.message);
  return parsed.data;
}

/**
 * The knowledge base the assistant answers inquiries from: one topic and its
 * answer per entry. Staff may read it; only the super admin changes it.
 */
@Controller("api/v1/knowledge")
@UseGuards(SupabaseIdentityGuard)
export class KnowledgeController {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  @Get()
  @UseGuards(DepartmentStaffGuard)
  list() {
    return this.database.listKnowledgeEntries();
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.database.createKnowledgeEntry({
      ...parse(body),
      updatedBy: request.authUser!.userId,
    });
  }

  @Put(":id")
  @UseGuards(SuperAdminGuard)
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const updated = await this.database.updateKnowledgeEntry(id, {
      ...parse(body),
      updatedBy: request.authUser!.userId,
    });
    if (!updated) throw new NotFoundException("Knowledge entry was not found");
    return updated;
  }

  @Delete(":id")
  @UseGuards(SuperAdminGuard)
  @HttpCode(204)
  async remove(@Param("id") id: string) {
    if (!(await this.database.deleteKnowledgeEntry(id))) {
      throw new NotFoundException("Knowledge entry was not found");
    }
  }
}
