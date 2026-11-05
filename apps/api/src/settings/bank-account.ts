import { BadRequestException } from "@nestjs/common";
import { pickBankAccount } from "@bjh/contracts";
import type { BankAccount, BusinessSettings } from "@bjh/contracts";

/**
 * The bank account to keep on a quote or an invoice: the one chosen, which
 * must still be listed in Settings (the browser sends only its id, never the
 * details), else the first account in the document's currency, else none.
 */
export function resolveBankAccount(
  settings: BusinessSettings | null,
  currency: string,
  wantedId: string | null,
): BankAccount | null {
  // Settings saved before bank accounts existed have no list.
  const accounts = settings?.bankAccounts ?? [];
  if (wantedId && !accounts.some((account) => account.id === wantedId)) {
    throw new BadRequestException(
      "That bank account is not in Settings; choose another",
    );
  }
  return pickBankAccount(accounts, currency, wantedId);
}
