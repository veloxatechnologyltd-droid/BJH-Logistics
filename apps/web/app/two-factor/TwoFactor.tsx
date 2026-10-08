"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "../auth/supabaseBrowserClient";
import styles from "../sign-in/signIn.module.css";
import { ErrorPopup } from "../ErrorPopup";

/**
 * The super admin's second sign-in step: a code texted to their phone
 * (Supabase phone MFA). Only shown when the API has SUPER_ADMIN_MFA_REQUIRED
 * switched on. The first time, the admin enters the phone number to use.
 */
export function TwoFactor() {
  const router = useRouter();
  // undefined while checking; null when no phone is set up yet.
  const [factorId, setFactorId] = useState<string | null | undefined>(
    undefined,
  );
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    void supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (listError) setError(listError.message);
      setFactorId(data?.phone[0]?.id ?? null);
    });
  }, []);

  async function run(step: () => Promise<void>) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await step();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  const sendCode = (id: string) =>
    run(async () => {
      const supabase = getSupabaseBrowserClient()!;
      const { data, error: challengeError } = await supabase.auth.mfa.challenge(
        { factorId: id, channel: "sms" },
      );
      if (challengeError) throw challengeError;
      setChallengeId(data.id);
    });

  const addPhone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const supabase = getSupabaseBrowserClient()!;
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "phone",
        phone: phone.trim(),
      });
      if (enrollError) throw enrollError;
      setFactorId(data.id);
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({
          factorId: data.id,
          channel: "sms",
        });
      if (challengeError) throw challengeError;
      setChallengeId(challenge.id);
    });
  };

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const supabase = getSupabaseBrowserClient()!;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factorId!,
        challengeId,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      router.replace("/");
      router.refresh();
    });
  };

  return (
    <main className={styles.page}>
      <section className={styles.signInCard}>
        <h1>Confirm it&apos;s you</h1>
        {factorId === undefined ? (
          <p className={styles.notice} role="status">
            Checking…
          </p>
        ) : challengeId ? (
          <form className={styles.form} onSubmit={confirm}>
            <p className={styles.description}>
              Enter the 6-digit code sent to your phone.
            </p>
            <label htmlFor="mfa-code">
              Code
              <input
                autoComplete="one-time-code"
                id="mfa-code"
                inputMode="numeric"
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </label>
            <ErrorPopup message={error} />
            <button disabled={loading} type="submit">
              {loading ? "Checking…" : "Confirm"}
            </button>
          </form>
        ) : factorId ? (
          <div className={styles.form}>
            <p className={styles.description}>
              We will text a code to your phone.
            </p>
            <ErrorPopup message={error} />
            <button
              disabled={loading}
              onClick={() => void sendCode(factorId)}
              type="button"
            >
              {loading ? "Sending…" : "Send code"}
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={addPhone}>
            <p className={styles.description}>
              Add the phone that will receive your sign-in codes.
            </p>
            <label htmlFor="mfa-phone">
              Phone number, with country code
              <input
                autoComplete="tel"
                id="mfa-phone"
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+233 20 000 0000"
                required
                type="tel"
                value={phone}
              />
            </label>
            <ErrorPopup message={error} />
            <button disabled={loading} type="submit">
              {loading ? "Sending…" : "Send code"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
