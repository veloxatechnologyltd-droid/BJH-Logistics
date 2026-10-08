"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { authenticatedFetch } from "../auth/authenticatedFetch";
import { getSupabaseBrowserClient } from "../auth/supabaseBrowserClient";
import styles from "../sign-in/signIn.module.css";
import { ErrorPopup } from "../ErrorPopup";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";

/**
 * Reached two ways: after signing in on a password the admin set, and from
 * the link in a password-reset email (Supabase signs the user in from it).
 */
export function SetPassword() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setEmail(null);
      return;
    }
    let active = true;
    // The reset link's session can arrive a moment after the page opens.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setEmail(session.user.email ?? "");
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) setEmail(data.session.user.email ?? "");
      else setTimeout(() => active && setEmail((now) => now ?? null), 1500);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (password !== repeat) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await authenticatedFetch(
        `${apiBaseUrl}/v1/auth/password`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "The password could not be saved.");
      }
      // A password change ends the user's sessions, so sign in again with
      // the new password; the new token no longer carries the mark.
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } =
        (await supabase?.auth.signInWithPassword({
          email: email ?? "",
          password,
        })) ?? {};
      if (signInError) throw signInError;
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The password could not be saved.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.signInCard}>
        <h1>Set your password</h1>
        {email === undefined ? (
          <p className={styles.notice} role="status">
            Checking your sign-in…
          </p>
        ) : email === null ? (
          <>
            <p className={styles.description}>
              This link has expired or was already used.
            </p>
            <Link className={styles.modeButton} href="/sign-in">
              Back to sign in to ask for a new one
            </Link>
          </>
        ) : (
          <form className={styles.form} onSubmit={save}>
            <p className={styles.description}>
              Choose your own password{email ? ` for ${email}` : ""}.
            </p>
            <label htmlFor="new-password">
              New password (at least 12 characters)
              <input
                autoComplete="new-password"
                id="new-password"
                minLength={12}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <label htmlFor="repeat-password">
              Type it again
              <input
                autoComplete="new-password"
                id="repeat-password"
                minLength={12}
                onChange={(event) => setRepeat(event.target.value)}
                required
                type="password"
                value={repeat}
              />
            </label>
            <ErrorPopup message={error} />
            <button disabled={loading} type="submit">
              {loading ? "Saving…" : "Save password and continue"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
