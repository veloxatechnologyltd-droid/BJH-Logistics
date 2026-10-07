"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "../auth/supabaseBrowserClient";
import styles from "../sign-in/signIn.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";

export function CompleteInvitation() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Local Supabase Auth is not configured.");
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setEmail(data.session?.user.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setEmail(session?.user.email ?? null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Local Supabase Auth is not configured.");
      const { data, error: passwordError } = await supabase.auth.updateUser({
        password,
      });
      if (passwordError) throw passwordError;
      if (!data.user)
        throw new Error("The invitation session could not be confirmed.");
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError || !sessionData.session)
        throw new Error("Sign in again from your invitation link.");
      const response = await fetch(`${apiBaseUrl}/v1/auth/session`, {
        headers: {
          authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          body?.message ?? "The invited staff role could not be confirmed.",
        );
      }
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Invitation could not be completed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href="/sign-in">
        ← Staff sign in
      </Link>
      <section className={styles.signInCard}>
        <h1>Set your password</h1>
        <p className={styles.description}>
          {email
            ? `Complete access for ${email}.`
            : "Open this page from your BJH Logistics invitation email to continue."}
        </p>
        {email ? (
          <form className={styles.form} onSubmit={complete}>
            <label htmlFor="invite-password">
              New password
              <input
                autoComplete="new-password"
                id="invite-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <ErrorPopup message={error} />
            <button disabled={loading} type="submit">
              {loading ? "Saving…" : "Set password and continue"}
            </button>
          </form>
        ) : error ? (
          <>
            <ErrorPopup message={error} />
            <p className={styles.error}>{plainMessage(error)}</p>
          </>
        ) : (
          <p className={styles.notice} role="status">
            Checking invitation session…
          </p>
        )}
      </section>
    </main>
  );
}
