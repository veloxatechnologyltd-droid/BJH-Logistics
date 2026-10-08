"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AuthStatus } from "../../auth/AuthStatus";
import { authenticatedFetch } from "../../auth/authenticatedFetch";
import { listCustomers } from "../../customers/customerApi";
import type { CustomerCompany } from "../../customers/customerApi";
import styles from "../users/adminUsers.module.css";
import { ErrorPopup } from "../../ErrorPopup";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const accountsUrl = `${apiBaseUrl}/v1/admin/customer-accounts`;
const membershipsUrl = `${apiBaseUrl}/v1/admin/company-memberships`;

type Account = {
  id: string;
  email: string | null;
  createdAt: string;
  suspended: boolean;
  companies: Array<{ companyId: string; companyName: string }>;
};

/** Someone who opened an account themselves and has no access yet. */
type PendingAccount = { id: string; email: string | null; createdAt: string };

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : body?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The super admin creates customer logins and links each to its companies. */
export function CustomerAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pending, setPending] = useState<PendingAccount[]>([]);
  const [companies, setCompanies] = useState<CustomerCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [extraCompany, setExtraCompany] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [accountList, pendingList, companyList] = await Promise.all([
        readResponse<Account[]>(await authenticatedFetch(accountsUrl)),
        readResponse<PendingAccount[]>(
          await authenticatedFetch(`${accountsUrl}/pending`),
        ),
        listCustomers(""),
      ]);
      setAccounts(accountList);
      setPending(pendingList);
      setCompanies(companyList);
      setCompanyId((current) => current || companyList[0]?.id || "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Customer accounts could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(done);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    await run(async () => {
      await readResponse(
        await authenticatedFetch(
          accountsUrl,
          json("POST", { email, password, companyId }),
        ),
      );
      setEmail("");
      setPassword("");
      setCreating(false);
    }, `Account created for ${email.trim()}. No email was sent: give the sign-in details to the customer directly.`);
    setSaving(false);
  }

  const companyName = (id: string) =>
    companies.find((item) => item.id === id)?.companyName ?? id;

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <Link href="/">Workspace</Link>
          <span aria-hidden="true">/</span>
          <strong>Customer accounts</strong>
        </div>
        <AuthStatus />
      </header>
      <main className={styles.page}>
        <section className={styles.heading}>
          <div>
            <h1>Customer accounts</h1>
          </div>
          {!creating && (
            <button
              className={styles.headerButton}
              onClick={() => setCreating(true)}
              type="button"
            >
              New customer account
            </button>
          )}
        </section>

        {creating && (
          <section
            className={styles.invitePanel}
            aria-labelledby="create-customer-account-title"
          >
            <div>
              <h2 id="create-customer-account-title">
                Create a customer account
              </h2>
            </div>
            <form className={styles.inviteForm} onSubmit={createAccount}>
              <label>
                Company
                <select
                  onChange={(event) => setCompanyId(event.target.value)}
                  required
                  value={companyId}
                >
                  {companies.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.companyName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Email address
                <input
                  autoComplete="off"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label>
                Initial password
                <input
                  autoComplete="new-password"
                  minLength={12}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <button disabled={saving || !companyId} type="submit">
                {saving ? "Creating…" : "Create account"}
              </button>
              <button
                className={styles.cancelButton}
                onClick={() => setCreating(false)}
                type="button"
              >
                Cancel
              </button>
            </form>
          </section>
        )}

        <ErrorPopup message={error} />
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}

        {pending.length > 0 && (
          <section className={styles.directory} aria-labelledby="pending-title">
            <div className={styles.directoryHeading}>
              <div>
                <h2 id="pending-title">Waiting for access</h2>
              </div>
              <span>{pending.length} accounts</span>
            </div>
            <p className={styles.empty}>
              These people created an account themselves and can see nothing
              yet. Link a customer to its company here; give staff a role under
              Staff management.
            </p>
            <div className={styles.userList}>
              {pending.map((account) => (
                <article className={styles.userCard} key={account.id}>
                  <div className={styles.userHeading}>
                    <div>
                      <h3>{account.email ?? "Email unavailable"}</h3>
                      <p>
                        Signed up{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(new Date(account.createdAt))}
                      </p>
                    </div>
                  </div>
                  <div className={styles.addRole}>
                    <label>
                      Company
                      <select
                        onChange={(event) =>
                          setExtraCompany({
                            ...extraCompany,
                            [account.id]: event.target.value,
                          })
                        }
                        value={extraCompany[account.id] ?? ""}
                      >
                        <option value="">Choose a company</option>
                        {companies.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.companyName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      disabled={!extraCompany[account.id]}
                      onClick={() =>
                        void run(
                          async () =>
                            readResponse(
                              await authenticatedFetch(
                                membershipsUrl,
                                json("POST", {
                                  userId: account.id,
                                  companyId: extraCompany[account.id],
                                }),
                              ),
                            ),
                          `${account.email ?? account.id} can now see ${companyName(extraCompany[account.id])}.`,
                        )
                      }
                      type="button"
                    >
                      Give access
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className={styles.directory} aria-labelledby="customers-title">
          <div className={styles.directoryHeading}>
            <div>
              <h2 id="customers-title">Customer logins</h2>
            </div>
            <span>{accounts.length} accounts</span>
          </div>
          {loading ? (
            <p className={styles.empty} role="status">
              Loading customer accounts…
            </p>
          ) : accounts.length === 0 ? (
            <p className={styles.empty}>No customer accounts yet.</p>
          ) : (
            <div className={styles.userList}>
              {accounts.map((account) => (
                <article className={styles.userCard} key={account.id}>
                  <div className={styles.userHeading}>
                    <div>
                      <h3>{account.email ?? "Email unavailable"}</h3>
                      <p>
                        Created{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(new Date(account.createdAt))}
                      </p>
                    </div>
                    <span
                      className={
                        account.suspended
                          ? styles.inactiveBadge
                          : styles.activeBadge
                      }
                    >
                      {account.suspended ? "Suspended" : "Active"}
                    </span>
                  </div>
                  <div className={styles.roleList}>
                    {account.companies.map((item) => (
                      <div className={styles.roleRow} key={item.companyId}>
                        <span>{item.companyName}</span>
                        <button
                          className={styles.revokeButton}
                          onClick={() =>
                            void run(
                              async () =>
                                readResponse(
                                  await authenticatedFetch(
                                    `${membershipsUrl}/${encodeURIComponent(account.id)}/${encodeURIComponent(item.companyId)}`,
                                    { method: "DELETE" },
                                  ),
                                ),
                              `${item.companyName} unlinked from ${account.email ?? account.id}.`,
                            )
                          }
                          type="button"
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                  </div>
                  <details className={styles.history}>
                    <summary>Account controls</summary>
                    <div className={styles.addRole}>
                      <label>
                        Link another company
                        <select
                          onChange={(event) =>
                            setExtraCompany({
                              ...extraCompany,
                              [account.id]: event.target.value,
                            })
                          }
                          value={extraCompany[account.id] ?? ""}
                        >
                          <option value="">Choose a company</option>
                          {companies
                            .filter(
                              (item) =>
                                !account.companies.some(
                                  (linked) => linked.companyId === item.id,
                                ),
                            )
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.companyName}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button
                        disabled={!extraCompany[account.id]}
                        onClick={() =>
                          void run(
                            async () =>
                              readResponse(
                                await authenticatedFetch(
                                  membershipsUrl,
                                  json("POST", {
                                    userId: account.id,
                                    companyId: extraCompany[account.id],
                                  }),
                                ),
                              ),
                            `${companyName(extraCompany[account.id])} linked to ${account.email ?? account.id}.`,
                          )
                        }
                        type="button"
                      >
                        Link company
                      </button>
                    </div>
                    <form
                      className={styles.passwordForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const next = String(
                          new FormData(form).get("password") ?? "",
                        );
                        void run(
                          async () => {
                            await readResponse(
                              await authenticatedFetch(
                                `${accountsUrl}/${encodeURIComponent(account.id)}/password`,
                                json("PATCH", { password: next }),
                              ),
                            );
                            form.reset();
                          },
                          `Password changed for ${account.email ?? account.id}.`,
                        );
                      }}
                    >
                      <label>
                        Set a new password
                        <input
                          autoComplete="new-password"
                          minLength={12}
                          name="password"
                          required
                          type="password"
                        />
                      </label>
                      <button type="submit">Change password</button>
                    </form>
                    <button
                      className={styles.revokeButton}
                      onClick={() =>
                        void run(
                          async () =>
                            readResponse(
                              await authenticatedFetch(
                                `${accountsUrl}/${encodeURIComponent(account.id)}/${account.suspended ? "activate" : "suspend"}`,
                                { method: "POST" },
                              ),
                            ),
                          `${account.email ?? account.id} ${account.suspended ? "reactivated" : "suspended"}.`,
                        )
                      }
                      type="button"
                    >
                      {account.suspended
                        ? "Reactivate account"
                        : "Suspend account"}
                    </button>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
