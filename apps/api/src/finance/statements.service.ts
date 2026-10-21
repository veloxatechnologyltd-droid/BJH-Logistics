import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { parseContract, statementQuerySchema } from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import { buildStatement } from "./statement";
import type { StatementSection } from "./statement";
import { renderStatementPdf } from "./statement-pdf";

export interface StatementView {
  company: { id: string; name: string; customerNumber: string | null };
  /** YYYY-MM-DD, or null for the beginning. */
  from: string | null;
  /** YYYY-MM-DD, or null for up to today. */
  to: string | null;
  generatedOn: string;
  sections: StatementSection[];
}

/**
 * A customer's statement of account: every issued invoice and standing payment
 * across their jobs, one section per currency. Staff only, and every staff
 * member may read any customer's statement (the same reach as the customer
 * page's money figures); customers do not see it.
 */
@Injectable()
export class StatementsService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  async statement(query: unknown): Promise<StatementView> {
    const parsed = parseContract(statementQuerySchema, query);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { companyId, from, to } = parsed.data;
    const company = await this.database.findCustomer(companyId);
    if (!company) throw new NotFoundException("Customer was not found");
    const entries = await this.database.listStatementEntries(companyId);
    return {
      company: {
        id: company.id,
        name: company.companyName,
        customerNumber: company.customerNumber ?? null,
      },
      from,
      to,
      generatedOn: new Date().toISOString().slice(0, 10),
      sections: buildStatement(entries, { from, to }),
    };
  }

  async pdf(query: unknown): Promise<{ file: Buffer; filename: string }> {
    const statement = await this.statement(query);
    const settings = await this.database.getBusinessSettings();
    const file = await renderStatementPdf({
      statement,
      settings: settings?.settings ?? null,
    });
    const name = statement.company.name
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return {
      file,
      filename: `statement-${name || "customer"}-${statement.generatedOn}.pdf`,
    };
  }
}
