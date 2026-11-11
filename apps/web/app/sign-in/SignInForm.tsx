"use client";

import { passwordProblem, passwordRuleText } from "@bjh/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "../auth/supabaseBrowserClient";
import styles from "./signIn.module.css";
import { isSameSitePath } from "./sameSitePath";
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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState("");

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
    setCodeStep(false);
    setCode("");
    setConfirmPassword("");
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

      if (mode === "forgot" && codeStep) {
        // The code signs the person in for the one purpose of choosing a new password.
        const { error: codeError } = await supabase.auth.verifyOtp({
          email,
          token: code.replace(/\s/g, ""),
          type: "recovery",
        });
        if (codeError) {
          throw new Error(
            "That code is wrong or has expired. Check it, or ask for a new one.",
          );
        }
        router.replace("/set-password");
        return;
      }

      if (mode === "forgot") {
        // The API makes the code and emails it from BJH's own mail server.
        const response = await fetch(`${apiBaseUrl}/v1/auth/password-reset`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const failure = await responseError(response);
        if (failure) throw failure;
        // Same reply whether or not the address has an account.
        setCodeStep(true);
        setNotice(
          "If an account uses this email, a code to set a new password is on its way. Copy it from the email and paste it below.",
        );
        return;
      }

      if (mode !== "signin") {
        const problem =
          passwordProblem(password) ??
          (password !== confirmPassword
            ? "The two passwords do not match."
            : null);
        if (problem) throw new Error(problem);
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
      router.replace(next && isSameSitePath(next) ? next : "/");
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
      {mode === "signin" && (
        <p className={styles.accountHelp}>
          First time signing in? Contact BJH Logistics for your customer account
          details.
        </p>
      )}
      {mode === "forgot" && (
        <p className={styles.accountHelp}>
          Enter the email you sign in with. We will send you a code to set a new
          password.
        </p>
      )}

      <form className={styles.form} onSubmit={submit}>
        <label htmlFor="auth-email">
          Email
          <input
            autoComplete="email"
            id="auth-email"
            onChange={(event) => setEmail(event.target.value)}
            readOnly={codeStep}
            required
            type="email"
            value={email}
          />
        </label>
        {mode === "forgot" && codeStep && (
          <label htmlFor="auth-code">
            Code from your email
            <input
              autoComplete="one-time-code"
              id="auth-code"
              inputMode="numeric"
              maxLength={16}
              onChange={(event) => setCode(event.target.value)}
              pattern="[0-9 ]{6,16}"
              required
              type="text"
              value={code}
            />
          </label>
        )}
        {mode !== "forgot" && (
          <label htmlFor="auth-password">
            {mode === "signin"
              ? "Password"
              : `Password (${passwordRuleText.toLowerCase()})`}
            <input
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              id="auth-password"
              minLength={mode === "signin" ? undefined : 6}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        )}
        {(mode === "signup" || mode === "bootstrap") && (
          <label htmlFor="auth-confirm-password">
            Type the password again
            <input
              autoComplete="new-password"
              id="auth-confirm-password"
              minLength={6}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
        )}
        {mode === "signin" && (
          <div className={styles.forgotRow}>
            <button
              className={styles.modeButton}
              onClick={() => switchMode("forgot")}
              type="button"
            >
              Forgot password?
            </button>
          </div>
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
              ? codeStep
                ? "Confirm code"
                : "Send reset code"
              : titles[mode]}
        </button>
        {mode === "forgot" && codeStep && (
          <button
            className={styles.modeButton}
            onClick={() => {
              setError("");
              setNotice("");
              setCode("");
              setCodeStep(false);
            }}
            type="button"
          >
            Send a new code or change the email
          </button>
        )}
      </form>

      <div className={styles.cardFooter}>
        {mode === "signin" ? (
          <button
            className={styles.modeButton}
            onClick={() => switchMode("signup")}
            type="button"
          >
            New here? Create an account
          </button>
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
      </div>
    </section>
  );
}
