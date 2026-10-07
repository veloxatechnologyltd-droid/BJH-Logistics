"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AuthStatus } from "../../auth/AuthStatus";
import { authenticatedFetch } from "../../auth/authenticatedFetch";
import styles from "./adminUsers.module.css";
import { ErrorPopup } from "../../ErrorPopup";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const staffUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/admin/staff`;
const roles = [
  ["super_admin", "Super admin"],
  ["air_import_rep", "Air import representative"],
  ["air_export_rep", "Air export representative"],
  ["sea_import_rep", "Sea import representative"],
  ["sea_export_rep", "Sea export representative"],
] as const;
const assignableRoles = roles.filter(([key]) => key !== "super_admin");

type RoleKey = (typeof roles)[number][0];
type Assignment = {
  id: string;
  roleKey: RoleKey;
  assignedBy: string;
  assignedAt: string;
  revokedAt: string | null;
};
type StaffUser = {
  id: string;
  email: string | null;
  createdAt: string;
  invitedAt: string | null;
  suspended: boolean;
  assignments: Assignment[];
};

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

function roleLabel(roleKey: string): string {
  return roles.find(([key]) => key === roleKey)?.[1] ?? roleKey;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminUsers() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleKey, setRoleKey] = useState<RoleKey>("air_import_rep");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);

  const loadPage = useCallback(async (requestedPage: number) => {
    setLoading(true);
    setError("");
    try {
      const result = await readResponse<{
        users: StaffUser[];
        hasMore: boolean;
        page: number;
      }>(await authenticatedFetch(`${staffUrl}?page=${requestedPage}`));
      setUsers(result.users);
      setHasMore(result.hasMore);
      setPage(result.page);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Staff could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await readResponse(
        await authenticatedFetch(staffUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, roleKey }),
        }),
      );
      setEmail("");
      setPassword("");
      setCreating(false);
      setNotice(`Account created for ${email.trim()}. No email was sent.`);
      await loadPage(1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Account creation failed",
      );
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(user: StaffUser, form: HTMLFormElement) {
    const nextPassword = String(new FormData(form).get("password") ?? "");
    setError("");
    setNotice("");
    try {
      await readResponse(
        await authenticatedFetch(
          `${staffUrl}/${encodeURIComponent(user.id)}/password`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: nextPassword }),
          },
        ),
      );
      form.reset();
      setNotice(`Password changed for ${user.email ?? user.id}.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Password change failed",
      );
    }
  }

  async function changeSuspension(user: StaffUser) {
    setError("");
    setNotice("");
    try {
      await readResponse(
        await authenticatedFetch(
          `${staffUrl}/${encodeURIComponent(user.id)}/${user.suspended ? "activate" : "suspend"}`,
          { method: "POST" },
        ),
      );
      setNotice(
        `${user.email ?? user.id} ${user.suspended ? "reactivated" : "suspended"}.`,
      );
      await loadPage(page);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Account status could not be changed",
      );
    }
  }

  async function updateRole(user: StaffUser, role: RoleKey) {
    setError("");
    setNotice("");
    try {
      await readResponse(
        await authenticatedFetch(
          `${staffUrl}/${encodeURIComponent(user.id)}/roles`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ roleKey: role }),
          },
        ),
      );
      setNotice(`${roleLabel(role)} assigned to ${user.email ?? user.id}.`);
      await loadPage(page);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Role assignment failed",
      );
    }
  }

  async function revokeRole(user: StaffUser, role: RoleKey) {
    setError("");
    setNotice("");
    try {
      await readResponse(
        await authenticatedFetch(
          `${staffUrl}/${encodeURIComponent(user.id)}/roles/${role}`,
          { method: "DELETE" },
        ),
      );
      setNotice(`${roleLabel(role)} revoked for ${user.email ?? user.id}.`);
      await loadPage(page);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Role revocation failed",
      );
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <Link href="/">Workspace</Link>
          <span aria-hidden="true">/</span>
          <strong>Staff management</strong>
        </div>
        <AuthStatus />
      </header>
      <main className={styles.page}>
        <section className={styles.heading}>
          <div>
            <h1>Staff management</h1>
          </div>
          {!creating && (
            <button
              className={styles.headerButton}
              onClick={() => setCreating(true)}
              type="button"
            >
              New staff account
            </button>
          )}
        </section>

        {creating && (
          <section
            className={styles.invitePanel}
            aria-labelledby="create-account-title"
          >
            <div>
              <h2 id="create-account-title">Create a staff account</h2>
            </div>
            <form className={styles.inviteForm} onSubmit={createAccount}>
              <label>
                Email address
                <input
                  autoFocus
                  autoComplete="email"
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
              <label>
                Initial role
                <select
                  onChange={(event) =>
                    setRoleKey(event.target.value as RoleKey)
                  }
                  value={roleKey}
                >
                  {assignableRoles.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={saving} type="submit">
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

        <section className={styles.directory} aria-labelledby="directory-title">
          <div className={styles.directoryHeading}>
            <div>
              <h2 id="directory-title">Users and role history</h2>
            </div>
            <span>{users.length} on this page</span>
          </div>
          {loading ? (
            <p className={styles.empty} role="status">
              Loading staff accounts…
            </p>
          ) : users.length === 0 ? (
            <p className={styles.empty}>No accounts found on this page.</p>
          ) : (
            <div className={styles.userList}>
              {users.map((user) => {
                const activeRoles = user.assignments.filter(
                  (assignment) => !assignment.revokedAt,
                );
                return (
                  <article className={styles.userCard} key={user.id}>
                    <div className={styles.userHeading}>
                      <div>
                        <h3>{user.email ?? "Email unavailable"}</h3>
                        <p>
                          Created {formatDate(user.createdAt)}
                          {user.invitedAt
                            ? ` · Invited ${formatDate(user.invitedAt)}`
                            : ""}
                        </p>
                      </div>
                      <span
                        className={
                          user.suspended || !activeRoles.length
                            ? styles.inactiveBadge
                            : styles.activeBadge
                        }
                      >
                        {user.suspended
                          ? "Suspended"
                          : activeRoles.length
                            ? "Access assigned"
                            : "No active role"}
                      </span>
                    </div>
                    <div className={styles.roleList}>
                      {activeRoles.map((assignment) => (
                        <div className={styles.roleRow} key={assignment.id}>
                          <span>
                            {roleLabel(assignment.roleKey)}{" "}
                            <small>
                              Assigned {formatDate(assignment.assignedAt)}
                            </small>
                          </span>
                          <button
                            className={styles.revokeButton}
                            onClick={() =>
                              void revokeRole(user, assignment.roleKey)
                            }
                            type="button"
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                      {activeRoles.length === 0 && (
                        <p className={styles.noRoles}>
                          This account has no active staff role.
                        </p>
                      )}
                    </div>
                    <details className={styles.history}>
                      <summary>Account controls</summary>
                      <p className={styles.accountWarning}>
                        Password changes let another person use this same
                        account. Activity remains tied to this account and will
                        not identify who used it.
                      </p>
                      <form
                        className={styles.passwordForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void changePassword(user, event.currentTarget);
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
                        onClick={() => void changeSuspension(user)}
                        type="button"
                      >
                        {user.suspended
                          ? "Reactivate account"
                          : "Suspend account"}
                      </button>
                    </details>
                    <details className={styles.history}>
                      <summary>
                        Role history ({user.assignments.length})
                      </summary>
                      {user.assignments.length ? (
                        <ul>
                          {user.assignments.map((assignment) => (
                            <li key={assignment.id}>
                              <strong>{roleLabel(assignment.roleKey)}</strong>{" "}
                              assigned {formatDate(assignment.assignedAt)}
                              {assignment.revokedAt
                                ? `; revoked ${formatDate(assignment.revokedAt)}`
                                : "; active"}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No role history.</p>
                      )}
                    </details>
                    <form
                      className={styles.addRole}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const selected = new FormData(form).get("roleKey");
                        if (typeof selected === "string")
                          void updateRole(user, selected as RoleKey);
                      }}
                    >
                      <label>
                        Add a role
                        <select name="roleKey" defaultValue="air_import_rep">
                          {assignableRoles.map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit">Assign role</button>
                    </form>
                  </article>
                );
              })}
            </div>
          )}
          <div className={styles.pagination}>
            <button
              disabled={loading || page <= 1}
              onClick={() => void loadPage(page - 1)}
              type="button"
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={loading || !hasMore}
              onClick={() => void loadPage(page + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
