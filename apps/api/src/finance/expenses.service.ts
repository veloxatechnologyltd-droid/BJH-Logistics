import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  expenseCategoryGroups,
  expenseGroupOf,
  expenseInputSchema,
  expenseQuerySchema,
  expenseVoidInputSchema,
  isUuid,
  parseContract,
  restrictedExpenseGroups,
} from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type {
  BusinessExpenseRecord,
  StaffRoleKey,
} from "../database/database.port";

export interface ExpenseList {
  expenses: BusinessExpenseRecord[];
  /** True when more match than are listed (the newest are shown). */
  limited: boolean;
  /** Live (not voided) totals of everything matching, one per currency. */
  totals: Array<{ currency: string; amountMinor: number; count: number }>;
  /** Live totals per category and currency, biggest first. */
  byCategory: Array<{
    category: string;
    currency: string;
    amountMinor: number;
  }>;
  /** Whether this person sees and records payroll (salaries). */
  canSeePayroll: boolean;
}

/** The most entries one list returns; totals always cover everything matching. */
const LIST_LIMIT = 2000;

const canSeePayroll = (roles: readonly StaffRoleKey[]) =>
  roles.includes("super_admin");

/** Every category this person may see. */
const visibleCategories = (roles: readonly StaffRoleKey[]) =>
  expenseCategoryGroups
    .filter(
      (group) =>
        canSeePayroll(roles) || !restrictedExpenseGroups.includes(group.key),
    )
    .flatMap((group) =>
      group.categories.map((entry) => ({
        group: group.key as string,
        key: entry.key as string,
      })),
    );

/**
 * Business expenses: the cost of running BJH, not tied to a client's job.
 * Payroll (salaries and the like) is the super admin's alone: for anyone else
 * it is neither listed, counted, recorded nor voided. A wrong entry is voided
 * with a reason and stays on record.
 */
@Injectable()
export class ExpensesService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  async list(query: unknown, roles: StaffRoleKey[]): Promise<ExpenseList> {
    const parsed = parseContract(expenseQuerySchema, query);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const filter = parsed.data;
    const categories = visibleCategories(roles)
      .filter((entry) => !filter.group || entry.group === filter.group)
      .map((entry) => entry.key)
      .filter((key) => !filter.category || key === filter.category);
    const databaseFilter = {
      from: filter.from,
      to: filter.to,
      categories,
      paymentMethod: filter.paymentMethod,
      currency: filter.currency,
      search: filter.search,
      includeVoided: filter.includeVoided,
    };
    const [expenses, sums] =
      categories.length === 0
        ? [[], []]
        : await Promise.all([
            this.database.listBusinessExpenses(databaseFilter),
            this.database.sumBusinessExpenses(databaseFilter),
          ]);

    const totals = new Map<string, { amountMinor: number; count: number }>();
    for (const sum of sums) {
      const total = totals.get(sum.currency) ?? { amountMinor: 0, count: 0 };
      total.amountMinor += sum.amountMinor;
      total.count += sum.count;
      totals.set(sum.currency, total);
    }
    return {
      expenses,
      limited: expenses.length >= LIST_LIMIT,
      totals: [...totals]
        .map(([currency, total]) => ({ currency, ...total }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      byCategory: sums
        .map(({ category, currency, amountMinor }) => ({
          category,
          currency,
          amountMinor,
        }))
        .sort((a, b) => b.amountMinor - a.amountMinor),
      canSeePayroll: canSeePayroll(roles),
    };
  }

  /**
   * All live business expenses per currency, for the finance overview's
   * profit, and per month from `monthsFrom` (a "YYYY-MM") for its chart.
   * Without payroll for anyone but the super admin, and it says so.
   */
  async totalsByCurrency(
    roles: StaffRoleKey[],
    monthsFrom: string,
  ): Promise<{
    totals: Array<{ currency: string; amountMinor: number }>;
    months: Array<{ month: string; currency: string; amountMinor: number }>;
    includesPayroll: boolean;
  }> {
    const categories = visibleCategories(roles).map((entry) => entry.key);
    const [sums, months] = await Promise.all([
      this.database.sumBusinessExpenses({
        from: null,
        to: null,
        categories,
        paymentMethod: null,
        currency: null,
        search: null,
        includeVoided: false,
      }),
      this.database.sumBusinessExpensesByMonth(categories, `${monthsFrom}-01`),
    ]);
    const totals = new Map<string, number>();
    for (const sum of sums) {
      totals.set(
        sum.currency,
        (totals.get(sum.currency) ?? 0) + sum.amountMinor,
      );
    }
    return {
      totals: [...totals].map(([currency, amountMinor]) => ({
        currency,
        amountMinor,
      })),
      months,
      includesPayroll: canSeePayroll(roles),
    };
  }

  async create(
    input: unknown,
    recordedBy: string,
    roles: StaffRoleKey[],
  ): Promise<BusinessExpenseRecord> {
    const parsed = parseContract(expenseInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const expense = parsed.data;
    if (!this.allowed(expense.category, roles)) {
      throw new ForbiddenException("Only the super admin records payroll");
    }
    return this.database.createBusinessExpense({ ...expense, recordedBy });
  }

  async void(
    id: string,
    input: unknown,
    voidedBy: string,
    roles: StaffRoleKey[],
  ): Promise<BusinessExpenseRecord> {
    const parsed = parseContract(expenseVoidInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const category = isUuid(id)
      ? await this.database.businessExpenseCategory(id)
      : null;
    // Payroll the caller may not see is reported as missing, not forbidden.
    if (!category || !this.allowed(category, roles)) {
      throw new NotFoundException("Expense was not found");
    }
    const result = await this.database.voidBusinessExpense(
      id,
      voidedBy,
      parsed.data.reason,
    );
    if (result === null) throw new NotFoundException("Expense was not found");
    if (result === "voided") {
      throw new ConflictException("This expense is already voided");
    }
    return result;
  }

  private allowed(category: string, roles: StaffRoleKey[]): boolean {
    const group = expenseGroupOf(category);
    return (
      canSeePayroll(roles) || !group || !restrictedExpenseGroups.includes(group)
    );
  }
}
