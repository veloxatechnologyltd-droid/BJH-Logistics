import { Controller, Get, Inject, Query, Res, UseGuards } from "@nestjs/common";
import {
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import { StatementsService } from "./statements.service";

/** The part of the Express response the PDF route writes to. */
interface BinaryResponse {
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
}

/** Statements of account: staff only; `companyId` is required, `from` and `to` (YYYY-MM-DD) are optional. */
@Controller("api/v1/finance/statements")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class StatementsController {
  constructor(
    @Inject(StatementsService) private readonly statements: StatementsService,
  ) {}

  @Get()
  statement(@Query() query: Record<string, unknown>) {
    return this.statements.statement(query);
  }

  @Get("pdf")
  async pdf(
    @Query() query: Record<string, unknown>,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.statements.pdf(query);
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }
}
