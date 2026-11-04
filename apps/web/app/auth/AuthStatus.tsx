"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { turnOffPush } from "../push/pushClient";
import { getSupabaseBrowserClient } from "./supabaseBrowserClient";
import styles from "./auth.module.css";

export function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    let active = true;
    const updateSession = async (session: Session | null) => {
      setEmail(session?.user.email ?? null);
      setIsSuperAdmin(false);
      if (!session) return;
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"}/v1/auth/session`,
          { headers: { authorization: `Bearer ${session.access_token}` } },
        );
        if (!response.ok) return;
        const result = (await response.json()) as { roles?: string[] };
        if (active)
          setIsSuperAdmin(result.roles?.includes("super_admin") ?? false);
      } catch {
        // Keep account administration hidden while the API is unavailable.
      }
    };
    void supabase.auth
      .getSession()
      .then(({ data }) => updateSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void updateSession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    // While still signed in: a shared computer must stop showing this
    // person's notifications (never blocks signing out).
    await turnOffPush();
    if (supabase) {
      await supabase.auth.signOut();
    }
  }

  if (!email) {
    return <Link href="/sign-in">Sign in</Link>;
  }

  return (
    <div className={styles.authStatus}>
      <span>{email}</span>
      {isSuperAdmin && <Link href="/settings/staff">Manage staff</Link>}
      <button className={styles.signOutButton} onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
