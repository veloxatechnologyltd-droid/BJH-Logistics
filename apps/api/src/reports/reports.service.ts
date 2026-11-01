import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { financeRoles } from "../auth/auth.guards";
import {
  DatabasePort,
  JobScope,
  StaffRoleKey,
} from "../database/database.port";
import { WarehouseService } from "../warehouse/warehouse.service";

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}

  /** Money figures go only to finance and the super admin. */
  async report(query: unknown, scope: JobScope, roles: StaffRoleKey[] = []) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      throw new BadRequestException("from and to dates are required");
    }
    const { from, to } = query as Record<string, unknown>;
    if (!this.isDate(from) || !this.isDate(to)) {
      throw new BadRequestException("from and to must be dates (YYYY-MM-DD)");
    }
    if (from > to) {
      throw new BadRequestException("from must be on or before to");
    }
    const finance = roles.some((role) => financeRoles.includes(role));
    const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [
      jobs,
      invoices,
      payments,
      movements,
      stock,
      salesAndService,
      conversions,
    ] = await Promise.all([
      this.database.listJobs("", scope),
      finance ? this.database.listReportInvoices(from, to, scope) : [],
      finance ? this.database.listReportPayments(from, to, scope) : [],
      this.database.listReportStockMovements(from, to, scope),
      this.warehouse.report(to, undefined, scope),
      this.database.reportSalesAndService(from, to),
      this.database.salesPeriod(from, nextDay),
    ]);
    return {
      finance,
      jobs,
      invoices,
      payments,
      movements,
      asOf: stock.asOf,
      stockBalances: stock.balances,
      sales: {
        newLeads: salesAndService.newLeads,
        leadsBySource: salesAndService.leadsBySource,
        pipeline: salesAndService.pipeline,
        converted: conversions.converted,
        convertedCompanies: conversions.convertedCompanies,
      },
      service: {
        requestsBySource: salesAndService.requestsBySource,
        inquiries: salesAndService.inquiries,
        inquiriesAnswered: salesAndService.inquiriesAnswered,
        quotesIssued: salesAndService.quotesIssued,
        quotesAccepted: salesAndService.quotesAccepted,
        quotesRejected: salesAndService.quotesRejected,
        medianHoursToQuote: salesAndService.medianHoursToQuote,
        waitingForQuote: salesAndService.waitingForQuote,
      },
    };
  }

  private isDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }
}
