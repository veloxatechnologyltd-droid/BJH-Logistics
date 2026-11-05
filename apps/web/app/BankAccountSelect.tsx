import type { BankAccount } from "@bjh/contracts";

/** The saved account's id if Settings still lists it; "" (automatic) otherwise. */
export const listedBankAccountId = (
  accounts: BankAccount[],
  id: string | null | undefined,
) => (id && accounts.some((account) => account.id === id) ? id : "");

/**
 * Picks which of the Settings bank accounts a quote or invoice prints. Left on
 * automatic, the document uses the account in its own currency. Shows nothing
 * until Settings has an account.
 */
export function BankAccountSelect({
  accounts,
  className,
  onChange,
  value,
}: {
  accounts: BankAccount[];
  className?: string;
  onChange: (id: string) => void;
  value: string;
}) {
  if (accounts.length === 0) return null;
  return (
    <label className={className}>
      Bank account to print
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Automatic: the account in the same currency</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.bankName} · {account.currency} {account.accountNumber}
          </option>
        ))}
      </select>
    </label>
  );
}
