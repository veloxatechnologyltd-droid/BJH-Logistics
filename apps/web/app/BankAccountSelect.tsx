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
 * A dropdown choosing which of the Settings bank accounts a quote or invoice
 * prints: "Default" (`value` null) prints the accounts marked default in
 * Settings, each with its currency, listed underneath; "Custom" shows a tick
 * list of all accounts. A saved choice that equals the defaults shows as
 * Default. Shows nothing until Settings has an account.
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

const detail = {
  color: "var(--brand-muted)",
  fontSize: "0.85rem",
  fontWeight: 400,
} as const;

function Picker({ accounts, className, onChange, value }: PickerProps) {
  const id = useId();
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
    <div className={className}>
      <label htmlFor={id}>Bank accounts to print</label>
      <select
        id={id}
        onChange={(event) => {
          const next = event.target.value === "custom";
          setCustom(next);
          onChange(next ? ticked : null);
        }}
        value={custom ? "custom" : "default"}
      >
        <option value="default">Default (set in Settings)</option>
        <option value="custom">Custom: choose the accounts</option>
      </select>
      {custom ? (
        accounts.map((account) => (
          <label
            key={account.id}
            style={{
              ...detail,
              alignItems: "center",
              color: "var(--brand-ink)",
              display: "flex",
              gap: 8,
            }}
          >
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
              style={{ padding: 0, width: "auto" }}
              type="checkbox"
            />
            {label(account)}
          </label>
        ))
      ) : defaults.length > 0 ? (
        defaults.map((account) => (
          <span key={account.id} style={detail}>
            {label(account)}
          </span>
        ))
      ) : (
        <span style={detail}>
          None is marked as default in Settings, so the account in the
          document&apos;s currency prints.
        </span>
      )}
    </div>
  );
}
