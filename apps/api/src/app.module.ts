import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ActivityController } from "./activity/activity.controller";
import { ActivityLogMiddleware } from "./activity/activity.middleware";
import { RequestErrorFilter } from "./request-error.filter";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";
import {
  DocumentLibraryController,
  DocumentsController,
} from "./documents/documents.controller";
import { DocumentsService } from "./documents/documents.service";
import { ExtractionsController } from "./documents/extractions.controller";
import { ExtractionsService } from "./documents/extractions.service";
import {
  DOCUMENT_STORAGE,
  SupabaseDocumentStorage,
} from "./documents/document-storage.port";
import {
  JobDetailsController,
  TasksController,
} from "./jobs/job-details.controller";
import { JobDetailsService } from "./jobs/job-details.service";
import { JobCorrespondenceController } from "./jobs/job-correspondence.controller";
import { JobCorrespondenceService } from "./jobs/job-correspondence.service";
import {
  AdminNotificationsController,
  ClientMessagesController,
  JobMessagesController,
} from "./notifications/notifications.controller";
import { NotificationDispatcher } from "./notifications/notification-dispatcher.service";
import { NotificationsService } from "./notifications/notifications.service";
import {
  EMAIL_PROVIDER,
  SMS_PROVIDER,
  createEmailProvider,
  createSmsProvider,
} from "./notifications/providers";
import { JobsController } from "./jobs/jobs.controller";
import { JobsService } from "./jobs/jobs.service";
import { CustomersController } from "./customers/customers.controller";
import { CustomersService } from "./customers/customers.service";
import { LeadsController } from "./leads/leads.controller";
import { LeadsService } from "./leads/leads.service";
import { QuoteRequestsController } from "./quotations/quote-requests.controller";
import { QuoteRequestsService } from "./quotations/quote-requests.service";
import { SettingsController } from "./settings/settings.controller";
import { SettingsService } from "./settings/settings.service";
import { JobChargesController } from "./finance/job-charges.controller";
import { JobChargesService } from "./finance/job-charges.service";
import {
  InvoicesController,
  FinanceSummaryController,
  OutstandingInvoicesController,
} from "./finance/invoices.controller";
import { InvoicesService } from "./finance/invoices.service";
import {
  DeliveriesController,
  DriversController,
  VehiclesController,
} from "./transport/transport.controller";
import { TransportDocumentsController } from "./transport/transport-documents.controller";
import { TransportDocumentsService } from "./transport/transport-documents.service";
import { TransportService } from "./transport/transport.service";
import {
  JobStockController,
  StockReportController,
  WarehouseLocationsController,
} from "./warehouse/warehouse.controller";
import { WarehouseService } from "./warehouse/warehouse.service";
import { QuotesController } from "./quotations/quotes.controller";
import { QuotesService } from "./quotations/quotes.service";

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 30 }]),
    DatabaseModule,
    AuthModule,
  ],
  controllers: [
    HealthController,
    QuoteRequestsController,
    QuotesController,
    SettingsController,
    CustomersController,
    LeadsController,
    JobsController,
    JobDetailsController,
    JobCorrespondenceController,
    AdminNotificationsController,
    JobMessagesController,
    ClientMessagesController,
    JobChargesController,
    InvoicesController,
    OutstandingInvoicesController,
    FinanceSummaryController,
    DriversController,
    VehiclesController,
    DeliveriesController,
    TransportDocumentsController,
    WarehouseLocationsController,
    JobStockController,
    StockReportController,
    TasksController,
    DocumentsController,
    DocumentLibraryController,
    ExtractionsController,
    ActivityController,
  ],
  providers: [
    QuoteRequestsService,
    QuotesService,
    SettingsService,
    CustomersService,
    LeadsService,
    JobsService,
    JobDetailsService,
    JobCorrespondenceService,
    NotificationsService,
    NotificationDispatcher,
    {
      provide: EMAIL_PROVIDER,
      useFactory: () => createEmailProvider(process.env),
    },
    { provide: SMS_PROVIDER, useFactory: () => createSmsProvider(process.env) },
    JobChargesService,
    InvoicesService,
    TransportService,
    TransportDocumentsService,
    WarehouseService,
    DocumentsService,
    ExtractionsService,
    { provide: DOCUMENT_STORAGE, useClass: SupabaseDocumentStorage },
    ActivityLogMiddleware,
    { provide: APP_FILTER, useClass: RequestErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActivityLogMiddleware).forRoutes("*");
  }
}
