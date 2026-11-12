import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
interface HtmlResponse {
  type(contentType: string): { send(body: string): unknown };
}
import { DatabasePort } from "../database/database.port";
import {
  salesUnsubscribeEmail,
  salesUnsubscribeSetup,
} from "./sales-unsubscribe";

@Controller("api/v1/sales/unsubscribe")
export class SalesUnsubscribeController {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  private address(token: string) {
    const setup = salesUnsubscribeSetup(process.env);
    if (!setup)
      throw new ServiceUnavailableException("Unsubscribe is unavailable");
    const email = salesUnsubscribeEmail(token, setup.key);
    if (!email) throw new BadRequestException("Invalid unsubscribe link");
    return email;
  }

  @Get(":token")
  page(@Param("token") token: string, @Res() response: HtmlResponse) {
    this.address(token);
    response
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe from BJH Logistics sales email</title><main style="max-width:34rem;margin:4rem auto;padding:1rem;font:1rem system-ui"><h1>Stop sales emails</h1><p>Confirm to stop emails from the BJH Logistics sales mailbox.</p><form method="post"><button name="confirm" value="yes" style="padding:.75rem 1rem">Unsubscribe</button></form></main></html>`,
      );
  }

  @Post(":token")
  @HttpCode(200)
  async unsubscribe(
    @Param("token") token: string,
    @Body() body: Record<string, unknown>,
    @Res() response: HtmlResponse,
  ) {
    const email = this.address(token);
    if (body?.["List-Unsubscribe"] !== "One-Click" && body?.confirm !== "yes") {
      throw new BadRequestException("Unsubscribe confirmation is required");
    }
    await this.database.suppressSalesEmail({ email, reason: "unsubscribe" });
    response
      .type("html")
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><main style="max-width:34rem;margin:4rem auto;padding:1rem;font:1rem system-ui"><h1>Unsubscribed</h1><p>You will no longer receive sales emails from BJH Logistics.</p></main></html>',
      );
  }
}
