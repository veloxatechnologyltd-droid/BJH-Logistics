import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  chargeActualInputSchema,
  chargeImportInputSchema,
  isUuid,
  jobChargeInputSchema,
  parseContract,
} from "@bjh/contracts";
import {
  ChargeActualRecord,
  DatabasePort,
  JobChargeRecord,
  JobRecord,
  JobScope,
} from "../database/database.port";
import { JobsService } from "../jobs/jobs.service";

export interface JobChargeView extends JobChargeRecord {
  /** Quantity times the quoted unit amount; null when quoted "at cost". */
  quotedTotalMinor: number | null;
  /** The newest actual entry, in the currency staff recorded. */
  currentActual: ChargeActualRecord | null;
  /** Current actual minus quoted total, when both are known. */
  varianceMinor: number | null;
  /** A disbursement with a recorded amount but no supplier document. */
  evidenceMissing: boolean;
}

export interface CurrencyTotals {
  currency: string;
  quotedMinor: number;
  /** Actuals comparable in this charge currency; excludes unconverted GHS costs. */
  actualMinor: number;
  chargesWithoutActual: number;
  disbursementsWithoutEvidence: number;
}

/**
 * Charges on a job: quoted vs actual, disbursements with their supplier
 * evidence. New actual costs are recorded in GHS without conversion.
 * Staff only; customers never see these internal figures.
 */
