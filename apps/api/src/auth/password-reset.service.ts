import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { parseContract, passwordResetRequestSchema } from "@bjh/contracts";
import { EMAIL_PROVIDER } from "../notifications/providers";
import type { EmailProvider } from "../notifications/providers";
import { STAFF_AUTH_DIRECTORY } from "./staff-admin.port";
import type { StaffAuthDirectory } from "./staff-admin.port";

/** One reset email per address in this window, however often it is asked for. */
export const RESET_COOLDOWN_MS = 60_000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly lastAsked = new Map<string, number>();

  constructor(
    @Inject(STAFF_AUTH_DIRECTORY)
    private readonly directory: StaffAuthDirectory,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  /**
   * The reply is the same whether or not the address has an account, and the
   * code is made and sent after the reply, so neither the answer nor its timing
   * shows who has an account. A failure is logged, never shown to the caller;
   * so is each outcome (without the address), which is how a missing email is
   * traced.
   */
  request(body: unknown): { ok: true } {
    const input = parseContract(passwordResetRequestSchema, body);
    if (!input.success) throw new BadRequestException(input.message);
    const { email } = input.data;
    if (this.withinCooldown(email)) return { ok: true };
    void this.send(email).catch((error: unknown) => {
      this.logger.error(
        `Password reset email could not be sent: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    });
    return { ok: true };
  }

  private withinCooldown(email: string): boolean {
    const now = Date.now();
    for (const [address, asked] of this.lastAsked) {
      if (now - asked >= RESET_COOLDOWN_MS) this.lastAsked.delete(address);
    }
    if (this.lastAsked.has(email)) return true;
    this.lastAsked.set(email, now);
    return false;
  }

  private async send(email: string) {
    const code = await this.directory.createRecoveryCode(email);
    if (!code) {
      this.logger.log(
        "Password reset asked for an address with no active account: nothing sent",
      );
      return;
    }
    await this.email.send({
      to: email,
      subject: "Your BJH Logistics password reset code",
      text: [
        "Hello,",
        "",
        `We received a request to reset the password for your BJH Logistics account (${email}).`,
        "",
        "Your reset code is:",
        "",
        code,
        "",
        "Go back to the Reset your password page, paste this code, and choose a new password.",
        "",
        "The code works once and stops working after a short time. If you did not ask for this, ignore this email and your password will stay as it is.",
        "",
        "BJH Logistics",
      ].join("\n"),
    });
    this.logger.log(
      `Password reset code handed to the ${this.email.name} mail provider`,
    );
  }
}
