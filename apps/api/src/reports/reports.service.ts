import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabasePort, JobScope } from "../database/database.port";
import { WarehouseService } from "../warehouse/warehouse.service";

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}

  async report(query: unknown, scope: JobScope) {
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
    const [jobs, invoices, payments, movements, stock] = await Promise.all([
      this.database.listJobs("", scope),
      this.database.listReportInvoices(from, to, scope),
      this.database.listReportPayments(from, to, scope),
      this.database.listReportStockMovements(from, to, scope),
      this.warehouse.report(to, undefined, scope),
    ]);
    return {
      jobs,
      invoices,
      payments,
      movements,
      asOf: stock.asOf,
      stockBalances: stock.balances,
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
