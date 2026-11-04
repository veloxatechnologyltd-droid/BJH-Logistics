import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  activeInputSchema,
  deliveryInputSchema,
  driverInputSchema,
  isUuid,
  parseContract,
  proofOfDeliveryInputSchema,
  vehicleInputSchema,
} from "@bjh/contracts";
import {
  DatabasePort,
  DeliveryRecord,
  DriverRecord,
  JobRecord,
  JobScope,
  VehicleRecord,
} from "../database/database.port";
import { JobsService } from "../jobs/jobs.service";
import {
  deliveryDeliveredMessage,
  deliveryDispatchedMessage,
} from "../notifications/notification-messages";
import { NotificationsService } from "../notifications/notifications.service";
import { renderWaybillPdf } from "./waybill-pdf";

/**
 * Drivers and vehicles are plain records staff assign (drivers do not sign in).
 * A delivery is a numbered waybill on a job with a proof of delivery recorded
 * once; the driver, vehicle and cargo are frozen onto it at dispatch.
 */
@Injectable()
export class TransportService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  listDrivers(): Promise<DriverRecord[]> {
    return this.database.listDrivers();
  }

  async createDriver(input: unknown, createdBy: string): Promise<DriverRecord> {
    const parsed = parseContract(driverInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    return this.database.createDriver(parsed.data, createdBy);
  }

  async setDriverActive(id: string, input: unknown): Promise<DriverRecord> {
    const parsed = parseContract(activeInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const driver = isUuid(id)
      ? await this.database.setDriverActive(id, parsed.data.active)
      : null;
    if (!driver) throw new NotFoundException("Driver was not found");
    return driver;
  }

  listVehicles(): Promise<VehicleRecord[]> {
    return this.database.listVehicles();
  }

  async createVehicle(
    input: unknown,
    createdBy: string,
  ): Promise<VehicleRecord> {
    const parsed = parseContract(vehicleInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = await this.database.createVehicle(parsed.data, createdBy);
    if (result === "duplicate_registration") {
      throw new ConflictException("A vehicle with this registration exists");
    }
    return result;
  }

  async updateVehicle(id: string, input: unknown): Promise<VehicleRecord> {
    const parsed = parseContract(vehicleInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = isUuid(id)
      ? await this.database.updateVehicle(id, parsed.data)
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Vehicle was not found");
    }
    if (result === "duplicate_registration") {
      throw new ConflictException("A vehicle with this registration exists");
    }
    return result;
  }

  async setVehicleActive(id: string, input: unknown): Promise<VehicleRecord> {
    const parsed = parseContract(activeInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const vehicle = isUuid(id)
      ? await this.database.setVehicleActive(id, parsed.data.active)
      : null;
    if (!vehicle) throw new NotFoundException("Vehicle was not found");
    return vehicle;
  }

  async listDeliveries(id: string, scope: JobScope): Promise<DeliveryRecord[]> {
    const job = await this.jobs.get(id, scope);
    return this.database.listDeliveries(job.id);
  }

  async dispatch(
    id: string,
    input: unknown,
    dispatchedBy: string,
    scope: JobScope,
  ): Promise<DeliveryRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(deliveryInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const result = await this.database.createDelivery(
      { jobId: job.id, ...parsed.data },
      dispatchedBy,
      new Date().getUTCFullYear(),
    );
    if (result === "driver_unavailable") {
      throw new BadRequestException("driverId must be an active driver");
    }
    if (result === "vehicle_unavailable") {
      throw new BadRequestException("vehicleId must be an active vehicle");
    }
    await this.notifications.notify({
      companyId: job.customerCompanyId,
      jobId: job.id,
      event: "delivery_dispatched",
      dedupeKey: `delivery-dispatched:${result.id}`,
      message: (sender) =>
        deliveryDispatchedMessage(
          sender,
          result.waybillNumber,
          result.driverName,
          result.driverPhone,
          result.vehicleRegistration,
          result.deliveryAddress,
        ),
      linkPath: `/jobs/${job.id}`,
      createdBy: dispatchedBy,
    });
    return result;
  }

  /** Printable waybill; the receiver block fills in once proof is recorded. */
  async waybillPdf(
    id: string,
    deliveryId: string,
    scope: JobScope,
  ): Promise<{ file: Buffer; filename: string }> {
    const job = await this.jobs.get(id, scope);
    const delivery = (await this.database.listDeliveries(job.id)).find(
      (item) => item.id === deliveryId,
    );
    if (!delivery) {
      throw new NotFoundException("Delivery was not found on this job");
    }
    const [parties, references, settings] = await Promise.all([
      this.database.listJobParties(job.id),
      this.database.listShipmentReferences(job.id),
      this.database.getBusinessSettings(),
    ]);
    const file = await renderWaybillPdf({
      delivery,
      job,
      parties,
      references,
      settings: settings?.settings ?? null,
    });
    const base = delivery.waybillNumber.replace(/[^A-Za-z0-9-]+/g, "-");
    return { file, filename: `waybill-${base}.pdf` };
  }

  /** Recorded once; the delivery time defaults to now and cannot be future. */
  async recordProofOfDelivery(
    id: string,
    deliveryId: string,
    input: unknown,
    recordedBy: string,
    scope: JobScope,
  ): Promise<DeliveryRecord> {
    const job = await this.editableJob(id, scope);
    const parsed = parseContract(proofOfDeliveryInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const now = Date.now();
    const deliveredAt = parsed.data.deliveredAt ?? new Date(now).toISOString();
    if (Date.parse(deliveredAt) > now + 5 * 60_000) {
      throw new BadRequestException("deliveredAt cannot be in the future");
    }
    const result = isUuid(deliveryId)
      ? await this.database.recordProofOfDelivery(
          job.id,
          deliveryId,
          { ...parsed.data, deliveredAt },
          recordedBy,
        )
      : "not_found";
    if (result === "not_found") {
      throw new NotFoundException("Delivery was not found on this job");
    }
    if (result === "already_delivered") {
      throw new ConflictException(
        "The proof of delivery is already recorded for this waybill",
      );
    }
    if (result === "document_invalid") {
      throw new BadRequestException(
        "podDocumentId must be a delivery note document on this job",
      );
    }
    await this.notifications.notify({
      companyId: job.customerCompanyId,
      jobId: job.id,
      event: "delivery_delivered",
      dedupeKey: `delivery-proof:${result.id}`,
      message: (sender) =>
        deliveryDeliveredMessage(
          sender,
          result.waybillNumber,
          result.receiverName ?? "the receiver",
        ),
      linkPath: `/jobs/${job.id}`,
      createdBy: recordedBy,
    });
    return result;
  }

  private async editableJob(id: string, scope: JobScope): Promise<JobRecord> {
    const job = await this.jobs.get(id, scope);
    if (job.status === "closed" || job.status === "cancelled") {
      throw new ConflictException("Reopen the job before changing it");
    }
    return job;
  }
}
