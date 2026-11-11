"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { departmentRoleKeys, staffRoleLabels } from "@bjh/contracts";
import type { HeldStaffRoleKey } from "@bjh/contracts";
import { passwordProblem, passwordRuleText } from "@bjh/contracts";
import { authenticatedFetch } from "../../auth/authenticatedFetch";
import styles from "./adminUsers.module.css";
import { ErrorPopup } from "../../ErrorPopup";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const staffUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/admin/staff`;
const assignableRoles = departmentRoleKeys.map(
  (key) => [key, staffRoleLabels[key]] as const,
);

type RoleKey = HeldStaffRoleKey;
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
  name?: string | null;
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
  return staffRoleLabels[roleKey as RoleKey] ?? roleKey;
}

/** What the person does now: their active roles, e.g. "Sales". */
function activeRoleLabels(user: StaffUser): string[] {
  return user.assignments
    .filter((assignment) => !assignment.revokedAt)
    .map((assignment) => roleLabel(assignment.roleKey));
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [roleKey, setRoleKey] = useState<RoleKey>("import_rep");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      setSelected([]);
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
    setError("");
    setNotice("");
    const problem =
      passwordProblem(password) ??
      (password !== confirmPassword ? "The two passwords do not match." : null);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await readResponse(
        await authenticatedFetch(staffUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, email, password, roleKey }),
        }),
      );
      setName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
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
    const data = new FormData(form);
    const nextPassword = String(data.get("password") ?? "");
    setError("");
    setNotice("");
    const problem =
      passwordProblem(nextPassword) ??
      (nextPassword !== String(data.get("confirm") ?? "")
        ? "The two passwords do not match."
        : null);
    if (problem) {
      setError(problem);
      return;
    }
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

  async function changeName(user: StaffUser, form: HTMLFormElement) {
    const nextName = String(new FormData(form).get("name") ?? "").trim();
    setError("");
    setNotice("");
    try {
      await readResponse(
        await authenticatedFetch(
          `${staffUrl}/${encodeURIComponent(user.id)}/name`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: nextName }),
          },
        ),
      );
      setNotice(`Name saved for ${user.email ?? user.id}.`);
      await loadPage(page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Name was not saved");
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

  const needle = query.trim().toLowerCase();
  const visibleUsers = needle
    ? users.filter((user) =>
        [user.name ?? "", user.email ?? "", ...activeRoleLabels(user)].some(
          (text) => text.toLowerCase().includes(needle),
        ),
      )
    : users;

  async function deleteAccounts(userIds: string[]) {
    if (deleting) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await readResponse<{
        deleted: string[];
        failed: { userId: string; reason: string }[];
      }>(
        await authenticatedFetch(`${staffUrl}/delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userIds }),
        }),
      );
      const label = (id: string) =>
        users.find((user) => user.id === id)?.email ?? id;
      if (result.deleted.length) {
        setNotice(
          result.deleted.length === 1
            ? `${label(result.deleted[0])} deleted.`
            : `${result.deleted.length} accounts deleted.`,
        );
      }
      if (result.failed.length) {
        setError(
          result.failed
            .map((item) => `${label(item.userId)}: ${item.reason}`)
            .join(" "),
        );
      }
      setConfirmDelete(null);
      await loadPage(page);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Accounts were not deleted",
      );
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelected(userId: string) {
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
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
                Full name
                <input
                  autoComplete="name"
                  autoFocus
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Shown to everyone in chat and on jobs"
                  value={name}
                />
              </label>
              <label>
                Email address
                <input
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
                  minLength={6}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="6+ characters: Aa and 1"
                  required
                  title={passwordRuleText}
                  type="password"
                  value={password}
                />
              </label>
              <label>
                Confirm password
                <input
                  autoComplete="new-password"
                  minLength={6}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Type it again"
                  required
                  type="password"
                  value={confirmPassword}
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
            <span>
              {needle
                ? `${visibleUsers.length} of ${users.length} shown`
                : `${users.length} on this page`}
            </span>
          </div>
          <input
            aria-label="Search staff by name, email or role"
            className={styles.search}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected([]);
            }}
            placeholder="Search by name, email or role (e.g. Sales)"
            type="search"
            value={query}
          />
          {visibleUsers.length > 0 && (
            <div className={styles.selectionBar}>
              <label>
                <input
                  checked={
                    visibleUsers.length > 0 &&
                    selected.length === visibleUsers.length
                  }
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? visibleUsers.map((user) => user.id)
                        : [],
                    )
                  }
                  type="checkbox"
                />
                Select all on this page
              </label>
              {selected.length > 0 && (
                <>
                  <span>{selected.length} selected</span>
                  <button
                    className={styles.revokeButton}
                    onClick={() => setConfirmDelete(selected)}
                    type="button"
                  >
                    Delete selected
                  </button>
                </>
              )}
            </div>
          )}
          {confirmDelete && (
            <div className={styles.confirmPanel} role="alertdialog">
              <p>
                Delete{" "}
                {confirmDelete.length === 1
                  ? (users.find((user) => user.id === confirmDelete[0])
                      ?.email ?? "this account")
                  : `${confirmDelete.length} accounts`}
                ? They will no longer be able to sign in. An account with jobs,
                notes or other work recorded under it is hidden and its history
                kept, as &ldquo;Staff member&rdquo;; any other account is
                erased. This cannot be undone.
              </p>
              <button
                className={styles.confirmButton}
                disabled={deleting}
                onClick={() => void deleteAccounts(confirmDelete)}
                type="button"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                className={styles.revokeButton}
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          )}
          {loading ? (
            <p className={styles.empty} role="status">
              Loading staff accounts…
            </p>
          ) : visibleUsers.length === 0 ? (
            <p className={styles.empty}>
              {needle
                ? "No one on this page matches your search."
                : "No accounts found on this page."}
            </p>
          ) : (
            <div className={styles.userList}>
              {visibleUsers.map((user) => {
                const activeRoles = user.assignments.filter(
                  (assignment) => !assignment.revokedAt,
                );
                return (
                  <article className={styles.userCard} key={user.id}>
                    <div className={styles.userHeading}>
                      <input
                        aria-label={`Select ${user.email ?? user.id}`}
                        checked={selected.includes(user.id)}
                        className={styles.selectBox}
                        onChange={() => toggleSelected(user.id)}
                        type="checkbox"
                      />
                      <div className={styles.userTitle}>
                        <h3>{user.name || "No name set"}</h3>
                        <p className={styles.roleTitle}>
                          {activeRoles.length
                            ? activeRoleLabels(user).join(" · ")
                            : "No active role"}
                        </p>
                        <p>
                          {user.email ?? "Email unavailable"} · Created{" "}
                          {formatDate(user.createdAt)}
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
                          void changeName(user, event.currentTarget);
                        }}
                      >
                        <label>
                          Name shown to others
                          <input
                            defaultValue={user.name ?? ""}
                            maxLength={80}
                            name="name"
                            placeholder="Full name"
                          />
                        </label>
                        <button type="submit">Save name</button>
                      </form>
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
                            minLength={6}
                            name="password"
                            placeholder="6+ characters: Aa and 1"
                            required
                            title={passwordRuleText}
                            type="password"
                          />
                        </label>
                        <label>
                          Confirm the new password
                          <input
                            autoComplete="new-password"
                            minLength={6}
                            name="confirm"
                            placeholder="Type it again"
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
                      </button>{" "}
                      <button
                        className={styles.revokeButton}
                        onClick={() => setConfirmDelete([user.id])}
                        type="button"
                      >
                        Delete account
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
                        <select name="roleKey" defaultValue="" required>
                          <option disabled value="">
                            Choose a role…
                          </option>
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