@Injectable()
export class JobChargesService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  async list(
    id: string,
    scope: JobScope,
  ): Promise<{ charges: JobChargeView[]; totals: CurrencyTotals[] }> {
    const job = await this.jobs.get(id, scope);
    const charges = (await this.database.listJobCharges(job.id)).map((charge) =>
      this.view(charge),
    );
    const totals = new Map<string, CurrencyTotals>();
    for (const charge of charges) {
      const entry = totals.get(charge.currency) ?? {
        currency: charge.currency,
        quotedMinor: 0,
        actualMinor: 0,
        chargesWithoutActual: 0,
        disbursementsWithoutEvidence: 0,
      };
      entry.quotedMinor += charge.quotedTotalMinor ?? 0;
      entry.actualMinor += charge.currentActual?.convertedMinor ?? 0;
      if (!charge.currentActual) entry.chargesWithoutActual += 1;
      if (charge.evidenceMissing) entry.disbursementsWithoutEvidence += 1;
      totals.set(charge.currency, entry);
    }
    return { charges, totals: [...totals.values()] };
  }

  async create(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<JobChargeView> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(jobChargeInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    await this.requireConfiguredCurrency(parsed.data.currency);
    const charge = await this.database.createJobCharge({
      jobId: job.id,
      ...parsed.data,
      quoteLineId: null,
      quoteContainerSize: null,
      createdBy,
    });
    return this.view(charge!);
  }

  /**
   * Copies the lines of the accepted quote onto the job as charges. Lines that
   * are already on the job are skipped, so repeating the import is harmless.
   */
  async importFromQuote(
    id: string,
    input: unknown,
    createdBy: string,
    scope: JobScope,
  ): Promise<{ created: JobChargeView[]; skipped: number }> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(chargeImportInputSchema, input ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const quote = await this.database.findAcceptedQuoteLines(job.id);
    if (!quote) {
      throw new ConflictException(
        "This job was not opened from an accepted quote",
      );
    }
    const { containerSize, quantity } = parsed.data;

    const sizeAt = containerSize
      ? quote.sizeLabels.findIndex(
          (label) => label.toLowerCase() === containerSize.toLowerCase(),
        )
      : -1;
    if (containerSize && quote.sizeLabels.length > 0 && sizeAt === -1) {
      throw new BadRequestException(
        `containerSize must be one of: ${quote.sizeLabels.join(", ")}`,
      );
    }

    const planned = quote.lines.map((line) => {
      const sized = line.sizeAmountsMinor !== null;
      if (sized && containerSize === null) {
        throw new BadRequestException(
          `containerSize (${quote.sizeLabels.join(" or ")}) is required: this quote prices by container size`,
        );
      }
      const unit = line.sizeAmountsMinor
        ? line.sizeAmountsMinor[sizeAt]
        : line.amountMinor;
      return {
        // Third-party "at cost" lines are pass-through costs.
        kind:
          line.basis === "at_cost"
            ? ("disbursement" as const)
            : ("service" as const),
        description: line.description,
        currency: quote.currency,
        // A line that states its own quantity keeps it; otherwise a per-container
        // line takes the number of containers given when importing.
        quantity:
          line.quantity > 1
            ? line.quantity
            : line.basis === "per_container"
              ? quantity
              : 1,
        unitQuotedMinor: unit,
        quoteLineId: line.id,
        quoteContainerSize: line.sizeAmountsMinor ? containerSize : null,
      };
    });

    const created: JobChargeView[] = [];
    for (const charge of planned) {
      const record = await this.database.createJobCharge({
        jobId: job.id,
        ...charge,
        createdBy,
      });
      if (record) created.push(this.view(record));
    }
    return { created, skipped: planned.length - created.length };
  }

  async remove(
    id: string,
    chargeId: string,
    removedBy: string,
    scope: JobScope,
  ): Promise<{ removed: true }> {
    const job = await this.editableJob(id, scope);
    const result = isUuid(chargeId)
      ? await this.database.removeJobCharge(job.id, chargeId, removedBy)
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Charge was not found on this job");
    }
    if (result === "has_actuals") {
      throw new ConflictException(
        "A charge with a recorded actual amount cannot be removed",
      );
    }
    return { removed: true };
  }

  /** Append-only: the newest entry is current; a correction is a new entry. */
  async recordActual(
    id: string,
    chargeId: string,
    input: unknown,
    recordedBy: string,
    scope: JobScope,
  ): Promise<ChargeActualRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(chargeActualInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const data = parsed.data;

    const charge = isUuid(chargeId)
      ? (await this.database.listJobCharges(job.id)).find(
          (item) => item.id === chargeId,
        )
      : undefined;
    if (!charge)
      throw new NotFoundException("Charge was not found on this job");

    if (data.currency !== "GHS") {
      throw new BadRequestException("Record actual amounts in GHS");
    }
    if (data.exchangeRate !== null || data.rateNote !== null) {
      throw new BadRequestException("Exchange rates are not recorded here");
    }

    const result = await this.database.appendChargeActual({
      jobId: job.id,
      chargeId: charge.id,
      ...data,
      convertedMinor:
        data.currency === charge.currency ? data.amountMinor : null,
      recordedBy,
    });
    if (result === "charge_not_found") {
      throw new NotFoundException("Charge was not found on this job");
    }
    if (result === "document_invalid") {
      throw new BadRequestException(
        "supplierDocumentId must be a supplier invoice or disbursement evidence on this job",
      );
    }
    if (result === "correction_not_found") {
      throw new NotFoundException(
        "The amount being corrected was not found on this charge",
      );
    }
    return result;
  }

  private view(charge: JobChargeRecord): JobChargeView {
    const quotedTotalMinor =
      charge.unitQuotedMinor === null
        ? null
        : charge.unitQuotedMinor * charge.quantity;
    const currentActual = charge.actuals[charge.actuals.length - 1] ?? null;
    return {
      ...charge,
      quotedTotalMinor,
      currentActual,
      varianceMinor:
        currentActual &&
        currentActual.convertedMinor !== null &&
        quotedTotalMinor !== null
          ? currentActual.convertedMinor - quotedTotalMinor
          : null,
      evidenceMissing:
        charge.kind === "disbursement" &&
        currentActual !== null &&
        currentActual.supplierDocumentId === null,
    };
  }

  private async editableJob(id: string, scope: JobScope): Promise<JobRecord> {
    const job = await this.jobs.get(id, scope);
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before changing it");
    }
    return job;
  }

  /** Once Settings exist, charges may only use its configured currencies. */
  private async requireConfiguredCurrency(currency: string): Promise<void> {
    const current = await this.database.getBusinessSettings();
    if (current && !current.settings.currencies.includes(currency)) {
      throw new BadRequestException(
        `currency must be one of the configured currencies: ${current.settings.currencies.join(", ")}`,
      );
    }
  }
}
