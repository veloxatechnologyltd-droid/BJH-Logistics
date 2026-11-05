import { useId, useState } from "react";
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

const label = (account: BankAccount) =>
  `${account.bankName} · ${account.currency} ${account.accountNumber}`;

/**
 * Chooses which of the Settings bank accounts a quote or invoice prints:
 * "Default" (`value` null) prints the accounts marked default in Settings, each
 * with its currency, and "Custom" lets the person tick the accounts. A saved
 * choice that equals the defaults shows as Default. Shows nothing until
 * Settings has an account.
 */
export function BankAccountPicker(props: PickerProps) {
  // Mounted only once Settings has loaded, so the first choice shown is right.
  return props.accounts.length === 0 ? null : <Picker {...props} />;
}

type PickerProps = {
  accounts: BankAccount[];
  className?: string;
  onChange: (ids: string[] | null) => void;
  value: string[] | null;
};

function Picker({ accounts, className, onChange, value }: PickerProps) {
  const name = useId();
  const defaults = accounts.filter((account) => account.isDefault);
  const [custom, setCustom] = useState(
    value !== null &&
      !(
        value.length === defaults.length &&
        defaults.every((account) => value.includes(account.id))
      ),
  );
  const ticked = value ?? defaults.map((account) => account.id);
  return (
    <fieldset className={className}>
      <legend>Bank accounts to print</legend>
      <label>
        <input
          checked={!custom}
          name={name}
          onChange={() => {
            setCustom(false);
            onChange(null);
          }}
          type="radio"
        />{" "}
        Default: the accounts set as default in Settings
      </label>
      {!custom ? (
        <small>
          {defaults.length > 0
            ? defaults.map(label).join("; ")
            : "None is marked as default in Settings, so the account in the document's currency prints."}
        </small>
      ) : null}
      <label>
        <input
          checked={custom}
          name={name}
          onChange={() => {
            setCustom(true);
            onChange(ticked);
          }}
          type="radio"
        />{" "}
        Custom: choose the accounts
      </label>
      {custom
        ? accounts.map((account) => (
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
              {label(account)}
            </label>
          ))
        : null}
    </fieldset>
  );
}
