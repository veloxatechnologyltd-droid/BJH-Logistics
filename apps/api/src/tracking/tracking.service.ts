import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  milestoneTemplates,
  type JobStatus,
  type ServiceLine,
} from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import { JobsService } from "../jobs/jobs.service";
import { normalizeTrackingNumber } from "./tracking-number";

const serviceNames: Record<ServiceLine, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};

const statusNames: Record<JobStatus, string> = {
  open: "In progress",
  in_progress: "In progress",
  on_hold: "On hold",
  ready_to_close: "In progress",
  closed: "Completed",
  cancelled: "Cancelled",
};

/**
 * What anyone holding a tracking number may see: the kind of job, its status,
 * the steps written for customers, and the expected arrival. Nothing else
 * (no company, cargo, parties, documents, money, notes or staff) leaves here;
 * this is the whole list, so a new field is a visible decision.
 */
export interface PublicTracking {
  trackingNumber: string;
  service: string;
  status: string;
  openedAt: string;
  etaAt: string | null;
  steps: Array<{ text: string; done: boolean; occurredAt: string | null }>;
}

@Injectable()
export class TrackingService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  async find(input: unknown): Promise<PublicTracking> {
    const trackingNumber = normalizeTrackingNumber(input);
    // One answer for "malformed" and "no such job", so nothing can be probed.
    const notFound = new NotFoundException("Tracking number not found");
    if (!trackingNumber) throw notFound;
    const job = await this.database.findJobByTrackingNumber(trackingNumber);
    if (!job) throw notFound;

    const [{ events }, etas] = await Promise.all([
      this.jobs.getTimeline(job.id, {}),
      this.database.listEtaEvents(job.id),
    ]);
    // The newest record of a step wins, as on the staff job page.
    const latest = new Map<string, string>();
    for (const event of [...events].sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    )) {
      latest.set(event.milestoneKey, event.occurredAt);
    }
    const steps = milestoneTemplates[job.serviceLine].flatMap((step) => {
      const wording = step.customerMessage ?? step.trackingText;
      return wording
        ? [
            {
              text: `${wording.charAt(0).toUpperCase()}${wording.slice(1)}`,
              done: latest.has(step.key),
              occurredAt: latest.get(step.key) ?? null,
            },
          ]
        : [];
    });
    return {
      trackingNumber: job.trackingNumber,
      service: serviceNames[job.serviceLine],
      status: statusNames[job.status],
      openedAt: job.openedAt,
      etaAt: etas.at(-1)?.etaAt ?? null,
      steps,
    };
  }
}
