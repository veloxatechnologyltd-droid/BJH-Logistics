import { BadRequestException } from "@nestjs/common";
import { pickBankAccounts } from "@bjh/contracts";
import type { BankAccount, BusinessSettings } from "@bjh/contracts";

/**
 * The bank accounts to keep on a quote or an invoice: the ones chosen, which
 * must all still be listed in Settings (the browser sends only ids, never the
 * details), else the default accounts, else the first account in the
 * document's currency, else none.
 */
export function resolveBankAccounts(
  settings: BusinessSettings | null,
  currency: string,
  wantedIds: string[] | undefined,
): BankAccount[] {
  // Settings saved before bank accounts existed have no list.
  const accounts = settings?.bankAccounts ?? [];
  if (wantedIds?.some((id) => !accounts.some((account) => account.id === id))) {
    throw new BadRequestException(
      "A chosen bank account is not in Settings; choose another",
    );
  }
  return pickBankAccounts(accounts, currency, wantedIds);
}

/**
 * Reads the `bank_account` column of a quote version or invoice. Documents made
 * on 2026-11-05 hold one account as an object; later ones hold a list. Null
 * means the document predates bank accounts, so the PDF falls back to Settings.
 */
export function storedBankAccounts(value: unknown): BankAccount[] | null {
  if (Array.isArray(value)) return value as BankAccount[];
  return value ? [value as BankAccount] : null;
}
