import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  customerContactInputSchema,
  customerContactUpdateSchema,
  customerCompanyUpdateSchema,
  customerActiveDays,
  customerInputSchema,
  isUuid,
  parseContract,
  type CustomerInput,
} from "@bjh/contracts";
import { randomUUID } from "node:crypto";
import { CustomerCompanyRecord, DatabasePort } from "../database/database.port";

@Injectable()
export class CustomersService {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  async create(input: unknown): Promise<CustomerCompanyRecord> {
    const details = this.validate(input);
    const createdAt = new Date().toISOString();

    return this.database.createCustomer({
      id: randomUUID(),
      companyName: details.companyName,
      tradingName: details.tradingName,
      registrationNumber: details.registrationNumber,
      taxNumber: details.taxNumber,
      phone: details.companyPhone,
      companyEmail: details.companyEmail,
      website: details.website,
      businessAddress: details.businessAddress,
      billingAddress: details.billingAddress,
      country: details.country,
      createdAt,
      contacts: [
        {
          id: randomUUID(),
          name: details.contactName,
          role: details.contactRole,
          email: details.email,
          phone: details.phone,
          notify: true,
          isPrimary: true,
          createdAt,
        },
      ],
    });
  }

  list(
    search: unknown,
    companyIds?: string[],
  ): Promise<CustomerCompanyRecord[]> {
    if (search !== undefined && typeof search !== "string") {
      throw new BadRequestException("search must be a string");
    }

    const normalizedSearch = (search ?? "").trim();
    if (normalizedSearch.length > 200) {
      throw new BadRequestException("search must be at most 200 characters");
    }

    return this.database.listCustomers(normalizedSearch, companyIds);
  }

  async get(id: string, companyIds?: string[]): Promise<CustomerCompanyRecord> {
    const customer = await this.database.findCustomer(id, companyIds);
    if (!customer) {
      throw new NotFoundException("Customer was not found");
    }
    return customer;
  }

  /**
   * Account figures per company. Active means an unfinished job or a job
   * opened within `customerActiveDays`. Money stays per currency.
   */
  async insights(companyId?: string) {
    if (companyId !== undefined && !isUuid(companyId)) {
      throw new BadRequestException("companyId must be a valid ID");
    }
    const records = await this.database.listCustomerInsights(companyId ?? null);
    const since = Date.now() - customerActiveDays * 86_400_000;
    return records.map((record) => ({
      ...record,
      active:
        record.activeJobs > 0 ||
        (record.lastJobAt !== null && Date.parse(record.lastJobAt) >= since),
    }));
  }

  async addContact(companyId: string, input: unknown) {
    const parsed = parseContract(customerContactInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const contact = isUuid(companyId)
      ? await this.database.addCustomerContact(companyId, {
          id: randomUUID(),
          name: parsed.data.name,
          role: parsed.data.role,
          email: parsed.data.email,
          phone: parsed.data.phone,
          notify: true,
          isPrimary: parsed.data.isPrimary,
          createdAt: new Date().toISOString(),
        })
      : null;
    if (!contact) throw new NotFoundException("Customer was not found");
    return contact;
  }

  async updateCustomer(companyId: string, input: unknown) {
    const parsed = parseContract(customerCompanyUpdateSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const customer = isUuid(companyId)
      ? await this.database.updateCustomer(companyId, parsed.data)
      : null;
    if (!customer) throw new NotFoundException("Customer was not found");
    return customer;
  }

  async updateContact(companyId: string, contactId: string, input: unknown) {
    const parsed = parseContract(customerContactUpdateSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const contact =
      isUuid(companyId) && isUuid(contactId)
        ? await this.database.updateCustomerContact(
            companyId,
            contactId,
            parsed.data,
          )
        : null;
    if (!contact) throw new NotFoundException("Contact was not found");
    return contact;
  }

  private validate(input: unknown): CustomerInput {
    const result = parseContract(customerInputSchema, input);
    if (!result.success) throw new BadRequestException(result.message);
    return result.data;
  }
}
