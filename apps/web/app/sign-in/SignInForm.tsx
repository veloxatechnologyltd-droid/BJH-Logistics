"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "../auth/supabaseBrowserClient";
import styles from "./signIn.module.css";
import { ErrorPopup } from "../ErrorPopup";

type AuthMode = "bootstrap" | "signin" | "signup" | "forgot";

const titles: Record<AuthMode, string> = {
  bootstrap: "Create super admin",
  signin: "Sign in",
  signup: "Create an account",
  forgot: "Reset your password",
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";

async function responseError(response: Response): Promise<Error | null> {
  if (response.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const message = Array.isArray(body?.message)
    ? body.message.join(", ")
    : body?.message;
  return new Error(message ?? "Authentication could not be completed");
}

export function SignInForm() {
  const router = useRouter();
  const [bootstrapAvailable, setBootstrapAvailable] = useState<boolean | null>(
    null,
  );
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/v1/auth/bootstrap-status`)
      .then(async (response) => {
        const failure = await responseError(response);
        if (failure) {
          throw failure;
        }
        return (await response.json()) as { bootstrapAvailable: boolean };
      })
      .then((status) => {
        if (active) {
          setBootstrapAvailable(status.bootstrapAvailable);
          if (status.bootstrapAvailable) {
            setMode("bootstrap");
          }
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The sign-in service is unavailable",
          );
          setBootstrapAvailable(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  function switchMode(next: AuthMode) {
    setError("");
    setNotice("");
    setMode(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) {
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        throw new Error("Sign-in is not configured for this site");
      }

      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email,
          {
            redirectTo: `${window.location.origin}/set-password`,
          },
        );
        if (resetError) throw resetError;
        // Same reply whether or not the address has an account.
        setNotice(
          "If an account uses this email, a link to set a new password is on its way.",
        );
        return;
      }

      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        throw result.error;
      }

      const accessToken = result.data.session?.access_token;
      if (!accessToken) {
        setNotice("Check your email to confirm the account, then sign in.");
        return;
      }

      // First local setup only; an ordinary new account never claims it.
      const claimsSuperAdmin = Boolean(bootstrapAvailable) && mode !== "signup";
      const endpoint = claimsSuperAdmin
        ? `${apiBaseUrl}/v1/auth/bootstrap-super-admin`
        : `${apiBaseUrl}/v1/auth/session`;
      const response = await fetch(endpoint, {
        method: claimsSuperAdmin ? "POST" : "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      // Signed in, but no role or company yet: the admin has to grant one.
      if (!claimsSuperAdmin && response.status === 403) {
        await supabase.auth.signOut();
        setNotice(
          mode === "signup"
            ? "Your account is created. An administrator must give you access before you can use the system."
            : "Your account has no access yet. Ask your administrator to give you access.",
        );
        return;
      }
      const failure = await responseError(response);
      if (failure) {
        if (response.status === 409) {
          setBootstrapAvailable(false);
          setMode("signin");
        }
        throw failure;
      }
      const session = claimsSuperAdmin
        ? {}
        : ((await response.json()) as {
            mustChangePassword?: boolean;
            twoFactorRequired?: boolean;
          });
      if (session.mustChangePassword) {
        router.replace("/set-password");
        return;
      }
      if (session.twoFactorRequired) {
        router.replace("/two-factor");
        return;
      }

      // A link from an email or SMS says where to go next; only paths of this site are followed.
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && /^\/(?!\/)/.test(next) ? next : "/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Authentication failed",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.signInCard}>
      <h1>{titles[mode]}</h1>

      <form className={styles.form} onSubmit={submit}>
        <label htmlFor="auth-email">
          Email
          <input
            autoComplete="email"
            id="auth-email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        {mode !== "forgot" && (
          <label htmlFor="auth-password">
            {mode === "signin"
              ? "Password"
              : "Password (at least 12 characters)"}
            <input
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              id="auth-password"
              minLength={mode === "signin" ? undefined : 12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        )}
        <ErrorPopup message={error} />
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        <button disabled={loading} type="submit">
          {loading
            ? "Working…"
            : mode === "forgot"
              ? "Send reset link"
              : titles[mode]}
        </button>
      </form>

      {mode === "signin" ? (
        <>
          <button
            className={styles.modeButton}
            onClick={() => switchMode("forgot")}
            type="button"
          >
            Forgot password?
          </button>
          <button
            className={styles.modeButton}
            onClick={() => switchMode("signup")}
            type="button"
          >
            New here? Create an account
          </button>
        </>
      ) : (
        mode !== "bootstrap" && (
          <button
            className={styles.modeButton}
            onClick={() => switchMode("signin")}
            type="button"
          >
            Back to sign in
          </button>
        )
      )}

      {bootstrapAvailable && (
        <button
          className={styles.modeButton}
          onClick={() =>
            switchMode(mode === "bootstrap" ? "signin" : "bootstrap")
          }
          type="button"
        >
          {mode === "bootstrap"
            ? "Already signed up? Sign in"
            : "First setup? Create the super admin"}
        </button>
      )}
    </section>
  );
}
