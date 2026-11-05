import type { BankAccount } from "@bjh/contracts";

/**
 * The ids to send with a quote or invoice: the ticked accounts that Settings
 * still lists, or undefined when the person has not touched the choice (the API
 * then uses the default accounts).
 */
export const listedBankAccountIds = (
  accounts: BankAccount[],
  ids: string[] | null | undefined,
): string[] | undefined =>
  ids
    ? ids.filter((id) => accounts.some((account) => account.id === id))
    : undefined;

/** A saved document's account ids; undefined for one made before bank accounts existed. */
export const savedBankAccountIds = (
  saved: Array<{ id: string }> | null | undefined,
): string[] | null => (saved ? saved.map((account) => account.id) : null);

/**
 * Ticks which of the Settings bank accounts a quote or invoice prints. Until
 * the person ticks something (`value` null) the default accounts show ticked,
 * and that is what prints. Shows nothing until Settings has an account.
 */
export function BankAccountPicker({
  accounts,
  className,
  onChange,
  value,
}: {
  accounts: BankAccount[];
  className?: string;
  onChange: (ids: string[]) => void;
  value: string[] | null;
}) {
  if (accounts.length === 0) return null;
  const hasDefault = accounts.some((account) => account.isDefault);
  const ticked =
    value ??
    accounts
      .filter((account) => account.isDefault)
      .map((account) => account.id);
  return (
    <fieldset className={className}>
      <legend>Bank accounts to print</legend>
      {accounts.map((account) => (
        <label key={account.id}>
          <input
            checked={ticked.includes(account.id)}
            onChange={(event) =>
              onChange(
                accounts
                  .filter((item) =>
                    item.id === account.id
                      ? event.target.checked
                      : ticked.includes(item.id),
                  )
                  .map((item) => item.id),
              )
            }
            type="checkbox"
          />{" "}
          {account.bankName} · {account.currency} {account.accountNumber}
        </label>
      ))}
      {value === null && !hasDefault ? (
        <small>
          None is marked as default in Settings, so the account in the
          document&apos;s currency prints unless you tick others.
        </small>
      ) : null}
    </fieldset>
  );
}
