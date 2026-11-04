import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { TransportService } from "./transport.service";

/** The part of the Express response the PDF route writes to. */
interface BinaryResponse {
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
}

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

/** Driver records: any active staff member reads and manages them. */
@Controller("api/v1/drivers")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class DriversController {
  constructor(
    @Inject(TransportService) private readonly transport: TransportService,
  ) {}

  @Get()
  list() {
    return this.transport.listDrivers();
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.transport.createDriver(body, request.authUser!.userId);
  }

  @Post(":id/active")
  setActive(@Param("id") id: string, @Body() body: unknown) {
    return this.transport.setDriverActive(id, body);
  }
}

@Controller("api/v1/vehicles")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class VehiclesController {
  constructor(
    @Inject(TransportService) private readonly transport: TransportService,
  ) {}

  @Get()
  list() {
    return this.transport.listVehicles();
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.transport.createVehicle(body, request.authUser!.userId);
  }

  /** Registration, description, insurance, DVLA and servicing. */
  @Put(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.transport.updateVehicle(id, body);
  }

  @Post(":id/active")
  setActive(@Param("id") id: string, @Body() body: unknown) {
    return this.transport.setVehicleActive(id, body);
  }
}

/** Waybills and proofs of delivery: customers read their own company's. */
@Controller("api/v1/jobs/:id/deliveries")
@UseGuards(SupabaseIdentityGuard)
export class DeliveriesController {
  constructor(
    @Inject(TransportService) private readonly transport: TransportService,
  ) {}

  @Get()
  @UseGuards(JobScopeGuard)
  list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.transport.listDeliveries(id, scopeOf(request));
  }

  @Get(":deliveryId/pdf")
  @UseGuards(JobScopeGuard)
  async pdf(
    @Param("id") id: string,
    @Param("deliveryId") deliveryId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: BinaryResponse,
  ): Promise<void> {
    const { file, filename } = await this.transport.waybillPdf(
      id,
      deliveryId,
      scopeOf(request),
    );
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `inline; filename="${filename}"`);
    response.setHeader("content-length", String(file.length));
    response.end(file);
  }

  @Post()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  dispatch(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.transport.dispatch(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post(":deliveryId/proof")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  recordProof(
    @Param("id") id: string,
    @Param("deliveryId") deliveryId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.transport.recordProofOfDelivery(
      id,
      deliveryId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}
